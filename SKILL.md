---
name: pi-agent-development
description: Guide for extending and doing secondary development on Pi Agent (pi.dev). Covers the extension system (ExtensionAPI, registerTool/registerCommand/events), Agent Skills authoring, RPC-mode integration (JSONL over stdin/stdout), SDK embedding, SessionManager, and Pi Packages packaging. Use BEFORE building tools, skills, web UIs, servers, or integrations on top of Pi Agent — check whether a capability already exists natively, and pick the correct layer (extension vs. thin wrapper vs. projection) instead of rewriting the core.
---

# Pi Agent 二次开发指南（Extension-First）

Pi Agent（pi.dev）是"小核心 + 扩展"架构：核心保持精简，能力通过 TypeScript 扩展、skills、prompt templates、themes、pi packages 增长。

**二次开发铁律：先查原生能力，再决定扩展/对接/投影，禁止重写内核。**

## 何时使用本技能

- 要在 Pi Agent 上开发工具（tool）、命令、事件监听、自定义渲染
- 要编写可复用的 Skill（Agent Skills 标准）
- 要做程序化集成：服务器、Web UI、CLI 包装（RPC Mode 或 SDK）
- 在动手前想确认"这个能力 Pi 是否原生已有"，避免重复造轮子
- 模型在任务匹配时自动读取本技能；也可用 `/skill:pi-agent-development` 强制加载

## 1. 官方资源（先读）

- 文档：https://pi.dev/docs/latest （Overview / Extensions / Skills / RPC Mode / SDK / Session Format / Compaction / Pi Packages）
- 源码：https://github.com/earendil-works/pi （`packages/coding-agent`，MIT）
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

扩展 = 导出默认工厂函数的 TS 模块，接收 `ExtensionAPI`：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // async 也可；pi 会 await 后再继续启动
}
```

文件布局（自动发现，`/reload` 热加载）：

- 全局：`~/.pi/agent/extensions/my-extension.ts` 或 `my-extension/index.ts`
- 项目（需先信任）：`.pi/extensions/*.ts`
- 快速测试：`pi -e ./path.ts`
- 目录扩展可带 `package.json`（npm 依赖 + `"pi": { "extensions": ["./src/index.ts"] }`）

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

要点：

- `prepareArguments(args)` 兼容旧会话；`renderCall/renderResult` 自定义 TUI
- execute 抛错 = 失败；返回 `terminate: true` 停止后续 LLM 调用
- 可用同名覆盖内置工具（read/bash/edit/write）

### 3.2 注册命令 / 事件 / 其他 API

```ts
pi.registerCommand("hello", {
  description: "Say hello",
  handler: async (args, ctx) => ctx.ui.notify(`Hello ${args || "world"}!`, "info"),
});
pi.on("session_start", async (_event, ctx) => { /* 事件订阅 */ });
```

常用 `pi.*` API 速查：

| API | 用途 |
| --- | --- |
| `sendMessage(msg)` / `sendUserMessage(content, {deliverAs})` | 注入消息 |
| `appendEntry(type, data)` | 持久化自定义数据（不进 LLM） |
| `setSessionName(name)` / `getSessionName()` | 会话命名 |
| `registerMarkdownTransformer(fn)` / `registerMessageRenderer` | 自定义渲染 |
| `exec(cmd, args)` | shell 执行 |
| `getAllTools()` / `setActiveTools(names)` | 工具管理 |
| `setModel(model)` / `setThinkingLevel(level)` | 模型与思考级别 |
| `events.on/emit` | 扩展间事件总线 |
| `registerProvider(name, config)` | 动态 provider（OAuth、refreshModels、streamSimple） |

事件类别：startup（project_trust）、session（session_start/shutdown/before_switch/fork/compact、session_info_changed）、agent（before_agent_start、turn_start/end、message_start/update/end）、tool（tool_call/tool_result/tool_execution_*）、model、provider（before_provider_request 等）、context、input、user_bash。

`tool_call` 事件可 `{ block: true, reason }` 拦截或原地改 `event.input`。

## 4. Skills（Agent Skills 标准）

Pi 实现 Agent Skills 标准（宽松校验）。目录含 `SKILL.md` + 自由文件（scripts/references/assets）。

SKILL.md frontmatter：

```yaml
---
name: my-skill          # 1-64 字符，小写字母数字连字符
description: 说明用途与触发时机（必填，缺则技能不加载）
license: MIT
compatibility: 说明
allowed-tools: read bash   # 实验性预批准工具
disable-model-invocation: false  # true 时只能 /skill:name 调用
---
```

发现路径：全局 `~/.pi/agent/skills/`、`~/.agents/skills/`；项目（信任后）`.pi/skills/`、`.agents/skills/`；包内 `skills/` 或 package.json `pi.skills`。

模型在任务匹配时 read 完整 SKILL.md；`/skill:name` 强制加载（参数追加为 `User: <args>`）。

外部技能库：Anthropic Skills（docx/pdf/pptx/xlsx）、Pi Skills（web 搜索/浏览器自动化/Google API）。

## 5. RPC Mode（程序化集成：服务器/Web UI/CLI 包装）

无头模式：`pi --mode rpc [--provider X --model Y --session-dir DIR]`。

协议：**stdin/stdout 上的 JSONL**。

- 请求：stdin 每行一个 JSON（`{ id?, type: "command", ... }`）
- 响应：stdout `{ id?, type: "response", command, success, data? }`
- 事件：stdout 持续流式 JSON lines

已知命令（以 `rpc-types.ts` 为准）：`get_state` / `get_messages` / `send_message` / `new_session` / `switch_session`（传 sessionPath）/ `set_session_name`（name）/ `fork` / `compact` / `interrupt` / `list_sessions` / 以及各内置工具调用。

会话 id：`new_session` 生成 uuidv7；会话文件命名 `${fileTimestamp}_${sessionId}.jsonl`；**lazy 落盘**（第一条 assistant 消息才写文件）。

## 6. SDK（Node 内嵌）

`@earendil-works/pi-coding-agent` 导出 `createAgentSession`（恢复历史进 agent.state）、`SessionManager`、`AgentSessionRuntime`、`ExtensionAPI` 类型。

SessionManager 关键 API：`create/open/continueRecent/list/listAll`、`newSession/setSessionFile`、`appendMessage/appendSessionInfo(name)/branch/createBranchedSession`、`buildSessionContext`。

**一个进程同一时刻一个活动会话**；`AgentSessionRuntime.switchSession` = 整体替换运行时（dispose → 重建 Agent + SessionManager + rebind）。

## 7. Pi Packages（打包分发）

Bundle 扩展 + skills + prompts + themes 为一个可分发包（npm 包，package.json `pi` 字段声明内容）。适合把整套二次开发能力分发给用户。

## 8. 参考项目（GitHub，二次开发范本）

- `agegr/pi-web` — Pi Agent 的 Web UI（RPC 对接参考）
- `cellinlab/how-pi-agent-works` — Pi 原理与实现剖析
- `disler/pi-vs-claude-code` — Pi vs Claude Code 对比
- `K-Dense-AI/scientific-agent-skills` — 科学领域 skills 库（兼容 Pi/Agent Skills 标准）
- `spences10/pirecall` — 会话同步到 SQLite（session 文件解析范例）
- `SaladDay/pi-from-scratch` — 600 行迷你 Pi（理解核心机制）

## 9. 常见坑（从真实项目教训蒸馏）

- **会话身份单一权威**：对外暴露会话 id 时，以 Pi `get_state` 返回值为准，不要自维护一套 id 记账（缓存镜像、队列映射都容易漂移）。
- **不要平行实现状态**：Pi 已有会话/队列/compaction，任何自造的"第二套会话状态"都会在 compaction 后失同步。
- **内核零改动**：验收时 `git diff` 核心包源码，改动应全部落在扩展层。
- **lazy 落盘**：RPC 模式下会话文件在第一条 assistant 消息前不存在，别在 `new_session` 后立即找文件。
- **一个进程一个活动会话**：SDK 内嵌时切换会话是整体替换运行时，不是"切一个指针"。
