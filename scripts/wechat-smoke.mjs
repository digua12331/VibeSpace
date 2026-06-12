#!/usr/bin/env node
// wechat-smoke: WechatClient（微信 ilink 连接管理器）生命周期测试。
// 不起真服务器、不连真微信：直接 import server dist 产物，并用可编程的
// 假 fetch 替换 globalThis.fetch 假扮 ilink 接口（这样 baseUrl 的 https
// 白名单校验照常生效，不需要给产品代码开测试后门）。
//
// 覆盖（对应 dev/active/微信接入设置 plan 的客户端生命周期验收）：
//   1) 重复取码单飞：旧二维码的扫码轮询在新取码后停止
//   2) 扫码确认 → 自动长轮询；游标在消息处理完成后才提交
//   3) 消息按 context_token 去重（崩溃重启的重复投递不重复进 handler）
//   4) getupdates 返回 -14 → 状态进入 error，循环退出
//   5) start() 重启恢复：从已存游标继续
//   6) stop() 主动中止在途长轮询请求
//   7) sendReply 带唯一 client_id；-14 → 抛错且状态 error
//
// 运行：pnpm smoke:wechat（会先 build server）。
// 会临时改写 packages/server/data/wechat.json，结束后恢复原内容。

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(ROOT, "packages", "server", "data", "wechat.json");

console.log("[build] pnpm -F @aimon/server build ...");
execSync("pnpm -F @aimon/server build", { cwd: ROOT, stdio: "inherit" });

const { wechatClient } = await import(
  new URL("../packages/server/dist/wechat/client.js", import.meta.url).href
);
const { getWechatConfig, setWechatConfig } = await import(
  new URL("../packages/server/dist/wechat/config.js", import.meta.url).href
);

// ---- 假 ilink 服务（替换 global fetch，按 URL 路径分发到可编程 handler） ----

const realFetch = globalThis.fetch;
/** path 片段 -> handler(url, init) => {status, json} | Promise<...> */
const routes = new Map();
const calls = []; // {path, body} 调用流水，断言用

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  for (const [frag, handler] of routes) {
    if (u.includes(frag)) {
      calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
      const r = await handler(u, init);
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }
  }
  throw new Error(`smoke fake fetch: 未注册的请求 ${u}`);
};

/** 可手动 resolve 的挂起 long-poll（模拟服务端 hold 35 秒）。 */
function deferred(signal) {
  let resolve_, reject_;
  const p = new Promise((res, rej) => {
    resolve_ = res;
    reject_ = rej;
    if (signal) {
      if (signal.aborted) rej(new DOMException("aborted", "AbortError"));
      else signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")), { once: true });
    }
  });
  return { promise: p, resolve: resolve_, reject: reject_ };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond, label, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`waitFor 超时: ${label}`);
}

// ---- 测试基架 ----

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const originalConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : null;

try {
  // ====== 场景 1：重复取码单飞 ======
  let qrSeq = 0;
  const statusPollsByQr = new Map();
  routes.set("get_bot_qrcode", () => {
    qrSeq++;
    return { json: { ret: 0, qrcode: `qr-${qrSeq}`, qrcode_img_content: `https://liteapp.weixin.qq.com/q/x?qrcode=qr-${qrSeq}` } };
  });
  routes.set("get_qrcode_status", (u) => {
    const qr = new URL(u).searchParams.get("qrcode");
    statusPollsByQr.set(qr, (statusPollsByQr.get(qr) ?? 0) + 1);
    return { json: { status: "wait" } };
  });

  const login1 = await wechatClient.beginLogin();
  check("取码返回登录链接", login1.loginUrl.startsWith("https://liteapp.weixin.qq.com/"));
  await waitFor(() => (statusPollsByQr.get("qr-1") ?? 0) >= 1, "qr-1 开始轮询");
  await wechatClient.beginLogin(); // 第二次取码，旧轮询应停
  await waitFor(() => (statusPollsByQr.get("qr-2") ?? 0) >= 1, "qr-2 开始轮询");
  const qr1Polls = statusPollsByQr.get("qr-1") ?? 0;
  await sleep(3500); // 两个轮询周期
  check("重复取码后旧二维码轮询停止", (statusPollsByQr.get("qr-1") ?? 0) === qr1Polls,
    `qr-1 轮询数 ${statusPollsByQr.get("qr-1")} != ${qr1Polls}`);
  check("新二维码轮询仍在跑", (statusPollsByQr.get("qr-2") ?? 0) > 1);

  // ====== 场景 2：扫码确认 → 长轮询；游标在处理完成后才提交 ======
  let pollDeferred = null;
  const pollWaiters = [];
  routes.set("getupdates", (_u, init) => {
    pollDeferred = deferred(init.signal);
    for (const w of pollWaiters.splice(0)) w();
    return pollDeferred.promise;
  });
  const nextPoll = () => new Promise((res) => pollWaiters.push(res));

  const received = [];
  let handlerGate = null; // handler 挂起点，验证游标提交顺序
  wechatClient.setMessageHandler(async (msg) => {
    received.push(msg);
    if (handlerGate) await handlerGate.promise;
  });

  routes.set("get_qrcode_status", () => ({
    json: { status: "confirmed", bot_token: "tok-smoke-1", baseurl: "https://ilinkai.weixin.qq.com" },
  }));
  const firstPollArrived = nextPoll();
  await waitFor(() => wechatClient.getStatus().state === "logged_in", "扫码确认后进入 logged_in");
  check("扫码确认后状态 logged_in", wechatClient.getStatus().state === "logged_in");
  check("token 已落盘", getWechatConfig().botToken === "tok-smoke-1");
  await firstPollArrived;

  handlerGate = deferred();
  const secondPollArrived = nextPoll();
  pollDeferred.resolve({
    json: {
      ret: 0,
      get_updates_buf: "cursor-1",
      msgs: [{ from_user_id: "u1@im.wechat", message_type: 1, context_token: "ctx-1", item_list: [{ type: 1, text_item: { text: "hello" } }] }],
    },
  });
  await waitFor(() => received.length === 1, "handler 收到消息");
  await sleep(150); // handler 还挂着，游标不应已提交
  check("游标在 handler 完成前不提交", getWechatConfig().getUpdatesBuf !== "cursor-1");
  handlerGate.resolve();
  handlerGate = null;
  await waitFor(() => getWechatConfig().getUpdatesBuf === "cursor-1", "handler 完成后游标提交");
  check("游标在 handler 完成后提交", true);
  check("入站消息字段解析正确", received[0].text === "hello" && received[0].contextToken === "ctx-1");

  // ====== 场景 3：context_token 去重 ======
  await secondPollArrived;
  const thirdPollArrived = nextPoll();
  pollDeferred.resolve({
    json: {
      ret: 0,
      get_updates_buf: "cursor-2",
      msgs: [{ from_user_id: "u1@im.wechat", message_type: 1, context_token: "ctx-1", item_list: [{ type: 1, text_item: { text: "hello" } }] }],
    },
  });
  await waitFor(() => getWechatConfig().getUpdatesBuf === "cursor-2", "重复消息后游标仍推进");
  check("重复 context_token 不重复进 handler", received.length === 1, `handler 收到 ${received.length} 条`);

  // ====== 场景 7（提前在此测发送，复用 logged_in 状态）：sendReply ======
  const sentBodies = [];
  routes.set("sendmessage", (_u, init) => {
    sentBodies.push(JSON.parse(init.body));
    return { json: {} };
  });
  await wechatClient.sendReply("u1@im.wechat", "ctx-1", "回复你");
  const sentMsg = sentBodies[0]?.msg;
  check("sendReply 带 client_id", typeof sentMsg?.client_id === "string" && sentMsg.client_id.length > 10);
  check("sendReply 带 context_token", sentMsg?.context_token === "ctx-1");
  await wechatClient.sendReply("u1@im.wechat", "ctx-1", "再回复");
  check("client_id 每条唯一", sentBodies[0].msg.client_id !== sentBodies[1].msg.client_id);
  routes.set("sendmessage", () => ({ json: { errcode: -14, errmsg: "session timeout" } }));
  let sendErr = null;
  try {
    await wechatClient.sendReply("u1@im.wechat", "ctx-1", "应失败");
  } catch (e) {
    sendErr = e;
  }
  check("sendmessage -14 抛错", sendErr !== null);
  check("sendmessage -14 后状态 error", wechatClient.getStatus().state === "error");

  // ====== 场景 5：start() 重启恢复（从已存游标继续） ======
  routes.set("sendmessage", () => ({ json: {} }));
  const resumePollArrived = nextPoll();
  wechatClient.start();
  await resumePollArrived;
  const resumeCall = calls.filter((c) => c.url.includes("getupdates")).at(-1);
  check("重启恢复从已存游标继续", resumeCall.body.get_updates_buf === "cursor-2",
    `游标 ${resumeCall.body.get_updates_buf}`);
  check("恢复后状态 logged_in", wechatClient.getStatus().state === "logged_in");

  // ====== 场景 4：getupdates -14 → error + 循环退出 ======
  const pollsBefore14 = calls.filter((c) => c.url.includes("getupdates")).length;
  pollDeferred.resolve({ json: { ret: -14, errmsg: "session timeout" } });
  await waitFor(() => wechatClient.getStatus().state === "error", "-14 后进入 error");
  await sleep(500);
  check("getupdates -14 后循环退出", calls.filter((c) => c.url.includes("getupdates")).length === pollsBefore14);

  // ====== 场景 6：stop() 主动中止在途长轮询 ======
  const stopPollArrived = nextPoll();
  wechatClient.start();
  await stopPollArrived;
  const cursorBeforeStop = getWechatConfig().getUpdatesBuf;
  let abortedSeen = false;
  pollDeferred.promise.catch((e) => {
    if (e?.name === "AbortError") abortedSeen = true;
  });
  wechatClient.stop();
  await waitFor(() => abortedSeen, "stop 中止在途请求");
  check("stop 中止在途长轮询请求", abortedSeen);
  check("stop 后状态 idle", wechatClient.getStatus().state === "idle");
  await sleep(300);
  check("stop 后不再写游标", getWechatConfig().getUpdatesBuf === cursorBeforeStop);
} finally {
  wechatClient.stop();
  globalThis.fetch = realFetch;
  // 恢复真实配置，不让 smoke 污染本机微信接入
  if (originalConfig !== null) writeFileSync(CONFIG_PATH, originalConfig, "utf8");
  else if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
}

console.log(`\nwechat-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
