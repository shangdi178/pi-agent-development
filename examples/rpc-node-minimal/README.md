# rpc-node-minimal —— 零依赖 RPC 最小客户端

单个 `index.js`（Node 原生模块，零 npm 依赖）演示通过 RPC mode 与 Pi 对话的最少代码：启动 `pi --mode rpc` 子进程，按 JSONL 协议收发消息，流式渲染回复。

## 文件结构

```
rpc-node-minimal/
├── index.js      # 全部逻辑（约 100 行）
└── package.json  # 无任何依赖
```

## 运行方式

```bash
# 前置：本机已安装 pi 命令（pi --version 可用）
node index.js
node index.js "用中文列出当前目录的文件"   # 可选：自定义消息
```

运行中按 `Ctrl+C`：第一次发送 `abort` 命令让 Pi 优雅中止当前回合，第二次强制退出。

## 协议要点（为什么代码长这样）

| 要点 | 说明 |
| --- | --- |
| **LF 分帧** | 协议是严格 JSONL，`\n` 是唯一记录分隔符。必须自己按 `\n` 切行（本示例用 `StringDecoder` 处理多字节边界）。 |
| **readline 不兼容** | Node 内置 `readline` 会把 U+2028 / U+2029 也当作换行，而这两个字符在 JSON 字符串内合法，会切坏消息——所以禁止用它读 RPC 流。 |
| **成功接受 ≠ 完成** | `prompt` 的 `response.success:true` 只表示命令"已被接受/排队"；之后的成败只通过事件流上报（`message_end` / `agent_end`），不会再有第二个 response。 |
| **流式要自己拼** | `message_update` 故意不带累计字段，客户端用 `text_delta` 拼装实时内容，最终以 `message_end.message`（权威完整对象）为准。 |
| **回合生命周期** | `agent_start` → `turn_start` → `message_start` → `message_update*` → `message_end` → `turn_end` → `agent_end`；收到 `agent_end` 即回合结束。 |

## 责任边界

| 谁 | 负责什么 |
| --- | --- |
| **Pi（--mode rpc 进程）** | Agent Runtime（模型调用、回合调度）、Session Manager（会话文件、分支、压缩）、Tool Registry 与工具执行、消息生命周期（message/turn/agent 事件）。 |
| **本客户端** | 消息收发（JSONL 分帧、命令写入 stdin、事件读取 stdout）、流式文本渲染、中止请求（abort）、进程生命周期（spawn/退出）。 |
| **边界规则** | 客户端只当"终端"：不缓存会话状态、不自己实现会话文件、不拼装上下文；一切状态以 Pi 的事件流与 `get_state` / `get_messages` 查询为准。 |
