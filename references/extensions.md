---
source: https://pi.dev/docs/latest/extensions
source_extra: https://pi.dev/docs/latest/tui
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Pi Agent 扩展开发指南（面向二次开发者）

> 来源：官方文档 [Extensions](https://pi.dev/docs/latest/extensions) 与 [TUI](https://pi.dev/docs/latest/tui)（抓取于 2026-08-14）。本文件为蒸馏手册，细节以官方文档为准。
> 扩展使用 TypeScript，经 [jiti](https://github.com/unjs/jiti) 加载，无需编译。类型导入：`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`。

---

## 1. 文件布局与发现规则

| 位置 | 作用域 |
|---|---|
| `~/.pi/agent/extensions/*.ts` | 全局（所有项目） |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录） |
| `.pi/extensions/*.ts` | 项目级 |
| `.pi/extensions/*/index.ts` | 项目级（子目录） |

- 额外路径通过 `settings.json` 配置：`packages`（`"npm:@foo/bar@1.0.0"` / `"git:github.com/user/repo@v1"`）与 `extensions`（本地文件/目录数组）。
- 自动发现位置支持 `/reload` 热重载；`pi -e ./path.ts` 仅用于快速测试。
- 项目级 `.pi/extensions` **仅在项目被信任后**才加载。
- 多文件扩展用目录 + `index.ts` 入口。
- 依赖：加 `package.json` 后 `npm install`；`node_modules` 的导入自动解析。经 `pi install` 安装的 npm/git 包，运行时依赖放 `dependencies`（生产安装带 `--omit=dev`）。

**安全警告（原文）**：Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust.（扩展拥有你的完整系统权限，可执行任意代码，只安装可信来源。）

---

## 2. 扩展工厂（Extension Factory）

默认导出工厂函数，接收 `ExtensionAPI`，可为同步或异步：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

- **异步工厂**：若返回 Promise，pi 会 await 完成后再继续启动。异步初始化在 `session_start`、`resources_discover`、以及 `registerProvider()` 排队注册 flush **之前**完成——可用于一次性启动工作（如拉取远程模型目录）。
- **不要在工厂中启动长驻资源**：工厂可能在从不启动会话的调用中运行。进程、socket、文件 watcher、timer 一律推迟到 `session_start` 或命令/工具/事件 handler 内，并注册幂等的 `session_shutdown` handler 做清理。

可导入的包：`@earendil-works/pi-coding-agent`（类型：`ExtensionAPI`/`ExtensionContext`/事件）、`typebox`（工具参数 schema）、`@earendil-works/pi-ai`（`StringEnum` 等）、`@earendil-works/pi-tui`（TUI 组件）、Node 内置模块。

### ExtensionContext（`ctx`，所有 handler 接收）

- `ctx.ui`：`select` / `confirm` / `input` / `notify` / `setStatus` / `setWidget` / `setTitle` / `setEditorText` / `custom()`。
- `ctx.mode`：`"tui" | "rpc" | "json" | "print"`——TUI 专属功能用 `ctx.mode === "tui"` 保护。
- `ctx.hasUI`：TUI/RPC 下为 `true`，print（`-p`）/json 下为 `false`——保护对话框类方法。
- `ctx.cwd`：当前工作目录。构造项目级路径用 `CONFIG_DIR_NAME` 而非硬编码 `.pi`。
- `ctx.isProjectTrusted()`：项目信任是否生效（含临时决定与 CLI 覆盖）。
- `ctx.sessionManager`（只读会话状态）：`getEntries()` / `getBranch()` / `buildContextEntries()` / `getLeafId()`。
- `ctx.modelRegistry` / `ctx.model` / `ctx.thinkingLevel` / `ctx.scopedModels`：模型与 provider 访问。`ctx.scopedModels` 是会话级只读模型列表（来自 `--models` / `enabledModels`），每项 `{ model, thinkingLevel? }`；为空表示所有模型可用。
- `ctx.signal`：当前 agent abort signal；无 agent turn 时为 `undefined`。传给 `fetch()` / 模型调用 / 进程辅助。
- `ctx.isIdle()` / `ctx.abort()` / `ctx.hasPendingMessages()`：控制流辅助。`isIdle()` 在处理 agent run、自动重试、auto-compaction 重试或排队续跑时为 `false`。
- `ctx.shutdown()`：优雅关闭；TUI/RPC 下推迟到 idle，print 模式 no-op；向所有扩展发 `session_shutdown`。
- `ctx.getContextUsage()`：当前模型上下文用量。
- `ctx.compact(options?)`：触发压缩但不等待；`{ customInstructions, onComplete, onError }`。
- `ctx.getSystemPrompt()`：当前链式 system prompt 字符串；**不含**后续 context 变更与 `before_provider_request` 改写。

### ExtensionCommandContext（仅命令 handler 额外拥有）

- `ctx.getSystemPromptOptions()`：结构化输入（`customPrompt`、`selectedTools`、`toolSnippets`、`promptGuidelines`、`appendSystemPrompt`、`cwd`、`contextFiles`、`skills`）。可能含完整上下文文件内容，视为敏感数据。
- `ctx.waitForIdle()`：等待 agent + 重试 + 压缩重试 + 排队续跑。
- `ctx.newSession(options?)`：`{ parentSession, setup(sm), withSession(ctx) }` → `{ cancelled }`。
- `ctx.fork(entryId, options?)`：`{ position: "before" | "at", withSession }`。
- `ctx.navigateTree(targetId, options?)`：`{ summarize, customInstructions, replaceInstructions, label }`。
- `ctx.switchSession(sessionPath, options?)`：`{ withSession }`；用 `SessionManager.list(ctx.cwd)` / `listAll()` 发现会话。
- `ctx.reload()`：等同 `/reload`，对该 handler 而言是终局（`await ctx.reload(); return;`）。

**会话替换（withSession）陷阱**：`withSession` 只在旧会话发出 `session_shutdown`、旧运行时拆除、新扩展实例收到 `session_start` 之后运行。要点：回调仍执行在**原闭包**中；捕获的旧 pi / 旧命令 ctx 的 session-bound 对象在替换后失效、使用会抛错；先前提取的原生对象（如捕获的 `sessionManager`）仍是旧对象，勿复用；`withSession` 内的代码应假设 `session_shutdown` handler 已清理完状态。

```ts
pi.registerCommand("handoff", {
  handler: async (_args, ctx) => {
    await ctx.newSession({
      withSession: async (ctx) => {
        await ctx.sendUserMessage("Continue from the replacement session");
      },
    });
  },
});
```

---

## 3. 工具注册（`pi.registerTool`）——完整定义

```ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  promptSnippet: "List or add items in the project todo list",
  promptGuidelines: [
    "Use my_tool for todo planning instead of direct file edits when the user asks for a task list."
  ],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const), // StringEnum 保证 Google 模型兼容
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    // 可选：schema 校验前运行，用于迁移旧存储参数到当前 schema
    return args;
  },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }
    onUpdate?.({ content: [{ type: "text", text: "Working..." }], details: { progress: 50 } });
    const result = await pi.exec("some-command", [], { signal });
    return {
      content: [{ type: "text", text: "Done" }], // 发给 LLM
      details: { data: result },                 // 供渲染与状态
      // usage: nestedModelResponse.usage,       // 可选：嵌套模型调用的 usage
      terminate: true,                           // 可选：提前终止提示
    };
  },
  // 可选自定义渲染：
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

结构要点：
- `name` / `label` / `description`（给 LLM 看）/ `promptSnippet` / `promptGuidelines`（数组）。
- `parameters`：**typebox** `Type.Object`；枚举用 `StringEnum`（Google 模型兼容性）。
- `prepareArguments`：可选，schema 校验前迁移旧参数。
- `execute(toolCallId, params, signal, onUpdate, ctx)`：返回 `{ content, details, usage?, terminate? }`。
- `renderCall(args, theme, context)` / `renderResult(result, options, theme, context)`：可选 TUI 渲染；`renderResult` 可用 `new Text(theme.fg("success", "Done!"), 0, 0)` 或 `new Markdown(result.details.markdown, 0, 0, getMarkdownTheme())`。
- `terminate`：可选，提前终止进行中的调用。
- 加载期与启动后均可注册；注册后**同一会话内立即刷新**；用 `pi.setActiveTools()` 运行时启停。

**覆盖内置工具**：内置工具元数据通过 `pi.getAllTools()` 获取（`sourceInfo.source` 为 `"builtin" | "sdk"` 或扩展来源元数据），`setActiveTools(names)` 对内置工具与动态注册工具均生效。同名注册行为官方文档未详述，需自行验证；参考 `registerCommand` 的同名语义（见下）。

---

## 4. ExtensionAPI 方法参考

### `pi.on(event, handler)`
订阅事件，见第 5 节事件系统。

### `pi.sendMessage(message, options?)`
注入自定义消息，**参与 LLM 上下文**。仅 TUI 展示、不进 LLM 的内容用 `appendEntry` + `registerEntryRenderer`。
- `deliverAs`：
  - `"steer"`（**默认**）：流式期间排队，当前 assistant turn 完成工具调用后、下一次 LLM 调用前送达；
  - `"followUp"`：等待 agent 结束，仅在没有更多工具调用时送达；
  - `"nextTurn"`：排队到下一条用户提示。
- `triggerTurn: true`：agent 空闲时立即触发一次 LLM 响应；仅对 `"steer"`/`"followUp"` 生效。

### `pi.sendUserMessage(content, options?)`
发送一条"如同用户输入"的真实用户消息，**总是触发 turn**。`content` 为 string 或内容数组（文本 + 图片）。
- `deliverAs`：**流式时必须指定**（`"steer"` 或 `"followUp"`），否则抛错。
- `expandPromptTemplates: true`：派发扩展命令并展开 skill 命令与 prompt 模板，**默认 `false`**。

### `pi.appendEntry(customType, data?)`
持久化扩展数据，自定义条目**不参与 LLM 上下文**。可用 `registerEntryRenderer` 在转录中渲染。reload 后恢复：扫描 `ctx.sessionManager.getEntries()`，匹配 `entry.type === "custom" && entry.customType === "my-state"`。

### `pi.setSessionName(name)` / `pi.getSessionName()`
设置/读取会话选择器中显示的会话名。

### `pi.setLabel(entryId, label)`
设置或清除条目标签；标签随会话持久化、重启保留。读取：`ctx.sessionManager.getLabel(entryId)`。

### `pi.registerCommand(name, options)`
注册斜杠命令。同名多注册：**全部保留**，按加载顺序分配数字后缀（`/review:1`、`/review:2`）。

```ts
pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
    const items = ["dev", "staging", "prod"].map((e) => ({ value: e, label: e }));
    const filtered = items.filter((i) => i.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying: ${args}`, "info");
  },
});
```

### `pi.getCommands()`
返回当前会话可调用的斜杠命令（顺序：**扩展 → 模板 → skill**）。每项 `{ name, description?, source: "extension" | "prompt" | "skill", sourceInfo: { path, source, scope: "user" | "project" | "temporary", origin: "package" | "top-level", baseDir? } }`；`sourceInfo` 是权威溯源字段。内置交互命令（`/model`、`/settings`）不包含。

### `pi.registerMessageRenderer(customType, renderer)`
为 `sendMessage()` 创建的自定义消息（参与 LLM 上下文）注册 TUI 渲染器。

### `pi.registerMarkdownTransformer(transformer)`
markdown 转换器，按扩展加载顺序链式执行，每个接收前一个的输出。上下文：`{ messageType: "user" | "assistant" | "assistant-thinking", isStreaming, availableWidth }`。**抛错则保留当前 markdown**。仅显示层：会话与模型上下文中的原文不变。**必须同步且廉价**。

### `pi.registerEntryRenderer(customType, renderer)`
为 `appendEntry()` 创建的自定义条目（不在 LLM 上下文）注册 TUI 渲染器。

### `pi.registerShortcut(shortcut, options)`
键盘快捷键：`pi.registerShortcut("ctrl+shift+p", { description, handler })`。

### `pi.registerFlag(name, options)` / `pi.getFlag(name)`
CLI 标志：`pi.registerFlag("plan", { description, type: "boolean", default: false })`；读取 `pi.getFlag("plan")`。

### `pi.exec(command, args, options?)`
Shell 执行：`await pi.exec("git", ["status"], { signal, timeout: 5000 })` → `{ stdout, stderr, code, killed }`。

### `pi.getActiveTools()` / `pi.getAllTools()` / `pi.setActiveTools(names)`
- `getActiveTools()` → `string[]`。
- `getAllTools()` → 元数据 `{ name, description, parameters, promptGuidelines, sourceInfo }`。
- `setActiveTools(names)`：内置与动态注册工具均可用。

### `pi.setModel(model)`
切换模型；无 API key 时返回 `false`。查找：`ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5")`。

### `pi.getThinkingLevel()` / `pi.setThinkingLevel(level)`
级别：`"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`；按模型能力 clamp；变更触发 `thinking_level_select` 事件。

### `pi.events`
扩展间共享事件总线：`pi.events.on("my:event", (data) => ...)` / `pi.events.emit("my:event", { ... })`。

### `pi.registerProvider(name, config)`
动态注册/覆盖 provider。**工厂阶段调用排队，直到 runner 初始化才 flush**；之后调用立即生效，无需 `/reload`。
- 对象简写：`{ name, baseUrl, apiKey, api, headers, authHeader, models, refreshModels, oauth, streamSimple }`。
- `apiKey` 支持环境变量插值（`$ENV_VAR` / `${ENV_VAR}`）、前导 `!command` 执行命令、`$$` 转义 `$`、`$!` 转义字面 `!`。
- 传完整 `Provider`（来自 `@earendil-works/pi-ai`）时它作为组合基础，`models.json` 的覆盖仍在其上生效。
- `refreshModels({ signal })` 动态发现模型；`context.publish({ persist: entry })` 持久化目录快照；`persist: null` 删除快照。**`context.signal` 始终是具体 signal，provider 回调必须把它传给阻塞 I/O。**
- `oauth` 配置：`{ name, login(callbacks), refreshToken(credentials, signal), getApiKey(credentials) }`；回调 `callbacks.onAuth({ url })`、`callbacks.onPrompt({ message })`。
- 覆盖现有 provider 而不带模型：`pi.registerProvider("anthropic", { baseUrl: "https://proxy.example.com" })`。

### `pi.unregisterProvider(name)`
移除 provider；被覆盖的内置模型自动恢复。加载后调用立即生效。

---

## 5. 事件系统

### 主循环生命周期

启动序列：`project_trust` → `session_start { reason: "startup" }` → `resources_discover { reason: "startup" }`。

用户提示流（扩展命令最先检查，命中即旁路一切）：

```
用户输入
  → [扩展命令命中? 是则直接执行并结束]
  → input            （可拦截/转换/处理）
  → skill/模板展开    （input 未处理时）
  → before_agent_start（可注入 message、替换 systemPrompt）
  → agent_start
```

消息生命周期（user / assistant / toolResult 三类消息都会触发）：`message_start` → `message_update`（assistant 流式）→ `message_end`（handler 可返回 `{ message }` 替换定稿消息，**必须保持相同 role**）。

Turn 循环（LLM 每调用一次工具即循环一次）：

```
turn_start
  → context                  （消息深拷贝，可安全修改；返回 { messages } 替换）
  → before_provider_headers  （原地修改 event.headers：设字符串=添加/覆盖，设 null=删除）
  → before_provider_request  （payload 构建后；返回 undefined=不变，其他值=整体替换）
  → after_provider_response  （消费流式 body 前暴露 event.status / event.headers）
  → tool_execution_start
  → tool_call                （可拦截/阻断）
  → tool_execution_update
  → tool_result              （可修改）
  → tool_execution_end
  → turn_end
```

终止：`agent_end` 在底层 run 结束时触发（但 pi 仍可能重试/压缩/续跑排队 follow-up）；`agent_settled` 在**无重试、无压缩、无续跑**时触发——此时 `ctx.isIdle()` 为 `true`（除非其他扩展启动了新 run）。

### 会话切换 / 分支 / 压缩事件

| 场景 | 事件序列 |
|---|---|
| `/new`、`/resume` | `session_before_switch`（可 `{ cancel: true }`）→ `session_shutdown` → 扩展重载重绑定 → `session_start { reason: "new" \| "resume", previousSessionFile? }` → `resources_discover` |
| `/fork`、`/clone` | `session_before_fork`（可 cancel）→ `session_shutdown` → 重载 → `session_start { reason: "fork", previousSessionFile }` → `resources_discover` |
| `/name` / RPC / `setSessionName()` | `session_info_changed` |
| `/compact` 或自动压缩 | `session_before_compact`（可 `{ cancel: true }` 或返回自定义 `{ compaction: { summary, firstKeptEntryId, tokensBefore } }`）→ `session_compact` |
| `/tree` 树导航 | `session_before_tree`（可 cancel 或提供自定义摘要）→ `session_tree` |
| 模型/思考级别变更 | `thinking_level_select`（级别被 clamp 时）→ `model_select`；仅改级别则单独 `thinking_level_select` |
| 退出 | `session_shutdown`（`reason: "quit" \| "reload" \| "new" \| "resume" \| "fork"`）——在此清理 `session_start` 开启的资源 |

### `project_trust`

在 pi 决定是否信任含动态配置（`.pi` / `.agents/skills`）的项目之前触发；启动时及会话替换进入本进程未解决信任的 cwd 时运行。**只有 user/global 扩展和 CLI `-e` 扩展参与**（项目级扩展在信任解决后才加载）。

Handler 必须返回 `{ trusted: "yes" | "no" | "undecided" }`；第一个 yes/no 决定生效并抑制内置信任提示；`remember: true` 持久化决定，否则仅本次进程有效；`"undecided"` 交给后续 handler 或正常信任流程（已保存的 `trust.json` → `defaultProjectTrust`）。

### `resources_discover`

`session_start` 后触发，扩展可贡献额外路径，返回 `{ skillPaths, promptPaths, themePaths }`。`event.reason` 为 `"startup"` 或 `"reload"`。

### 事件 handler 能做什么（拦截/修改汇总）

| 事件 | 能力 |
|---|---|
| `input` | `{ action: "continue" }` 放行；`{ action: "transform", text }` 修改后继续展开；`{ action: "handled" }` 完全跳过 agent。转换可链式。 |
| `before_agent_start` | 注入持久 `message` 和/或替换 `systemPrompt`（跨 handler 链式）；暴露 `systemPromptOptions`。 |
| `context` | 过滤/修改发给 LLM 的消息列表。 |
| `before_provider_headers` | 原地增删改 HTTP 头。 |
| `before_provider_request` | 检查或整体替换 provider payload。 |
| `tool_call` | 原地改 `event.input` 修补参数；`{ block: true, reason?, terminate? }` 阻断。修改跨 handler 链式；**修改后不重新校验**。 |
| `tool_result` | 返回部分补丁（`content` / `details` / `isError` / `usage`），省略字段保持现值；按加载顺序链式。 |
| `message_end` | 替换定稿消息（须同 role）。 |
| `session_before_switch` / `session_before_fork` | `{ cancel: true }` 取消。 |
| `session_before_compact` | 取消或提供自定义压缩摘要。 |
| `session_before_tree` | 取消或提供自定义分支摘要。 |
| `user_bash` | 提供自定义操作（如 SSH）、包装内置本地后端或返回完整替代结果。 |

**并行工具模式注意**：`tool_execution_end` 与 `tool_result` 按工具完成顺序触发；同一条 assistant 消息的兄弟结果在 `tool_call` 期间不保证在 `ctx.sessionManager` 中可见。

---

## 6. 二次开发要点 / 坑（提炼自官方文档）

1. **异步工厂完成时机**：async 初始化在 `session_start`、`resources_discover` 和 `registerProvider` 队列 flush 之前完成——适合拉模型目录，但**绝不**在工厂里启动进程/socket/watcher/timer（工厂可能运行在无会话的调用中），资源统一在 `session_start` 启动、`session_shutdown` 清理（handler 要幂等）。
2. **`sendUserMessage` 流式必填 `deliverAs`**（`"steer"`/`"followUp"`），否则抛错；默认 `expandPromptTemplates: false`，要派发扩展命令/展开 skill 需显式开。
3. **`sendMessage` 的 `deliverAs` 语义**：默认 `"steer"`（当前 turn 工具调用后、下次 LLM 调用前）；`"followUp"` 等 agent 完全结束且无更多工具调用；`"nextTurn"` 排到下条用户提示。`triggerTurn: true` 只在空闲时有效。
4. **`registerProvider` 工厂阶段排队**：工厂内调用不立即生效，runner 初始化时才 flush；之后调用即时生效。**`refreshModels` 必须传 `signal`**；provider 回调必须把 `context.signal` 传给所有阻塞 I/O。
5. **markdown transformer 必须同步且廉价**；抛错时 pi 保留当前 markdown；它是纯显示层，不改变会话/模型上下文中的原文。
6. **`promptGuidelines` 无工具名前缀**：每条 bullet 会扁平追加到 Guidelines 区，必须自称工具名（避免"Use this tool when..."这种指代不清的写法）。
7. **路径参数带 `@` 前缀**：部分模型会在工具路径参数里带 `@`；内置工具会先剥离前导 `@` 再解析路径——自定义工具应同样处理。
8. **文件修改用 `withFileMutationQueue(absolutePath, fn)`**（导入自 `@earendil-works/pi-coding-agent`）：传入**真实绝对目标路径**（非用户原始参数），把 read-modify-write 整段逻辑包进队列，与内置 edit/write 共用同一 per-file 队列。
9. **`tool_call` 修改参数后不重新校验**；`tool_result` 只做部分补丁，省略字段保持原值。
10. **`withSession` 陷阱**：回调跑在原闭包；替换后旧 pi/ctx session-bound 对象与提取出的原生对象全部失效，使用会抛错；代码应假设 `session_shutdown` 已清理。
11. **`ctx.reload()` 是终局操作**：`await ctx.reload(); return;`，之后不要再用该 handler 的 ctx。
12. **`message_end` 替换消息必须保持相同 role**。
13. **扩展命令优先级最高**：在 `input` 事件之前检查，命中即旁路 agent。
14. **TUI 专属功能要守卫**：`ctx.mode === "tui"` / `ctx.hasUI`（print/json 模式没有 UI）。
15. **`appendEntry` 状态恢复**：reload 后需自行扫描 `getEntries()` 按 `customType` 重建。
16. **TUI 组件**：`render(width)` 每行不得超宽；状态变化后调 `invalidate()` 并 `tui.requestRender()`；主题只能从回调参数取（勿直接 import）；overlay 关闭即 dispose，**勿复用引用**，需重新调用创建函数；CJK 输入法要求组件实现 `Focusable` 并正确传播 `focused`；可用 `visibleWidth` / `truncateToWidth` / `wrapTextWithAnsi` 处理宽度，`PI_TUI_WRITE_LOG` 抓取原始 ANSI 流调试。

---

## 7. TUI 定制补充（来自 [TUI 文档](https://pi.dev/docs/latest/tui)）

- 内置组件（`@earendil-works/pi-tui`）：`Text`、`Box`、`Container`、`Spacer`、`Markdown`（语法高亮，用 `getMarkdownTheme()`）、`Image`（Kitty/iTerm2/Ghostty/WezTerm/Warp）。
- 键盘：`matchesKey(data, Key.up)` / `Key.enter` / `Key.escape` / `Key.ctrl("c")`；字符串形式 `"enter"`、`"ctrl+c"`、`"shift+tab"` 亦可。
- 主题：`theme.fg(category, text)`（如 `text`/`accent`/`success`/`error`/`warning`/`border`/`toolTitle`/`toolOutput`/`mdHeading`/`syntaxKeyword`）；`theme.bg(color, text)`（如 `selectedBg`/`toolPendingBg`/`toolSuccessBg`/`toolErrorBg`）。
- 工作指示器：`ctx.ui.setWorkingIndicator({ frames: [...] })`；空数组隐藏；无参恢复默认 spinner；自定义帧原样渲染，需自带颜色。
- 其他：`ctx.ui.setStatus("my-ext", string | undefined)`、`setWidget(name, linesOrRenderer, { placement: "belowEditor" })`、`setFooter(...)`（整体替换 footer）、`setEditorComponent(...)`（替换编辑器，继承 `CustomEditor` 保留应用快捷键）。
- Overlay：`ctx.ui.custom(showFn, { overlay: true, overlayOptions: { width: "50%", anchor: "right-center" } })`；`handle.focus()` / `unfocus({ target })` / `setHidden(true)` / `hide()`。
- 参考示例（官方仓库 `examples/extensions/`）：`preset.ts`（选择 UI）、`qna.ts`（异步+取消）、`tools.ts`（设置开关）、`plan-mode/index.ts`（status/widgets）、`working-indicator.ts`、`custom-footer.ts`、`modal-editor.ts`、`snake.ts`、`todo.ts`（工具渲染 renderCall/renderResult）。
- 注意：TUI 页面未覆盖 `registerMessageRenderer` / `registerMarkdownTransformer` / `registerEntryRenderer`——这三个渲染钩子见第 4 节（Extensions 文档）。
