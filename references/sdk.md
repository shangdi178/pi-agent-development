---
source: https://pi.dev/docs/latest/sdk
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# SDK 集成参考（Node 进程内嵌 Pi）

> 适用对象：需要在自己的 Node.js 进程中直接内嵌 Pi Agent（而非独立进程 RPC）的开发者。
>
> 事实等级：✅ OFFICIAL（官方文档明确说明） / ⚠️ INFERENCE（由官方 API/源码/行为推导） / 🧪 PRACTICE（工程实践建议）。

## 1. 可导入的导出（`@earendil-works/pi-coding-agent`）

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

## 2. createAgentSession() — 单个 AgentSession 的主工厂

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

## 3. SessionManager — 会话文件管理器

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

⚠️ INFERENCE：`newSession()` 位于 `AgentSessionRuntime` 而非 `SessionManager`（官方部分旧文档表述不同，以运行时为准）。

## 4. AgentSessionRuntime.switchSession() 如何工作

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

## 5. 最小 Node 示例

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

## 6. 集成要点（坑）

1. **会话生命周期归 Pi runtime**：不要自己实现第二套会话管理器；`AgentSessionRuntime` 是唯一拥有会话替换权的对象。
2. **替换后事件订阅失效**：`switchSession`/`newSession`/`fork`/clone 之后必须重新订阅 + 重绑扩展，否则收不到事件。
3. **`get_messages` vs `get_entries` 视角不同**（与 RPC 一致）：前者压缩后视角，后者完整追加历史。
4. **自定义数据策略**：长期扩展状态放 `appendCustomEntry`（`custom` 条目，永存不进上下文）；需要注入 LLM 的用 `appendCustomMessageEntry`（但会被压缩折叠）。
5. ⚠️ INFERENCE：一个进程一个活动会话——多个已保存会话**无需多进程**（`AgentSessionRuntime.newSession()`/`switchSession()` 运行时内切换即可）；仅当需要多会话并行执行时才用多进程。

> 相关：会话文件格式见 `sessions.md`；压缩机制见 `compaction.md`；独立进程集成见 `rpc.md`。
