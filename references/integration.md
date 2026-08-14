# Pi Agent 程序化集成开发手册（RPC / SDK / Session Format / Compaction）

> 适用对象：服务器、Web UI、CLI 包装等"程序化集成"开发者。
> 本文档为官方文档的蒸馏参考手册，非搬运；标注 ⚠️ 的条目为文档中未明示、但实践中必须注意的推论。
>
> 官方文档来源：
> - RPC Mode: https://pi.dev/docs/latest/rpc
> - SDK: https://pi.dev/docs/latest/sdk
> - Session Format: https://pi.dev/docs/latest/session-format
> - Compaction: https://pi.dev/docs/latest/compaction

---

## 1. RPC Mode（进程内 JSONL 协议）

### 1.1 启动与参数

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

架构：stdin 收命令（每行一个 JSON），stdout 出响应与事件（JSON Lines）。一个 RPC 进程同时只有一个活动会话。

### 1.2 协议与分帧（务必遵守）

- 严格 JSONL，**LF（`\n`）是唯一记录分隔符**。
- 输入可接受 `\r\n`（剥掉行尾 `\r`）；输出一律 LF。
- 所有命令支持可选 `id` 字段用于请求/响应关联；响应原样带回该 `id`；`bash_execution_update` 事件也带发起命令的 `id`。
- ⚠️ **Node 的 `readline` 不兼容 RPC 协议**：它会把 U+2028 / U+2029 也当作换行，而这两个字符在 JSON 字符串内是合法的。必须自己按 `\n` 切行（见 1.6 的 StringDecoder 实现）。
- 响应类型为 `{"type": "response"}`，无论成功失败；事件类型为其余字符串。

### 1.3 完整命令清单（含参数与响应要点）

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
- `compact` `{customInstructions?}` — 手动压缩；响应返回摘要数据（见 §4）。

**状态查询**

- `get_state` → `data`: `{model, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, sessionFile, sessionId, sessionName?, autoCompactionEnabled, messageCount, pendingMessageCount}`。
- `get_messages` → `data.messages: AgentMessage[]`（仅当前分支、压缩后视角的消息）。
- `get_entries` `{since?: entryId}` → `data: {entries, leafId}`；**追加序、含压缩前历史与废弃分支**；entry id 稳定，可作持久游标（`since` 不匹配则 `success:false`）。⚠️ 与 `get_messages` 不同：`get_entries` 不应用压缩视角。
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
  ⚠️ bash 结果**不会立刻进 LLM 上下文**：内部存为 `BashExecutionMessage`，在下一次 prompt 时转成 `UserMessage`（`Ran \`cmd\`\n```\noutput\n```\n`）。因此可先连续跑多个 bash 再 prompt，全部输出会一并进入上下文。
- `abort_bash` — 中止正在运行的 bash。

### 1.4 流式事件（stdout）

回合生命周期：`agent_start` → `turn_start` → `message_start` → `message_update`* → `message_end` → `turn_end` → `agent_settled` / `agent_end`。

| 事件 | 说明 |
|---|---|
| `agent_start` / `agent_end` / `agent_settled` | agent 级生命周期（settled = 无更多工具调用/steer） |
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

⚠️ `message_update` **故意省略了累计 message 字段**：客户端应自行用 `message_start` + 各 delta 拼装实时内容，以 `message_end.message` 为准。

### 1.5 错误处理

- 命令失败：`{"type":"response","command":"<cmd>","success":false,"error":"<原因>"}`。
- 解析失败：`command` 为 `"parse"`，例如 `{"type":"response","command":"parse","success":false,"error":"Failed to parse command: Unexpected token..."}`。
- `switch_session` / `new_session` / `fork` / `clone` 被扩展钩子取消时：`success:true` 且 `data.cancelled:true`。
- 命令被接受后的失败走事件/消息通道，不再有第二个 response —— 集成方需监听消息流判断最终结果。

### 1.6 最小对话流程（Node）

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

---

## 2. SDK（npm：`@earendil-works/pi-coding-agent`）

### 2.1 可导入的导出

```typescript
import {
  createAgentSession, createAgentSessionRuntime, AgentSessionRuntime,   // 工厂
  ModelRuntime, ModelRegistry, CredentialSynchronizationError,           // 模型/认证
  resolveCliModel, resolveModelScopeWithDiagnostics,
  DefaultResourceLoader, ResourceLoader, createEventBus,                 // 资源加载
  SessionManager, SettingsManager,                                       // 会话/设置
  createCodingTools, createReadOnlyTools, createReadTool, createBashTool, // 工具工厂
  createEditTool, createWriteTool, createGrepTool, createFindTool, createLsTool,
  CONFIG_DIR_NAME, defineTool, getAgentDir, getPackageDir, getReadmePath, // 辅助
  getDocsPath, getExamplesPath,
  CreateAgentSessionOptions, CreateAgentSessionResult, ExtensionFactory,  // 类型
  InlineExtension, ExtensionAPI, ToolDefinition, Skill, PromptTemplate, Tool,
} from "@earendil-works/pi-coding-agent";
```

### 2.2 createAgentSession() — 单个 AgentSession 的主工厂

```typescript
createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>
// 返回 { session, extensionsResult, modelFallbackMessage? }
```

关键选项：

| 选项 | 说明 |
|---|---|
| `model` / `thinkingLevel` / `scopedModels` / `modelRuntime` | 模型、思考等级（`"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"`）、轮换模型组、模型运行时 |
| `tools` | 内置工具白名单：`"read"|"bash"|"edit"|"write"|"grep"|"find"|"ls"`；默认 `["read","bash","edit","write"]` |
| `excludeTools` | 白名单之后再禁用指定工具 |
| `noTools` | `"all"` 全禁；`"builtin"` 禁默认工具但保留扩展/自定义工具 |
| `customTools` | `defineTool(...)` 定义的自定义工具；若传了 `tools`，须把自定义工具名也加入，如 `tools: ["read","bash","my_tool"]` |
| `resourceLoader` / `settingsManager` / `sessionManager` | 分别默认 `DefaultResourceLoader` / 各自默认实现 / 新建持久会话 |
| `cwd` / `agentDir` | 默认 `process.cwd()` / `~/.pi/agent` |

自定义工具示例（参数用 typebox 的 `Type`）：

```javascript
import { createAgentSession, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const myTool = defineTool({
  name: "my_tool", label: "My Tool", description: "Does something useful",
  parameters: Type.Object({ input: Type.String({ description: "Input value" }) }),
  execute: async (_toolCallId, params) => ({ content: [{ type: "text", text: `Result: ${params.input}` }], details: {} }),
});

const { session } = await createAgentSession({ customTools: [myTool], tools: ["read", "bash", "my_tool"] });
```

### 2.3 SessionManager — 会话文件管理器

静态工厂：

- `SessionManager.inMemory(cwd?)` — 无持久化
- `SessionManager.create(cwd, sessionDir?)` — 新建持久会话
- `SessionManager.continueRecent(cwd, sessionDir?)` — 继续最近会话，无则新建
- `SessionManager.open(path, sessionDir?)` — 打开指定 `.jsonl`
- `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)` — 从别的项目 fork
- `SessionManager.list(cwd, sessionDir?, onProgress?)` / `SessionManager.listAll(onProgress?)` — 列项目会话 / 全部会话

实例方法（打开后操作一棵追加树）：

- 会话管理：`newSession({ parentSession? })`、`setSessionFile(path)`（切换会话文件）、`createBranchedSession(leafId)`（把分支提取成新文件）
- **追加方法（全部返回新 entry 的 id）**：`appendMessage(message)`、`appendThinkingLevelChange(level)`、`appendModelChange(provider, modelId)`、`appendCompaction(summary, firstKeptEntryId, tokensBefore, details?, fromHook?)`、`appendCustomEntry(customType, data?)`（扩展状态，不进 LLM 上下文）、`appendSessionInfo(name)`、`appendCustomMessageEntry(customType, content, display, details?)`（扩展消息，进上下文）、`appendLabelChange(targetId, label)`
- 树导航：`getLeafId()`、`getLeafEntry()`、`getEntry(id)`、`getBranch(fromId?)`、`getTree()`、`getChildren(parentId)`、`getLabel(id)`、`branch(entryId)`（把 leaf 移到更早的 entry）、`resetLeaf()`、`branchWithSummary(entryId, summary, details?, fromHook?)`（带上下文摘要的分支）
- 上下文与信息：`buildContextEntries()`（活动分支 + 压缩应用）、`buildSessionContext()`（给 LLM 的消息/思考等级/模型）、`getEntries()`（全部 entry，不含 header）、`getHeader()`、`getSessionName()`、`getCwd()`、`getSessionDir()`、`getSessionId()`（UUID）、`getSessionFile()`（内存会话为 `undefined`）、`isPersisted()`

⚠️ 注：`newSession()` 位于 `AgentSessionRuntime` 而非 `SessionManager`（部分旧文档表述不同，以运行时为准）。

### 2.4 AgentSessionRuntime.switchSession() 如何工作

`AgentSessionRuntime` 统一拥有活动运行时的替换权：`newSession()`、`switchSession(path)`、`fork(entryId, { position: "at" })`、clone 流程、`importFromJsonl()` 都会替换活动会话。

`switchSession("/path/to/session.jsonl")` 的关键行为：

1. 操作成功后 `runtime.session` 指向新会话；
2. **事件订阅绑定在具体 AgentSession 上，替换后必须重新订阅**（旧订阅不再生效）；
3. 用了扩展须重新 `runtime.session.bindExtensions(...)`；
4. 替换失败会抛异常。

```typescript
let session = runtime.session;
let unsubscribe = session.subscribe(() => {});

await runtime.newSession();

unsubscribe();
session = runtime.session;
unsubscribe = session.subscribe(() => {});
```

### 2.5 最小 Node 示例

```javascript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(), // 不落盘
  modelRuntime,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

---

## 3. Session Format（JSONL 会话文件）

### 3.1 文件位置与命名

- 路径：`~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`，其中 `<path>` 是工作目录、`/` 替换为 `-`。
- 每行一个 JSON 对象，首行是 session header；**删除 `.jsonl` 即删除会话**（`/resume` 支持交互删除，优先用系统回收站）。
- 会话经 `id`/`parentId` 组成树：第一个 entry 的 `parentId: null`，分支在更早的 entry 下挂新孩子，leaf 即当前位置。
- 版本：v1 线性（旧版自动迁移）、v2 树结构、v3 将 `hookMessage` 角色改名为 `custom`；**加载时自动迁移到 v3**。

### 3.2 Entry 基础字段（header 除外）

```typescript
interface SessionEntryBase {
  type: string;                 // entry 类型
  id: string;                   // 8 位 hex，稳定不变 → 可作持久游标
  parentId: string | null;      // 父 entry（首个为 null）
  timestamp: string;            // ISO 时间戳
}
```

### 3.3 Entry 类型一览

**SessionHeader（首行，无 id/parentId）**

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project"}
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project","parentSession":"/path/to/original/session.jsonl"}
```

`parentSession` 出现在 `/fork`、`/clone`、`newSession({parentSession})` 产生的会话中。

**SessionMessageEntry（`type:"message"`）** — 包一层 `AgentMessage`：

```json
{"type":"message","id":"a1b2c3d4","parentId":"prev1234","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"Hello"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2024-12-03T14:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"provider":"anthropic","model":"claude-sonnet-4-5","usage":{...},"stopReason":"stop"}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"2024-12-03T14:00:03.000Z","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"output"}],"isError":false}}
```

`AgentMessage` 角色联合：`user | assistant | toolResult | bashExecution | custom | branchSummary | compactionSummary`。content 块类型：`text` / `image`（base64 + mimeType）/ `thinking` / `toolCall`。assistant 的 `stopReason`：`stop|length|toolUse|error|aborted`（`pending` 仅用于流式事件，**不会出现在持久化文件里**）。`Usage` 含 `input/output/cacheRead/cacheWrite/totalTokens` 与 `cost` 子对象。扩展消息类型：`BashExecutionMessage`（含 `excludeFromContext`，`!!` 前缀命令为 true）、`CustomMessage`（`customType`、`display`、`details?`）、`BranchSummaryMessage`（`summary`、`fromId`）、`CompactionSummaryMessage`（`summary`、`tokensBefore`）。

**元数据 entry**：

```json
{"type":"model_change","id":"d4e5f6g7","parentId":"c3d4e5f6","timestamp":"...","provider":"openai","modelId":"gpt-4o"}
{"type":"thinking_level_change","id":"e5f6g7h8","parentId":"d4e5f6g7","timestamp":"...","thinkingLevel":"high"}
{"type":"label","id":"j0k1l2m3","parentId":"i9j0k1l2","timestamp":"...","targetId":"a1b2c3d4","label":"checkpoint-1"}   // label 置 undefined 即清除
{"type":"session_info","id":"k1l2m3n4","parentId":"j0k1l2m3","timestamp":"...","name":"Refactor auth module"}        // 显示名，/resume 选择器用它代替首条消息
```

**CompactionEntry（`type:"compaction"`）** — 见 §4；新式还带 `retainedTail`（压缩后保留的 `AgentMessage[]`，使该 entry 成为自包含检查点）：

```json
{"type":"compaction","id":"f6g7h8i9","parentId":"e5f6g7h8","timestamp":"...","summary":"User discussed X, Y, Z...","tokensBefore":50000,"retainedTail":[{...}]}
```

**BranchSummaryEntry（`type:"branch_summary"`）** — `/tree` 导航离开分支时生成：

```json
{"type":"branch_summary","id":"g7h8i9j0","parentId":"a1b2c3d4","timestamp":"...","fromId":"f6g7h8i9","summary":"Branch explored approach A..."}
```

**CustomEntry（`type:"custom"`）— 扩展状态持久化，不参与 LLM 上下文**：

```json
{"type":"custom","id":"h8i9j0k1","parentId":"g7h8i9j0","timestamp":"...","customType":"my-extension","data":{"count":42}}
```

TUI 可用 `pi.registerEntryRenderer(customType, renderer)` 自定义渲染。

**CustomMessageEntry（`type:"custom_message"`）— 扩展注入的消息，参与 LLM 上下文**：

```json
{"type":"custom_message","id":"i9j0k1l2","parentId":"h8i9j0k1","timestamp":"...","customType":"my-extension","content":"Injected context...","display":true}
```

字段：`content`（字符串或 content 块）、`display`（是否显示于 TUI）、`details?`（元数据，**不发给 LLM**）。

### 3.4 树结构与上下文构建

```
[user msg] ─── [assistant] ─── [user msg] ─── [assistant] ─┬─ [user msg] ← 当前 leaf
                                                            └─ [branch_summary] ─── [user msg] ← 废弃分支
```

- `buildContextEntries()`：从 leaf 回走到 root，得到活动 entry 列表并应用压缩；路径上有 `CompactionEntry` 时先包含它（有 `retainedTail` 则自包含，否则从 `firstKeptEntryId` 起）；非消息 entry 保留供 TUI 渲染。
- `buildSessionContext()`：产出 LLM 消息列表 —— `message` → 存储的 AgentMessage；`compaction` → `compactionSummary` + `retainedTail`；`branch_summary` → `branchSummary`；`custom_message` → `CustomMessage`；`custom` → **忽略**。

### 3.5 落盘说明

官方文档未明示"延迟/批量 flush"时机。可确认的行为：

- 文件是**追加式 JSONL**，append 方法即时返回新 entry id；`getSessionFile()` 在内存会话下为 `undefined`，`isPersisted()` 可判别；
- ⚠️ 集成推论：别把"RPC 事件到达"当"文件已落盘"的信号；需要确定性同步点时用 `compact` 响应、`export_html`、`new_session`/`switch_session` 等有确定响应的命令。

---

## 4. Compaction（上下文压缩）

### 4.1 是什么

"对话过长时，Pi 用压缩把较早内容总结掉，同时保留近期工作。" 两种机制共用同一摘要格式：**Compaction**（上下文超阈值自动触发或 `/compact` 手动触发）与 **Branch summarization**（`/tree` 导航离开分支时保留上下文）。两者都累计跟踪文件操作，并使用全新的一次性路由会话 ID、禁用 prompt-cache 写入（一次性 prompt 不值得缓存）。

### 4.2 触发条件与配置

自动压缩条件：`contextTokens > contextWindow - reserveTokens`。手动触发：`/compact [instructions]`（RPC：`{"type":"compact","customInstructions":"..."}`）。配置位于 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json`：

```json
{"compaction": {"enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000}}
```

| 设置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 自动压缩开关；`false` 只关自动，手动 `/compact` 仍有效 |
| `reserveTokens` | `16384` | 为 LLM 响应预留的 token |
| `keepRecentTokens` | `20000` | 保留不压缩的近期 token 数 |

`enabled:false` 只关自动压缩，手动 `/compact` 仍有效。

### 4.3 内部流程

1. **找切点**：从最新消息往回走，累计 token 估算直到 `keepRecentTokens`；
2. **提取消息**：从上一个保留边界（或会话起点）到切点；
3. **生成摘要**：结构化格式调 LLM，存在旧摘要时把旧摘要作为迭代上下文传入；
4. **追加 entry**：写 `CompactionEntry`（`summary` + `firstKeptEntryId`）；
5. **重建上下文**：summary + `firstKeptEntryId` 起的消息。

重复压缩时，跨度从上次压缩的 `firstKeptEntryId` 开始（该 entry 缺失则从其下一个 entry），因此"逃过上次压缩的消息"会进入本次摘要；写入新 entry 前会基于重建后的上下文重算 `tokensBefore`。

**切点规则**：合法切点 = 用户消息、助手消息、`BashExecution` 消息、自定义消息（`custom_message`、`branch_summary`）；**绝不在工具结果处切**（工具结果必须与工具调用同存）。

**分裂回合**：一个回合以用户消息开头、到下一个用户消息结束。通常按回合边界切；若单回合超过 `keepRecentTokens`，切点落在回合中间（助手消息处），产生"分裂回合"：`isSplitTurn: true`、`messagesToSummarize: []`、`turnPrefixMessages` 保存前半段，生成两份摘要（历史 + 回合前缀）再合并。

**消息序列化**：摘要前用 `serializeConversation()` 序列化为 `[User]:`、`[Assistant thinking]:`、`[Assistant]:`、`[Assistant tool calls]:`、`[Tool result]:` 行，避免模型把它当连续对话；工具结果截断为 2000 字符并标记截断量。

### 4.4 对开发者（自定义数据）的影响

| 问题 | 答案 |
|---|---|
| 自定义条目 compact 后还在吗？ | `custom` 条目不参与 LLM 上下文、也**不是合法切点**，仍在文件中；`custom_message` / `branch_summary` **是合法切点**，可能落在被摘要区域内而被折叠进 summary（不再逐字保留） |
| 工具结果会被切吗？ | 永不 —— 始终与工具调用在一起 |
| 自定义数据怎么保存？ | 两类 entry 都有通用 `details?: T`（任意 JSON 可序列化数据）。默认实现存 `{readFiles, modifiedFiles}`；扩展可实现自己的结构 |
| 文件跟踪丢失吗？ | 不丢失——文件操作从工具调用**和**上一次压缩/分支摘要的 details 中提取，跨多次压缩/嵌套分支累计，完整保留读/写文件历史 |
| LLM 用量丢失吗？ | 不丢失——生成的/扩展提供的摘要会记录 usage，计入会话总量 |
| 能拦截吗？ | `session_before_compact`（可取消、可提供自定义 summary）；`session_before_tree`（任何 `/tree` 导航前触发，可取消或提供自定义摘要） |

### 4.5 Entry 结构与摘要格式

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction"; id: string; parentId: string; timestamp: number;
  summary: string; firstKeptEntryId: string; tokensBefore: number;
  usage?: Usage;          // 生成摘要的 LLM 用量
  fromHook?: boolean;     // 由扩展提供（旧字段名）
  details?: T;            // 默认 CompactionDetails { readFiles: string[]; modifiedFiles: string[] }
}
```

RPC `compact` 响应示例：

```json
{
  "type": "response", "command": "compact", "success": true,
  "data": {
    "summary": "Summary of conversation...",
    "firstKeptEntryId": "abc123",
    "tokensBefore": 150000,
    "estimatedTokensAfter": 32000,        // 启发式估算值
    "usage": {"input": 32000, "output": 1200, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 33200, "cost": {"input": 0.01, "output": 0.02, "cacheRead": 0, "cacheWrite": 0, "total": 0.03}},
    "details": {}
  }
}
```

摘要统一格式（Markdown）：`## Goal`、`## Constraints & Preferences`、`## Progress`（Done/In Progress/Blocked）、`## Key Decisions`、`## Next Steps`、`## Critical Context`，末尾 `<read-files>` 与 `<modified-files>` 块。

扩展拦截示例：

```javascript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;
  // preparation.messagesToSummarize / turnPrefixMessages / previousSummary
  // preparation.fileOps / tokensBefore / firstKeptEntryId / settings
  // reason: "manual" | "threshold" | "overflow"; willRetry: overflow 恢复时被中止回合是否重试
  // return { cancel: true };                                // 取消
  return {                                                // 自定义摘要
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { /* custom data */ },
    },
  };
});
```

---

## 5. 集成要点与坑（经验汇总）

1. **单进程单活动会话**：RPC 进程与 `AgentSessionRuntime` 任一时刻只有一个活动会话。多会话 = 多进程（或运行时内 `switch_session`/`new_session` 切换）。切换后旧的事件订阅失效，必须重新订阅并重绑扩展。
2. **sessionId 的权威性**：会话身份有三个层级——header 的 UUID（`get_state.sessionId` / `SessionManager.getSessionId()`）；entry 的 8 位 hex id（树内稳定，可作 `get_entries(since=...)` 持久游标）；文件路径（`switch_session` / `open` 以路径为键）。⚠️ `get_messages` 与 `get_entries` 视角不同（前者已应用压缩，后者是完整追加历史），别混用。
3. **流式渲染必须自己拼**：`message_update` 无累计字段；以 `message_start` + deltas 拼装，`message_end.message` 为准；工具事件用 `toolCallId` 关联。
4. **readline 坑**：Node `readline` 会误切 U+2028/U+2029，必须用自写 `\n` 分帧器（§1.6）。
5. **bash 结果延迟进上下文**：`bash` 命令输出在下次 prompt 才作为用户消息进入 LLM 上下文；`get_messages` 里是 `bashExecution` 角色，与 `toolResult` 区分。
6. **接受 ≠ 完成**：`prompt` 的 `success:true` 只是接受/排队；最终成败靠事件流（`agent_end`/`agent_settled`）判断。流式中发 prompt 必须带 `streamingBehavior`，否则直接报错。
7. **压缩的异步性**：`compact` 的 `estimatedTokensAfter` 是估算；压缩刚完成后 `get_session_stats.contextUsage` 的 `tokens/percent` 为 `null`，直到下一次助手响应带回 usage。压缩可能被 `session_before_compact` 钩子取消（RPC 侧表现为无 `compaction_end` 事件）。
8. **自定义数据策略**：长期扩展状态放 `custom` 条目（文件里永存、不进上下文、不受压缩影响）；需要注入 LLM 的用 `custom_message`（但**会被压缩折叠**，别把关键状态只放这里）；要跨压缩保留的状态放 `details` 并自行解析上次压缩的 `CompactionEntry.details`（默认是 `readFiles`/`modifiedFiles`，扩展可自定义结构）。
9. **文件删除即删会话**：会话按项目目录隔离存储（`--<path>--/`）；落盘时机文档未明示，别假设事件与磁盘一致，需要确定性同步点用 `compact`/`export_html`/`new_session` 等有确定响应的命令。
10. **会话文件版本**：加载时自动迁移到 v3；解析外部文件时按 `version` 字段兼容，且注意 `hookMessage` 在 v3 中已改名为 `custom`。
