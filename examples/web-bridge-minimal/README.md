# web-bridge-minimal —— Browser ↔ Adapter ↔ Pi RPC 技术示范

浏览器 ↔ 薄适配服务器 ↔ Pi RPC 的**通用技术示范**（不是 Web 产品，不含任何业务逻辑）。
演示一条最小但完整的链路：浏览器页面通过 SSE 订阅事件、通过 HTTP POST 发命令；
适配服务器只做"传输翻译"，在浏览器与 `pi --mode rpc` 进程之间搬运 JSONL。

## 文件结构

```
web-bridge-minimal/
├── server.js    # Node 原生 http 服务器（零依赖）：SSE 端点 + 命令端点 + 静态页
├── index.html   # 纯静态页面（无框架）：EventSource + fetch + 流式渲染
└── package.json # 无任何依赖
```

## 运行方式

```bash
# 前置：本机已安装 pi 命令
node server.js
# 浏览器打开 http://localhost:8080
```

## 架构图

```
┌──────────┐   SSE /events (EventSource)   ┌────────────────┐  stdin/stdout JSONL  ┌──────────────┐
│  Browser │ ────────────────────────────► │ Adapter Server │ ───────────────────► │ pi --mode rpc│
│ (无框架) │ ◄──────────────────────────── │  (Node http)   │ ◄─────────────────── │              │
└──────────┘   POST /command (JSON 命令)   └────────────────┘    LF 分帧 JSONL     └──────────────┘
```

```
Browser → SSE/HTTP → Adapter Server → Pi RPC JSONL → pi --mode rpc
```

## 责任边界

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| **Pi（--mode rpc）** | Agent Runtime（模型调用、回合调度）；Session Authority（会话文件、分支、压缩、`get_state`/`get_messages` 权威状态）；Tool Runtime（内置工具执行）；Message Lifecycle（message/turn/agent 事件、流式 delta、abort 语义）。 | 无——一切智能与状态都在这层。 |
| **Adapter Server** | Transport Translation（SSE ↔ JSONL、HTTP ↔ stdin）；RPC 进程管理（spawn、重启、退出广播）；Event Forwarding（Pi 事件原样转发，**不解析、不修改**）。 | 不持有会话状态、不缓存消息、不拼 LLM 上下文、不做回合状态机——否则它就成了第二个 Agent Backend。 |
| **Browser** | State Projection（把 Pi 事件渲染成界面，`message_end` 权威覆盖流式拼装）；User Interaction（输入、发送、停止、显示连接状态）。 | 不实现任何 agent 逻辑；刷新页面不丢会话状态（会话在 pi 进程里）。 |

## 完整事件流程

```
用户输入 ──POST /command {type:"prompt", message}──►
    [pi] response(success:true)              → 浏览器显示"[命令已接受]（不代表完成）"
    [pi] message_start                        → 浏览器开启新消息块
    [pi] message_update(text_delta)*          → 浏览器流式追加（thinking_delta 单独灰色区）
    [pi] tool_execution_start/end（若调用）   → 浏览器显示工具调用行
    [pi] message_end {message}                → 浏览器以权威完整消息覆盖流式拼装
    [pi] agent_end / agent_settled            → 浏览器标记"回合结束"，解锁输入
```

## 各机制如何工作

| 机制 | 实现 |
| --- | --- |
| **abort** | 浏览器"停止"按钮 → `POST /command {type:"abort"}` → 服务器原样写入 pi stdin。中止由 Pi 优雅执行（不是掐断连接）；回合随之以 `message_end(stopReason=aborted)` + `agent_end` 收尾。 |
| **error** | 三类错误都可见：命令失败（`response.success:false`，浏览器显示原因）；Pi stderr（服务器转成 `pi_stderr` SSE 事件）；Pi 进程退出/无法启动（服务器转成 `pi_close` SSE 事件并广播给所有订阅者）。 |
| **session state** | 会话权威状态在 Pi 进程内（本示范用 `--no-session` 纯内存）。浏览器与服务器都不保存状态副本；需要时浏览器可通过命令端点发 `get_state` / `get_messages` 查询，Pi 的 `response.data` 原样回流。 |
| **reconnect** | EventSource 断线（服务器重启、网络抖动）会自动重连（服务器下发 `retry: 2000`）。浏览器 `onerror` 仅显示"重连中…"；Pi 事件流是只读广播，重连后不会漏掉 Pi 内部状态（需要的话用 `get_state` 补齐投影）。 |
| **streaming delta 合并** | `message_update` 不带累计字段，浏览器自己用 `text_delta` 拼接；`message_end.message` 是权威完整对象，两者不一致时以后者覆盖——与"成功接受 ≠ 完成"同理，界面上的"事实"永远以终态事件为准。 |

## ⚠️ 架构红线

**Adapter Server 不得逐渐变成第二个 Agent Backend。**

它只是管道：转发命令、转发事件、管进程。一旦开始在里面缓存会话、改写消息、拼上下文、
做重试/排队状态机，就同时在维护"第二份真相"——两份状态必然漂移，最终你会被迫去实现
Pi 已有的 Session Manager 与 Agent Runtime（这正是本示例要证明"不需要"的东西）。
需要任何"服务端逻辑"时，正确做法是：让 Pi 做（扩展、工具、SDK 内嵌），而不是在管道里做。
