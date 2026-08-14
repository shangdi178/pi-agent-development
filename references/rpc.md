---
source: https://pi.dev/docs/latest/rpc
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# RPC Mode 集成参考（程序化集成：服务器 / Web UI / CLI 包装）

> 适用对象：需要以独立进程方式把 Pi Agent 接入服务器、Web UI、CLI 的开发者。
>
> 事实等级：✅ OFFICIAL（官方文档明确说明） / ⚠️ INFERENCE（由官方 API/源码/行为推导） / 🧪 PRACTICE（工程实践建议）。

## 1. 启动与参数

```bash
pi --mode rpc [options]
```

| 参数 | 说明 |
|---|---|
| `--provider <name>` | 指定 LLM 提供商（anthropic / openai / google 等） |
| `--model <pattern>` | 模型 pattern 或 ID，支持 `provider/id` 与可选 `:<thinking>` 后缀 |
| `--name <name>` / `-n <name>` | 启动时设置会话显示名（等价于 set_session_name） |
| `--no-session` | 禁用会话持久化（纯内存，适合一次性交互） |
| `--session-dir <path>` | 自定义会话存储目录（默认 `~/.pi/agent/sessions`） |

架构：stdin 收命令（每行一个 JSON），stdout 出响应与事件（JSON Lines）。⚠️ INFERENCE：一个 RPC 进程任一时刻只有一个**活动会话**；但多个**已保存**会话不需要多个进程——通过 `switch_session`/`new_session` 在进程内切换即可。只有需要多个会话**同时活动（并行执行）**时，才需要多个 RPC 进程。

## 2. 协议与分帧（务必遵守）

- 严格 JSONL，**LF（`\n`）是唯一记录分隔符**。✅ OFFICIAL
- 输入可接受 `\r\n`（剥掉行尾 `\r`）；输出一律 LF。
- 所有命令支持可选 `id` 字段用于请求/响应关联；响应原样带回该 `id`；`bash_execution_update` 事件也带发起命令的 `id`。
- ⚠️ INFERENCE：**Node 的 `readline` 不兼容 RPC 协议**——它会把 U+2028 / U+2029 也当作换行，而这两个字符在 JSON 字符串内是合法的。必须自己按 `\n` 切行（见 §6 StringDecoder 实现）。
- 响应类型为 `{"type": "response"}`，无论成功失败；事件类型为其余字符串。

## 3. 完整命令清单（含参数与响应要点）

**会话控制**

- `prompt` — 发送用户消息；可带 `images: [{type:"image", data:<base64>, mimeType}]`。
  流式进行中必须带 `streamingBehavior`：`"steer"`（排队，当前回合工具调用结束后、下次 LLM 调用前投递）或 `"followUp"`（agent 停止后才投递）；流式且未指定则报错。`/command` 扩展命令在流式中立即执行；`/skill:name` 与 `/template` 在发送/排队前展开。
  ```json
  {"id":"req-1","type":"prompt","message":"Hello, world!"}
  // → {"id":"req-1","type":"response","command":"prompt","success":true}
  ```
  注意：响应只表示"已接受/排队/立即处理"；接受之后的失败通过事件/消息上报，不会再来第二个 response。
- `steer` `{message, images?}` — 流式中插入指令（无工具调用队列语义）。
- `follow_up` `{message, images?}` — 仅当 agent 无更多工具调用/steer 消息时投递。
- `abort` — 中止当前回合。`abort_retry` — 中止自动重试。
- `new_session` `{parentSession?: "/path/to/parent.jsonl"}` — 开新会话；响应 `data.cancelled` 为 `true` 表示被 `session_before_switch` 扩展钩子取消。
- `switch_session` `{sessionPath}` — 切换到已保存的会话文件；响应同样带 `data.cancelled`。
- `fork` `{entryId}` — 从活动分支的某个历史用户消息处开新分支（可被 `session_before_fork` 取消）；响应 `data.text` 为被 fork 的原始消息文本。
- `clone` — 把当前活动分支复制为新会话（保持当前位置）；响应 `data.cancelled`。
- `set_session_name` `{name}` — 设置/清除显示名；当前值经 `get_state.sessionName` 读取。
- `compact` `{customInstructions?}` — 手动压缩；响应返回摘要数据（见 `compaction.md`）。

**状态查询**

- `get_state` → `data`: `{model, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, sessionFile, sessionId, sessionName?, autoCompactionEnabled, messageCount, pendingMessageCount}`。**`sessionId` 是会话身份权威来源。**
- `get_messages` → `data.messages: AgentMessage[]`（仅当前分支、压缩后视角的消息）。
- `get_entries` `{since?: entryId}` → `data: {entries, leafId}`；**追加序、含压缩前历史与废弃分支**；entry id 稳定，可作持久游标（`since` 不匹配则 `success:false`）。⚠️ INFERENCE：与 `get_messages` 不同——`get_entries` 不应用压缩视角。
- `get_tree` → 完整树：`[{entry, children:[...]}]` + `leafId`。
- `get_fork_messages` → `data.messages: [{entryId, text}]`（可 fork 的历史用户消息列表）。
- `get_last_assistant_text` → `data.text`（无助手消息时为 `null`）。
- `get_session_stats` → 计数、token/成本、`contextUsage: {tokens, contextWindow, percent}`；压缩后 `tokens/percent` 为 `null` 直到下一次助手响应产生 usage 数据。
- `get_available_models` / `get_available_thinking_levels` → `data.models` / `data.levels`。
- `get_commands` → 可用命令清单（内置 + 扩展 + prompt 文件）。

**模型与行为设置**

- `set_model` `{provider, modelId}` — 响应 `data` 含完整 Model 对象；失败示例：`{"type":"response","command":"set_model","success":false,"error":"Model not found: invalid/model"}`。
- `cycle_model` — 轮换模型；响应 `data: {model, thinkingLevel, isScoped}`（仅一个模型时为 `null`）。
- `set_thinking_level` `{level}` — `"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"`（`xhigh`/`max` 仅在模型支持时可用）；`cycle_thinking_level` 返回 `data.level`。
- `set_steering_mode` `{mode: "all"|"one-at-a-time"}`、`set_follow_up_mode` `{mode: "all"|"one-at-a-time"}`。
- `set_auto_compaction` `{enabled}` / `set_auto_retry` `{enabled}`。
- `export_html` `{outputPath?}` → `data.path`（导出 HTML 会话视图）。

**Bash（宿主工具）**

- `bash` `{id?, command}` — 立即执行，输出边跑边以 `bash_execution_update` 事件流式返回；响应带最终结果 `{output, exitCode, cancelled, truncated}`；截断时附带 `fullOutputPath`（完整日志落盘路径）。
  ⚠️ INFERENCE：bash 结果**不会立刻进 LLM 上下文**：内部存为 `BashExecutionMessage`，在下一次 prompt 时转成 `UserMessage`（`Ran \`cmd\`\n```\noutput\n```\n`）。因此可先连续跑多个 bash 再 prompt，全部输出会一并进入上下文。
- `abort_bash` — 中止正在运行的 bash。

## 4. 流式事件（stdout）

回合生命周期：`agent_start` → `turn_start` → `message_start` → `message_update`* → `message_end` → `turn_end` → `agent_settled` / `agent_end`。

| 事件 | 说明 |
|---|---|
| `agent_start` / `agent_end` / `agent_settled` | agent 级生命周期。`agent_end` = 底层 run 结束（但 pi 仍可能重试/压缩/续跑排队 follow-up）；`agent_settled` = **无重试、无压缩、无续跑**时触发（= idle，完整定义见 `extensions.md` §5） |
| `turn_start` / `turn_end` | 单次助手回合 |
| `message_start` `{message}` | 助手消息开始（`message` 为部分对象） |
| `message_update` | 增量更新；`assistantMessageEvent` 为 delta（见下），另带 `usage` 字段 |
| `message_end` `{message}` | 消息完成，**`message` 为权威完整对象** |
| `bash_execution_update` | bash 输出流，带发起 `id` |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | 工具执行；**用 `toolCallId` 关联** |
| `queue_update` | 排队中的 steer/follow_up 变化 |
| `compaction_start` / `compaction_end` | 压缩过程 |
| `auto_retry_start` / `auto_retry_end` | 自动重试 |
| `extension_error` | 扩展运行错误 |

`assistantMessageEvent` 的 delta 类型：`text_start` / `text_delta` / `text_end`、`thinking_start` / `thinking_delta` / `thinking_end`、`toolcall_start` / `toolcall_delta` / `toolcall_end`。

```json
{
  "type": "message_update",
  "usage": {"input": 100, "output": 1, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 101,
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}},
  "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "Hello "}
}
```

⚠️ INFERENCE：`message_update` **故意省略了累计 message 字段**——客户端应自行用 `message_start` + 各 delta 拼装实时内容，以 `message_end.message` 为准。

## 5. 错误处理

- 命令失败：`{"type":"response","command":"<cmd>","success":false,"error":"<原因>"}`。
- 解析失败：`command` 为 `"parse"`，例如 `{"type":"response","command":"parse","success":false,"error":"Failed to parse command: Unexpected token..."}`。
- `switch_session` / `new_session` / `fork` / `clone` 被扩展钩子取消时：`success:true` 且 `data.cancelled:true`。
- 命令被接受后的失败走事件/消息通道，不再有第二个 response —— 集成方需监听消息流判断最终结果。

## 6. 最小实现（Node，协议合规的 JSONL 读取器）

```javascript
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");

const agent = spawn("pi", ["--mode", "rpc", "--no-session"]);

// 协议合规的 JSONL 读取器（readline 不兼容！）
function attachJsonlReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      onLine(line);
    }
  });
  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  });
}

attachJsonlReader(agent.stdout, (line) => {
  const event = JSON.parse(line);
  if (event.type === "message_update") {
    const { assistantMessageEvent } = event;
    if (assistantMessageEvent.type === "text_delta") process.stdout.write(assistantMessageEvent.delta);
  }
  if (event.type === "agent_end") process.exit(0);
});

agent.stdin.write(JSON.stringify({ type: "prompt", message: "Hello" }) + "\n");
process.on("SIGINT", () => agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n"));
```

官方另有 Python 版示例（`subprocess.Popen` + 逐行读 stdout，遇 `agent_end` 断开）；RPC 客户端类型定义见源码 `src/modes/rpc/rpc-client.ts`。

## 7. 集成要点（坑）

1. **接受 ≠ 完成**：`prompt` 的 `success:true` 只是接受/排队；最终成败靠事件流（`agent_end`/`agent_settled`）判断。流式中发 prompt 必须带 `streamingBehavior`，否则直接报错。
2. **流式渲染必须自己拼**：`message_update` 无累计字段；以 `message_start` + deltas 拼装，`message_end.message` 为准；工具事件用 `toolCallId` 关联。
3. **readline 坑**：Node `readline` 会误切 U+2028/U+2029，必须用自写 `\n` 分帧器（§6）。
4. **bash 结果延迟进上下文**：bash 命令输出在下次 prompt 才作为用户消息进入 LLM 上下文；`get_messages` 里是 `bashExecution` 角色，与 `toolResult` 区分。
5. **单进程单活动会话**：⚠️ INFERENCE——RPC 进程任一时刻只有一个活动会话；多个已保存会话**无需多个进程**（`switch_session`/`new_session` 切换即可）；仅当需要多个会话同时活动/并行执行时才用多进程。
6. **`get_messages` vs `get_entries` 视角不同**：前者已应用压缩，后者是完整追加历史（含废弃分支），别混用。

> 相关：会话文件格式见 `sessions.md`；压缩机制见 `compaction.md`；SDK 内嵌见 `sdk.md`。
