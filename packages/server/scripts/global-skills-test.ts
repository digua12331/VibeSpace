// Unit-style smoke for skills-service global-pool + project-override logic.
// Runs under tsx so it can import the .ts sources directly.
// Invoked by scripts/global-skills-smoke.mjs at repo root.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSkills,
  pickSkillsForTask,
  type MatchedSkill,
} from "../src/skills-service.ts";

let failures = 0;
let total = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  total += 1;
  if (cond) {
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}\n`);
    if (detail !== undefined) {
      process.stdout.write(`        ${JSON.stringify(detail)}\n`);
    }
  }
}

/** Write `<dir>/<name>.md` with an inline-array `triggers` frontmatter. */
function writeSkill(dir: string, name: string, triggers: string[], body: string) {
  mkdirSync(dir, { recursive: true });
  const fm = `---\ntriggers: [${triggers.join(", ")}]\n---\n\n${body}\n`;
  writeFileSync(join(dir, `${name}.md`), fm, "utf8");
}

/** A skill file whose frontmatter is never closed — the "broken" case. */
function writeBrokenSkill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\ntriggers: [闭环]\n本应有闭合的三横线但没有\n正文混进了 frontmatter\n`, "utf8");
}

function names(matched: MatchedSkill[]): string[] {
  return matched.map((m) => m.skill.name).sort();
}
function sourceOf(matched: MatchedSkill[], skillName: string): string | undefined {
  return matched.find((m) => m.skill.name === skillName)?.source;
}

async function run() {
  const root = mkdtempSync(join(tmpdir(), "vibespace-global-skills-"));

  // ---- Scenario 1: only global -------------------------------------------
  {
    const projectDir = join(root, "s1-project");
    const globalDir = join(root, "s1-global");
    mkdirSync(projectDir, { recursive: true });
    writeSkill(globalDir, "g-only", ["闭环"], "GLOBAL ONLY BODY");
    process.env.AIMON_GLOBAL_SKILLS_DIR = globalDir;

    const matched = await pickSkillsForTask(projectDir, "测试闭环流程");
    check("S1 只全局: 命中 g-only", names(matched).join(",") === "g-only", names(matched));
    check("S1 只全局: source=global", sourceOf(matched, "g-only") === "global");
    check(
      "S1 只全局: body 来自全局",
      matched[0]?.skill.body === "GLOBAL ONLY BODY",
      matched[0]?.skill.body,
    );
  }

  // ---- Scenario 2: only project ------------------------------------------
  {
    const projectDir = join(root, "s2-project");
    const globalDir = join(root, "s2-global"); // intentionally never created
    writeSkill(join(projectDir, ".aimon", "skills"), "p-only", ["路由"], "PROJECT ONLY BODY");
    process.env.AIMON_GLOBAL_SKILLS_DIR = globalDir;

    const matched = await pickSkillsForTask(projectDir, "加新路由");
    check("S2 只项目: 命中 p-only", names(matched).join(",") === "p-only", names(matched));
    check("S2 只项目: source=project", sourceOf(matched, "p-only") === "project");
  }

  // ---- Scenario 3: merge + project overrides global ----------------------
  {
    const projectDir = join(root, "s3-project");
    const globalDir = join(root, "s3-global");
    // same-name skill in both — project must win
    writeSkill(globalDir, "dup", ["闭环"], "GLOBAL VERSION");
    writeSkill(join(projectDir, ".aimon", "skills"), "dup", ["闭环"], "PROJECT VERSION");
    // plus one unique on each side
    writeSkill(globalDir, "g-extra", ["闭环"], "g extra");
    writeSkill(join(projectDir, ".aimon", "skills"), "p-extra", ["闭环"], "p extra");
    process.env.AIMON_GLOBAL_SKILLS_DIR = globalDir;

    const matched = await pickSkillsForTask(projectDir, "闭环任务");
    check(
      "S3 合并: 命中 dup+g-extra+p-extra 三个",
      names(matched).join(",") === "dup,g-extra,p-extra",
      names(matched),
    );
    const dup = matched.find((m) => m.skill.name === "dup");
    check("S3 合并: dup 被项目级覆盖 (source=project)", dup?.source === "project");
    check("S3 合并: dup body 是项目版", dup?.skill.body === "PROJECT VERSION", dup?.skill.body);
    check("S3 合并: g-extra source=global", sourceOf(matched, "g-extra") === "global");
    check("S3 合并: p-extra source=project", sourceOf(matched, "p-extra") === "project");
  }

  // ---- Scenario 4: neither dir exists — graceful [] ----------------------
  {
    const projectDir = join(root, "s4-project"); // no .aimon/skills inside
    mkdirSync(projectDir, { recursive: true });
    process.env.AIMON_GLOBAL_SKILLS_DIR = join(root, "s4-nonexistent-global");

    let threw = false;
    let matched: MatchedSkill[] = [];
    try {
      matched = await pickSkillsForTask(projectDir, "随便什么任务");
    } catch {
      threw = true;
    }
    check("S4 都不存在: 不抛异常", !threw);
    check("S4 都不存在: 返回空数组", matched.length === 0, matched);
  }

  // ---- Scenario 5: a broken file is skipped, good ones still work --------
  {
    const projectDir = join(root, "s5-project");
    const globalDir = join(root, "s5-global");
    mkdirSync(projectDir, { recursive: true });
    writeBrokenSkill(globalDir, "broken");
    writeSkill(globalDir, "good", ["闭环"], "GOOD BODY");
    process.env.AIMON_GLOBAL_SKILLS_DIR = globalDir;

    let threw = false;
    let matched: MatchedSkill[] = [];
    try {
      matched = await pickSkillsForTask(projectDir, "闭环");
    } catch {
      threw = true;
    }
    check("S5 坏文件: 不抛异常", !threw);
    check("S5 坏文件: 只命中 good，broken 被跳过", names(matched).join(",") === "good", names(matched));
  }

  // ---- Scenario 6: listSkills() stays project-only -----------------------
  {
    const projectDir = join(root, "s6-project");
    const globalDir = join(root, "s6-global");
    writeSkill(globalDir, "g-side", ["闭环"], "global side");
    writeSkill(join(projectDir, ".aimon", "skills"), "p-side", ["闭环"], "project side");
    process.env.AIMON_GLOBAL_SKILLS_DIR = globalDir;

    const projectOnly = await listSkills(projectDir);
    const projNames = projectOnly.map((s) => s.name).sort();
    check(
      "S6 listSkills 仍只返回项目级 (不混入全局)",
      projNames.join(",") === "p-side",
      projNames,
    );
  }

  rmSync(root, { recursive: true, force: true });
  delete process.env.AIMON_GLOBAL_SKILLS_DIR;

  process.stdout.write(`\n${total - failures}/${total} passed\n`);
  if (failures > 0) {
    process.stdout.write(`${failures} FAILED\n`);
    process.exit(1);
  }
  process.stdout.write("global-skills smoke OK\n");
}

run().catch((err) => {
  process.stderr.write(`[global-skills-test] crashed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
