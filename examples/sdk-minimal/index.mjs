// 最小 SDK 示例：在 Node 进程内嵌 Pi SDK，与 agent 对话。
// 证明内嵌集成最少需要：一个 modelRuntime + 一个 inMemory 会话 + 一个 subscribe + 一次 prompt。
// 会话生命周期（文件、分支、压缩）全部归 Pi runtime，这里不实现第二套会话。
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// 1. 模型运行时：Pi 负责模型发现、认证与调用
const modelRuntime = await ModelRuntime.create();

// 2. 创建会话：SessionManager.inMemory() 不落盘（无会话文件，getSessionFile() 为 undefined）
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

// 3. 订阅事件：打印流式文本（message_update 的 text_delta）
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

// 4. 发 prompt（自动流式；支持命令行参数传入消息）
const message = process.argv[2] ?? "用一句话介绍你自己";
await session.prompt(message);
process.stdout.write("\n");

// 显式退出：SDK 内部可能持有未关闭的句柄（模型客户端等）
process.exit(0);
