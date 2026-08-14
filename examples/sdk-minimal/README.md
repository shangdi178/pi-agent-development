# sdk-minimal —— 内嵌 Pi SDK 的最小示例

单个 `index.mjs` 证明：在 Node 进程内嵌 Pi SDK 与 agent 对话，最少只需要四个步骤——创建 `ModelRuntime`、用 `SessionManager.inMemory()` 建会话、`subscribe` 打印流式文本、`session.prompt(...)`。

## 文件结构

```
sdk-minimal/
├── index.mjs     # 全部逻辑（约 30 行）
└── package.json  # 唯一依赖：@earendil-works/pi-coding-agent
```

## 运行方式

```bash
# 前置：npm install（拉取 SDK 依赖；SDK 内部会读取 ~/.pi/agent 的认证配置）
npm install
node index.mjs
node index.mjs "用中文列出当前目录的文件"   # 可选：自定义消息
```

## 与 RPC 示例的区别

| | rpc-node-minimal | sdk-minimal |
| --- | --- | --- |
| 形态 | 外部进程，通过 stdin/stdout JSONL 对话 | 同进程内嵌，直接调用 API |
| 依赖 | 零依赖 | 一个 npm 包 |
| 会话 | 由 RPC 进程管理 | 由 SDK 的 SessionManager 管理 |
| 适用 | 服务器、Web UI 等"包装/转发"集成 | 需要直接控制运行时逻辑的应用 |

## 责任边界

| 谁 | 负责什么 |
| --- | --- |
| **Pi runtime（SDK）** | 会话生命周期：会话文件（`SessionManager`）、消息追加、分支、压缩、事件订阅分发；模型运行时（`ModelRuntime`：发现、认证、调用、usage）。 |
| **本示例代码** | 创建运行时与会话（`inMemory()` 不落盘）、订阅事件并渲染、发起 prompt、退出进程。 |
| **边界规则** | 不要自己实现第二套会话（不要手写消息列表、不自己拼 LLM 上下文、不做文件持久化）——`SessionManager` 已提供树结构、分支与压缩；不要直接调用模型 API 绕过 `ModelRuntime`（会丢掉 usage 统计、缓存与认证处理）。 |

> 会话切换提示：`newSession()` / `switchSession()` 会替换活动会话，**替换后旧的事件订阅失效**，必须对 `runtime.session` 重新 `subscribe` 并重绑扩展。
