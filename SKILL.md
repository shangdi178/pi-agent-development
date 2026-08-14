---
name: pi-agent-development
description: Guide for extending and doing secondary development on Pi Agent (pi.dev). Covers the extension system (ExtensionAPI, registerTool/registerCommand/events), Agent Skills authoring, RPC-mode integration (JSONL over stdin/stdout), SDK embedding, SessionManager, session file format, compaction, and Pi Packages packaging. Use BEFORE building tools, skills, web UIs, servers, or integrations on top of Pi Agent — check whether a capability already exists natively, and pick the correct layer (extension vs. thin wrapper vs. projection) instead of rewriting the core. Detailed distilled reference manuals live in references/.
---

# Pi Agent 二次开发指南（Extension-First）

Pi Agent（pi.dev）是"小核心 + 扩展"架构：核心保持精简，能力通过 TypeScript 扩展、skills、prompt templates、themes、pi packages 增长。

**二次开发铁律：先查原生能力，再决定扩展/对接/投影，禁止重写内核。**

本 SKILL.md 是精炼骨架，每个章节的详细蒸馏手册在 `references/` 下，按需读取。

## 何时使用本技能

- 要在 Pi Agent 上开发工具（tool）、命令、事件监听、自定义渲染
- 要编写可复用的 Skill（Agent Skills 标准）
- 要做程序化集成：服务器、Web UI、CLI 包装（RPC Mode 或 SDK）
- 在动手前想确认"这个能力 Pi 是否原生已有"，避免重复造轮子
- 模型在任务匹配时自动读取本技能；也可用 `/skill:pi-agent-development` 强制加载

## 1. 官方资源（先读）

- 文档：https://pi.dev/docs/latest （Overview / Extensions / Skills / RPC Mode / SDK / Session Format / Compaction / Pi Packages）
- 源码：https://github.com/earendil-works/pi （`packages/coding-agent`，MIT；文档源码同仓库 `packages/coding-agent/docs/`）
- npm 包：`@earendil-works/pi-coding-agent`
- 安装：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent` 或 https://pi.dev/install.sh

## 2. 开发前检查清单（决定能力归属）

动手前逐条回答，归属决定写法：

```text
1. Pi 原生是否已具备？（Sessions/Compaction/Tools/Skills/Providers/模型选择…）
   → 具备则纯对接（HTTP 薄封装 + UI 投影），禁止重写
2. 智能行为（工具/命令/事件/记忆）？→ Extension 层（registerTool 等官方机制）
3. 可复用指令包？→ Skill（Agent Skills 标准）
4. 程序化集成（服务器/Web UI/CLI 包装）？→ RPC Mode 或 SDK
5. 是否改动了 coding-agent 核心源码？→ 禁止
6. 是否存在与 Pi 平行实现的状态/队列/会话？→ 禁止
```

## 3. Extensions（扩展，TypeScript）

扩展 = 导出默认工厂函数的 TS 模块，接收 `ExtensionAPI`（async 也可，pi 会 await 后再继续启动）：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => ctx.ui.notify("Loaded", "info"));
}
```

文件布局（自动发现，`/reload` 热加载；项目级 `.pi/extensions/` 需先信任）：

| 位置 | 作用域 |
| --- | --- |
| `~/.pi/agent/extensions/*.ts` 或 `*/index.ts` | 全局 |
| `.pi/extensions/*.ts` 或 `*/index.ts` | 项目（需信任） |
| `pi -e ./path.ts` | 快速测试 |
| 目录扩展带 `package.json` | 可带 npm 依赖（`"pi": { "extensions": ["./src/index.ts"] }`） |

> ⚠️ 扩展拥有完整系统权限，只装可信来源。**不要从工厂函数启动长驻资源**（进程/定时器/文件监听），工厂可能在无会话的调用中运行——延迟到 `session_start` 或命令/工具里。

### 3.1 注册工具（LLM 可调用）

```ts
pi.registerTool({
  name: "greet",
  label: "Greet",
  description: "Greet someone by name",
  parameters: Type.Object({           // typebox schema
    name: Type.String({ description: "Name to greet" }),
  }),
  promptSnippet: "Greet someone by name",          // 工具列表一行
  promptGuidelines: ["Call greet to…"],            // 必须提及工具名的指导
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return { content: [{ type: "text", text: `Hello, ${params.name}!` }], details: {} };
  },
});
```

要点：`prepareArguments(args)` 兼容旧会话；`renderCall/renderResult` 自定义 TUI；execute 抛错 = 失败；返回 `terminate: true` 停止后续 LLM 调用；同名覆盖内置工具（read/bash/edit/write）；启动后也能注册，立即生效无需 `/reload`。

### 3.2 注册命令 / 事件 / 常用 API

```ts
pi.registerCommand("hello", {
  description: "Say hello",
  getArgumentCompletions: (prefix) => [...],        // 可选补全
  handler: async (args, ctx) => ctx.ui.notify(`Hello ${args || "world"}!`, "info"),
});
pi.on("session_start", async (_event, ctx) => { /* 事件订阅 */ });
```

速查：

| API | 用途 |
| --- | --- |
| `sendMessage(msg, {deliverAs, triggerTurn})` | 注入消息（进 LLM 上下文）；`deliverAs`: `steer`（默认，流式时排队）/ `followUp` / `nextTurn` |
| `sendUserMessage(content, {deliverAs, expandPromptTemplates})` | 模拟用户消息，**总是触发回合**；流式中必须显式指定 `deliverAs`（否则抛错）；`expandPromptTemplates` 默认 false |
| `appendEntry(customType, data)` | 持久化自定义数据（**不进 LLM 上下文**，TUI 用 `registerEntryRenderer` 渲染） |
| `setSessionName(name)` / `setLabel(entryId, label)` | 会话命名 / entry 打标签 |
| `registerMarkdownTransformer(fn)` | 自定义渲染（必须同步、廉价；仅显示层，不改原文） |
| `exec(cmd, args)` | shell 执行（`{stdout, stderr, code, killed}`） |
| `getAllTools()` / `getActiveTools()` / `setActiveTools(names)` | 工具管理 |
| `setModel(model)` / `setThinkingLevel(level)` | 模型与思考级别（`off|minimal|low|medium|high|xhigh|max`，按模型能力截断） |
| `events.on/emit` | 扩展间事件总线 |
| `registerProvider(name, config)` / `unregisterProvider(name)` | 动态 provider（OAuth、refreshModels、streamSimple） |

事件主循环：`input`（可拦截/改写）→ `before_agent_start` → `agent_start` → `message_start/update/end` → turn 循环（`context` 可改消息 → `before_provider_request` → `tool_call` 可 `{block: true, reason}` 拦截或改 `event.input` → `tool_result` 可修改）→ `agent_end` → `agent_settled`。会话切换/分支/压缩：`session_before_switch/fork/compact`、`session_shutdown`、`session_start {reason}`、`project_trust`、`resources_discover`。

📄 **详细蒸馏手册：`references/extensions.md`** — ExtensionAPI 全量方法签名、事件生命周期与各 handler 可拦截能力、registerProvider 配置、TUI 渲染器、16 条实战坑。

## 4. Skills（Agent Skills 标准）

目录 = `SKILL.md` + 自由文件（scripts/references/assets）。frontmatter 只有 `name` 和 `description` 必填（description 缺失技能不加载）：

```yaml
---
name: my-skill          # 1-64 字符，小写字母数字连字符
description: 说明用途与触发时机（必填，写"什么时候用、做什么"）
license: MIT
allowed-tools: read bash   # 实验性预批准工具
disable-model-invocation: false  # true 时只能 /skill:name 调用
---
```

发现路径（信任的项目才加载项目级）：全局 `~/.pi/agent/skills/`、`~/.agents/skills/`；项目 `.pi/skills/`、`.agents/skills/`；包内 `skills/` 或 package.json `pi.skills`。模型在任务匹配时 read 完整 SKILL.md；`/skill:name` 强制加载（参数追加为 `User: <args>`）。

📄 **详细蒸馏手册：`references/skills.md`** — frontmatter 全字段、description 好/坏示例、模型触发流程、发现优先级与同名冲突、验证与硬性不加载条件。

## 5. RPC Mode（程序化集成：服务器/Web UI/CLI 包装）

无头模式：`pi --mode rpc [--provider X --model Y --session-dir DIR]`（`--no-session` 纯内存、`--name` 启动即命名）。

协议：**stdin/stdout 上的严格 JSONL，LF 是唯一记录分隔符**。⚠️ Node 的 `readline` 不兼容（会把合法 JSON 内的 U+2028/U+2029 当换行），必须自己按 `\n` 切行（`StringDecoder` 实现见 `references/integration.md`）。

- 请求：stdin 每行一个 JSON（`{ id?, type: "command", ... }`），响应原样带回 `id`
- 响应：stdout `{ id?, type: "response", command, success, data? }`；**成功接受 ≠ 完成**，接受后的失败走事件/消息通道
- 事件：stdout 流式 JSON lines；`message_update` 是 delta（`text_delta` 等），需自行拼装，**以 `message_end.message` 为权威完整对象**；工具执行用 `toolCallId` 关联

核心命令（完整 32 条见 `references/integration.md`）：

- 会话：`new_session`（可 `parentSession`）/ `switch_session {sessionPath}` / `fork {entryId}` / `clone` / `set_session_name {name}` / `compact {customInstructions?}`；被扩展钩子取消时返回 `success:true` + `data.cancelled:true`
- 消息：`prompt`（流式中必带 `streamingBehavior: "steer"|"followUp"`，否则报错；可带 images）/ `steer` / `follow_up` / `abort`
- 查询：`get_state`（sessionId 权威来源）/ `get_messages`（压缩后视角）/ `get_entries {since?}`（追加序、含历史，entry id 可作持久游标）/ `get_tree` / `get_session_stats` / `get_commands`
- 模型：`set_model {provider, modelId}` / `cycle_model` / `set_thinking_level {level}` / `get_available_models`
- 工具：`bash`（输出流式返回 `bash_execution_update`；**结果不立即进 LLM 上下文**，下次 prompt 才转成用户消息）/ `abort_bash`

⚠️ 会话 id：`new_session` 生成 uuidv7；`get_state.sessionId` 是会话身份唯一权威，集成方不要自维护 id 记账。

📄 **详细蒸馏手册：`references/integration.md`** — 全命令清单与字面 JSON 示例、错误处理（含 `command:"parse"`）、Node 最小对话实现、Python 提示。

## 6. SDK（Node 内嵌）

`@earendil-works/pi-coding-agent` 导出：`createAgentSession`（主工厂，返回 `{session, extensionsResult}`）、`createAgentSessionRuntime`、`AgentSessionRuntime`、`SessionManager`、`ModelRuntime`、`defineTool`、`ExtensionAPI` 类型等。

- `createAgentSession({tools, excludeTools, noTools, customTools, model, thinkingLevel, sessionManager, cwd, agentDir})` — 自定义工具用 `defineTool` 定义并加入 `tools` 白名单
- `SessionManager` 静态工厂：`inMemory()` / `create(cwd)` / `continueRecent(cwd)` / `open(path)` / `forkFrom(source, cwd)` / `list` / `listAll`；实例方法：`appendMessage/appendCustomEntry/appendSessionInfo/appendCustomMessageEntry`（返回 entry id）、`buildContextEntries/buildSessionContext`、`getEntries/getTree/branch/createBranchedSession`
- ⚠️ 会话替换（`newSession`/`switchSession`/`fork`/clone）归 **`AgentSessionRuntime`** 统一管理：替换后旧事件订阅失效，必须重新订阅 + `bindExtensions`；替换失败抛异常

📄 **详细蒸馏手册：`references/integration.md`** — 完整导出清单、createAgentSession 选项表、SessionManager 全方法、switchSession 行为与代码示例。

## 7. Pi Packages（打包分发）

Bundle 扩展 + skills + prompts + themes 为一个可分发包：npm 包 `package.json` 用 `pi` 字段声明内容（`extensions`/`skills`/`prompts`/`themes`，支持 glob 与 `!` 排除）。安装：`pi install <package>`（npm / git / 本地路径），作用域 `-l` 项目级、`-e` 临时。

📄 **详细蒸馏手册：`references/packages.md`** — pi 字段语法、无 manifest 约定目录、打包注意事项（核心包不可捆绑）、管理命令、作用域对比；另含 Prompt Templates 简述。

## 8. 参考项目（GitHub，二次开发范本）

- `agegr/pi-web` — Pi Agent 的 Web UI（RPC 对接参考）
- `cellinlab/how-pi-agent-works` — Pi 原理与实现剖析
- `disler/pi-vs-claude-code` — Pi vs Claude Code 对比
- `K-Dense-AI/scientific-agent-skills` — 科学领域 skills 库（兼容 Pi/Agent Skills 标准）
- `spences10/pirecall` — 会话同步到 SQLite（session 文件解析范例）
- `SaladDay/pi-from-scratch` — 600 行迷你 Pi（理解核心机制）

## 9. 常见坑（蒸馏自官方文档与实践）

- **会话身份单一权威**：对外暴露会话 id 以 `get_state` 返回值为准，不要自维护一套 id 记账（缓存镜像、队列映射都易漂移）；RPC 与 SDK 的会话 id 一律 uuidv7，不要造 `project-`/`rpc-` 兜底。
- **不要平行实现状态**：会话树/队列/compaction 都是 Pi 原生能力，自造"第二套状态"会在 compaction 后失同步。
- **内核零改动**：验收时 `git diff` 核心包源码，改动应全部落在扩展层。
- **RPC 流式语义**：`message_update` 无累计字段，自行拼装 delta、以 `message_end` 为准；bash 结果下次 prompt 才进 LLM 上下文；成功接受 ≠ 任务完成。
- **落盘时机官方未明示**：别把 RPC 事件到达当"文件已落盘"信号；需要确定性同步点用 `compact`/`export_html`/`new_session` 等有确定响应的命令。
- **一个 RPC 进程一个活动会话**：切换会话是整体替换运行时（SDK 中还要重订阅事件），不是"切一个指针"。
- **扩展生命周期**：工厂里别启动长驻资源；`sendUserMessage` 流式中必须指定 `deliverAs`；markdown transformer 必须同步。
