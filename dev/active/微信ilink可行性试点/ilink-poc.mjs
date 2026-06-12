// 微信 ilink Bot API 可行性试点脚本（一次性试验代码，不属于产品）
// 用法：
//   node ilink-poc.mjs probe            探测接口连通性，取一次二维码落成 ilink-qr.png
//   node ilink-poc.mjs login            取二维码并轮询扫码状态，成功后把 token 存入 ilink-state.json
//   node ilink-poc.mjs listen           长轮询收消息，收到文本自动回复一条（验证收/回链路）
//   node ilink-poc.mjs push "文本"      用最近一次入站消息的 context_token 主动推送（验收 3 关键题）
//   node ilink-poc.mjs push "文本" --no-token   不带 context_token 推送（验收 3 对照组）
// 依赖：Node 18+ 原生 fetch，零 npm 依赖。接口细节见同目录 weixin-bot-api-参考.md。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(DIR, "ilink-state.json");
const QR_PATH = resolve(DIR, "ilink-qr.png");
const LOGIN_BASE = "https://ilinkai.weixin.qq.com";

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

// 文档约定：X-WECHAT-UIN = base64(随机 uint32 的十进制字符串)，每次请求都换
function headers(token) {
  const uin = Buffer.from(String((Math.random() * 0xffffffff) >>> 0)).toString("base64");
  const h = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function call(base, path, { method = "POST", body, token } = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应，原样展示 */
  }
  return { httpStatus: res.status, json, text };
}

function show(label, r) {
  console.log(`\n[${label}] HTTP ${r.httpStatus}`);
  if (r.json) console.log(JSON.stringify(r.json, null, 2).slice(0, 3000));
  else console.log(r.text.slice(0, 1000));
}

async function fetchQrcode() {
  const r = await call(LOGIN_BASE, "/ilink/bot/get_bot_qrcode?bot_type=3", { method: "GET" });
  if (!r.json) {
    show("get_bot_qrcode 非 JSON 响应", r);
    return null;
  }
  const { qrcode, qrcode_img_content } = r.json;
  console.log(`\n[get_bot_qrcode] HTTP ${r.httpStatus} 字段: ${Object.keys(r.json).join(", ")}`);
  // 实测 qrcode_img_content 装的是登录链接（https://liteapp.weixin.qq.com/q/...），不是图片 base64
  if (qrcode_img_content?.startsWith("http")) {
    console.log(`登录链接: ${qrcode_img_content}`);
    try {
      // Windows 上必须经 shell 跑 npx.cmd，链接里的 & 要手动加引号防止被 shell 截断
      const quote = (s) => (process.platform === "win32" ? `"${s}"` : s);
      execFileSync("npx", ["--yes", "qrcode", "-o", quote(QR_PATH), quote(qrcode_img_content)], {
        stdio: ["ignore", "ignore", "inherit"],
        shell: process.platform === "win32",
      });
      console.log(`二维码已生成: ${QR_PATH} （用图片查看器打开，手机微信扫码）`);
    } catch {
      console.log("本地生成二维码图片失败；可把上面的登录链接手动转成二维码后扫描。");
    }
  } else {
    show("qrcode_img_content 不是预期的链接，原始响应", r);
  }
  return qrcode ?? null;
}

async function cmdProbe() {
  console.log("探测 ilink 接口连通性 ...");
  const qrcode = await fetchQrcode();
  console.log(qrcode ? `\n探测成功，拿到 qrcode 标识（长度 ${qrcode.length}）。` : "\n探测未拿到 qrcode，见上方原始响应。");
}

async function cmdLogin() {
  const qrcode = await fetchQrcode();
  if (!qrcode) return;
  console.log("\n等待扫码（最长 3 分钟），状态变化会打印出来 ...");
  const deadline = Date.now() + 3 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const r = await call(LOGIN_BASE, `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, { method: "GET" });
    const st = r.json?.status ?? `HTTP ${r.httpStatus}`;
    if (st !== lastStatus) {
      lastStatus = st;
      console.log(`  扫码状态: ${st}`);
      if (st !== "confirmed" && r.json && r.httpStatus !== 200) show("get_qrcode_status", r);
    }
    if (r.json?.status === "confirmed") {
      const { bot_token, baseurl } = r.json;
      saveState({ botToken: bot_token, baseUrl: baseurl || LOGIN_BASE, getUpdatesBuf: "" });
      console.log(`\n登录成功。token 已存入 ${STATE_PATH}（已 gitignore）`);
      console.log(`后续接口基址: ${baseurl || LOGIN_BASE}`);
      return;
    }
    await new Promise((s) => setTimeout(s, 1500));
  }
  console.log("超时未确认扫码。重新运行 login 取新二维码。");
}

function requireLogin() {
  const st = loadState();
  if (!st.botToken) {
    console.error("尚未登录：先运行  node ilink-poc.mjs login");
    process.exit(1);
  }
  return st;
}

async function cmdListen() {
  let st = requireLogin();
  console.log("开始长轮询收消息（Ctrl+C 退出）。现在用微信给机器人发一句话 ...");
  for (;;) {
    const r = await call(st.baseUrl, "/ilink/bot/getupdates", {
      token: st.botToken,
      body: { get_updates_buf: st.getUpdatesBuf || "", base_info: { channel_version: "1.0.2" } },
    });
    if (!r.json) {
      show("getupdates 非 JSON 响应", r);
      await new Promise((s) => setTimeout(s, 3000));
      continue;
    }
    if (r.json.ret !== undefined && r.json.ret !== 0) {
      show("getupdates ret 非 0", r);
      await new Promise((s) => setTimeout(s, 3000));
      continue;
    }
    if (r.json.get_updates_buf) st = saveState({ getUpdatesBuf: r.json.get_updates_buf });
    for (const msg of r.json.msgs ?? []) {
      const text = msg.item_list?.find((i) => i.type === 1)?.text_item?.text;
      console.log(`\n[inbound] type=${msg.message_type} from=${msg.from_user_id} text=${JSON.stringify(text)}`);
      if (msg.message_type !== 1 || !text) continue;
      st = saveState({
        lastFromUserId: msg.from_user_id,
        lastContextToken: msg.context_token,
        lastInboundAt: new Date().toISOString(),
      });
      const reply = await call(st.baseUrl, "/ilink/bot/sendmessage", {
        token: st.botToken,
        body: {
          msg: {
            client_id: `poc-${randomUUID()}`, // 多份协议拆解列为必填的消息去重 ID，验证它是否影响送达持续性
            to_user_id: msg.from_user_id,
            message_type: 2,
            message_state: 2,
            context_token: msg.context_token,
            item_list: [{ type: 1, text_item: { text: `✅ 试点脚本已收到：${text}` } }],
          },
        },
      });
      show("自动回复 sendmessage", reply);
    }
  }
}

async function cmdPush(text, noToken) {
  const st = requireLogin();
  if (!st.lastFromUserId) {
    console.error("state 里没有收件人：先运行 listen 并在微信里发一句话，记录下 from_user_id / context_token。");
    process.exit(1);
  }
  const ageMin = st.lastInboundAt ? ((Date.now() - Date.parse(st.lastInboundAt)) / 60000).toFixed(1) : "?";
  console.log(`主动推送（${noToken ? "不带" : "复用"} context_token；距最近一条入站消息 ${ageMin} 分钟）...`);
  const body = {
    msg: {
      client_id: `poc-${randomUUID()}`,
      to_user_id: st.lastFromUserId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
    },
  };
  if (!noToken) body.msg.context_token = st.lastContextToken;
  const r = await call(st.baseUrl, "/ilink/bot/sendmessage", { token: st.botToken, body });
  show("push sendmessage", r);
  console.log("\n请在微信里确认这条消息是否真的收到（接口返回成功≠送达，以手机为准）。");
}

const [, , cmd, ...rest] = process.argv;
const noToken = rest.includes("--no-token");
const arg = rest.filter((a) => a !== "--no-token").join(" ");

switch (cmd) {
  case "probe":
    await cmdProbe();
    break;
  case "login":
    await cmdLogin();
    break;
  case "listen":
    await cmdListen();
    break;
  case "push":
    await cmdPush(arg || `主动推送测试 ${new Date().toLocaleTimeString()}`, noToken);
    break;
  default:
    console.log("用法: node ilink-poc.mjs <probe|login|listen|push> [文本] [--no-token]");
}
