// 浏览器 ↔ 薄适配服务器 ↔ Pi RPC 的通用技术示范（不是 Web 产品，零 npm 依赖）。
// 服务器只是"传输管道"：
//   - Pi 的 stdout JSONL → SSE 事件（/events，浏览器 EventSource 订阅）
//   - 浏览器的 JSON 命令 → Pi stdin（/command，POST）
// 警告：它是管道，不是后端 —— 不得逐渐变成第二个 Agent Backend（不缓存会话、不拼上下文、不做状态机）。
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

const PORT = 8080;
const INDEX_HTML = path.join(__dirname, "index.html");

// ---------------------------------------------------------------------------
// 1. Pi RPC 子进程（一个进程 = 一个活动会话；切换会话用 switch_session/new_session，
//    仅需多会话并行执行时才需要多个进程）。本示范用 --no-session 纯内存。
// Windows 下 pi 是 npm 安装的 .cmd shim，Node 的 spawn 不能直接执行 .cmd，
// 需经 cmd.exe 执行；其它平台直接 spawn。参数为代码内固定值，拼接无注入风险。
// ---------------------------------------------------------------------------
function spawnPi(args) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/c", "pi " + args.join(" ")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  return spawn("pi", args, { stdio: ["pipe", "pipe", "pipe"] });
}

const agent = spawnPi(["--mode", "rpc", "--no-session"]);

// ---------------------------------------------------------------------------
// 2. SSE 客户端集合（一个浏览器标签页 = 一个连接；多个订阅互不干扰）
// ---------------------------------------------------------------------------
const sseClients = new Set();

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. JSONL 分帧器：LF 是协议里唯一记录分隔符（不能用 readline）。
//    每一行 JSON 事件原样转发为 SSE 事件 pi_event —— 服务器不解析、不修改事件内容。
// ---------------------------------------------------------------------------
const decoder = new StringDecoder("utf8");
let buffer = "";
agent.stdout.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  while (true) {
    const nl = buffer.indexOf("\n");
    if (nl === -1) break;
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!clean) continue;
    try {
      broadcast("pi_event", JSON.parse(clean));
    } catch (err) {
      // 坏帧也转发（含原始文本），保证浏览器侧可见
      broadcast("pi_event", { type: "parse_error", error: err.message, raw: clean });
    }
  }
});

// stderr 与进程退出同样转发给浏览器，让错误可见
agent.stderr.on("data", (d) => broadcast("pi_stderr", { text: d.toString() }));
agent.on("error", (err) => {
  console.error(`无法启动 pi：${err.message}（请确认已安装 pi 命令）`);
  broadcast("pi_close", { code: -1, error: err.message });
  shutdown();
});
agent.on("exit", (code) => {
  broadcast("pi_close", { code });
  for (const res of sseClients) {
    try {
      res.end();
    } catch { /* 已断开 */ }
  }
  sseClients.clear();
});

// 浏览器命令 → pi stdin：原样转发，只负责补上 LF 分帧（abort 等命令无需特殊处理）
function sendCommand(cmd) {
  agent.stdin.write(JSON.stringify(cmd) + "\n");
}

// ---------------------------------------------------------------------------
// 4. HTTP 服务器
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // CORS 默认放开，便于从其它端口单独调试页面
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // (a) SSE 端点：浏览器 EventSource 订阅 Pi 事件流
  if (req.method === "GET" && (req.url === "/events" || req.url === "/events/")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n"); // 断线后 EventSource 2 秒自动重连
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // (b) 命令端点：浏览器 POST JSON 命令 → pi stdin
  if (req.method === "POST" && req.url === "/command") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy(); // 防滥用
    });
    req.on("end", () => {
      try {
        const cmd = JSON.parse(body);
        sendCommand(cmd);
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true, type: cmd.type }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: false, error: err.message }));
      }
    });
    return;
  }

  // (c) 静态文件：本示范只服务 index.html
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    fs.readFile(INDEX_HTML, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("无法读取 index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

function shutdown() {
  try {
    agent.kill();
  } catch { /* 已退出 */ }
  server.close();
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`Pi Bridge 示范服务器已启动：http://localhost:${PORT}`);
  console.log(`Pi RPC 子进程 pid=${agent.pid}（pi --mode rpc --no-session）`);
});
