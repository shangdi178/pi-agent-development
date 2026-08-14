#!/usr/bin/env node
// 最小 RPC 客户端：通过 stdin/stdout JSONL 与 pi --mode rpc 对话。
// 零 npm 依赖，只用 Node 原生模块（child_process + string_decoder）。
// 只做五件事：发 prompt、拼装流式文本、打印最终消息、遇 agent_end 退出、SIGINT 发 abort。
"use strict";

const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

// ---------------------------------------------------------------------------
// JSONL 分帧器：LF 是协议里唯一的记录分隔符。
// 注意：不能用 Node 的 readline —— 它把 U+2028 / U+2029 也当作换行，
// 而这两个字符在 JSON 字符串内合法，会切坏消息。
// ---------------------------------------------------------------------------
function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1); // 输入侧可容忍 \r\n，输出一律 LF
      onLine(line);
    }
  });
  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  });
}

// ---------------------------------------------------------------------------
// 启动 pi RPC 进程（--no-session：纯内存，适合一次性交互）
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

// pi 的 stderr 与退出码转发到本进程 stderr，便于排查
agent.stderr.on("data", (d) => process.stderr.write(`[pi stderr] ${d}`));
agent.on("exit", (code) => {
  console.error(`[pi 已退出，code=${code}]`);
  process.exit(code ?? 0);
});

let streamedText = ""; // 当前消息的流式拼装；message_end 后以权威消息为准

attachJsonlReader(agent.stdout, (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return; // 非 JSON 行（理论上不应出现），忽略
  }

  switch (event.type) {
    case "response": {
      // 关键语义：success:true 只表示命令"已被接受/排队"，不代表回合完成。
      if (event.success) {
        console.log(`[已接受] ${event.command}`);
      } else {
        console.error(`[命令失败] ${event.command}: ${event.error ?? "未知错误"}`);
      }
      break;
    }
    case "message_start": {
      streamedText = "";
      break;
    }
    case "message_update": {
      // message_update 故意不带累计字段，客户端自己用 delta 拼装
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") {
        streamedText += e.delta;
        process.stdout.write(e.delta); // 流式打印
      }
      // thinking_delta 等其它 delta 类型，最小示例从略
      break;
    }
    case "message_end": {
      // message_end.message 是权威完整对象，用它覆盖流式拼装结果
      const text = (event.message.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text !== streamedText) {
        process.stdout.write(`\n[流式拼装与权威消息不一致，以 message_end 为准]\n${text}`);
      }
      console.log(`\n[消息完成] stopReason=${event.message.stopReason ?? "?"}`);
      break;
    }
    case "agent_end": {
      console.log("[回合结束]");
      process.exit(0);
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// 发 prompt（支持命令行参数传入消息）
// ---------------------------------------------------------------------------
const message = process.argv[2] ?? "Hello, 用一句话介绍你自己";
agent.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");

// ---------------------------------------------------------------------------
// SIGINT：向 pi 发 abort，而不是直接杀死进程（让 pi 有机会优雅中止）
// ---------------------------------------------------------------------------
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) {
    agent.kill(); // 第二次 Ctrl+C 强制退出
    return;
  }
  interrupted = true;
  console.error("\n[中止请求已发送]");
  agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
});
