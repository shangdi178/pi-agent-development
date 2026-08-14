---
name: pi-agent-development
description: Architecture guardrail and development guide for building ON TOP of Pi Agent (pi.dev) without rebuilding it. Use BEFORE any Pi secondary-development task: choosing the correct layer (Native / Extension / Skill / RPC / SDK), checking whether a capability already exists natively, avoiding parallel runtime/session/state/tool systems, and accepting an integration's architecture. Trigger examples: "build a tool/extension/skill for Pi", "integrate Pi into a server/Web UI/CLI", "embed Pi in Node", "debug session switching/compaction", "is this capability already in Pi?".
---

# Pi Agent 二次开发：Architecture Guardrail + Router

> **Do not rebuild Pi outside Pi.**
>
> 核心问题不是 "Pi 有哪些 API"，而是 **"一个需求应该使用 Pi 的哪一层能力实现，以及哪些东西不应该重新实现？"**
>
> 本 SKILL.md 是**路由器**：只承担核心规则与路由。详细知识在 `references/`，按任务类型只读取需要的文件，不要整目录加载。

## 1. Purpose

本技能帮助基于 Pi Agent（pi.dev）做二次开发的开发者/Coding Agent：

1. 开发前判断能力归属（Native / Extension / Skill / RPC / SDK）；
2. 避免重新实现 Pi 已经拥有的能力；
3. 防止产生第二套 runtime / state / session / tool system；
4. 让大型 reference 按需加载；
5. 验收一个 Pi 二次开发项目的架构是否正确。

## 2. Core Rules（不可违反）

```text
1. Native First        —— 原生能力已具备 → 直接对接/投影，禁止重写
2. Extension First     —— 新增智能行为走官方扩展机制（registerTool 等）
3. Thin Adapter        —— Adapter/Server 只做传输转换 + 进程管理 + 事件转发
4. Single Source of Truth —— 会话/状态/工具的权威永远在 Pi
5. Minimal Projection  —— UI 是 Pi 状态的投影，不持有权威状态
6. No Parallel Runtime —— 禁止第二套 Agent Loop / Session / Message History / Tool Registry
7. Official Facts First —— 推论与经验不得写成官方事实（✅ OFFICIAL / ⚠️ INFERENCE / 🧪 PRACTICE）
8. Generic and Reusable —— 只加入通用、可复用、开源友好的内容
```

出现"实现开始大量复制 Pi 的原生能力"时：**停止编码，重新做 Capability Assessment。**

## 3. Capability Assessment（开发前必填）

复杂开发任务**写代码前**，先输出能力归属判断：

```text
Capability Assessment

Requirement: ...
Pi Native Capability: ...
Selected Integration Layer: Native / Extension / Skill / RPC / SDK
Pi Core Modification: NO
Parallel Agent Runtime: NO
Parallel Session State: NO
Parallel Tool Registry: NO
Implementation Boundary: ...
```

判定逻辑（详见 `references/decision-tree.md`）：

```text
需求 → Pi Native 已支持？
 ├─ YES → 直接调用/对接/状态投影，不重新实现
 └─ NO →
     智能行为（工具/命令/事件/记忆）? → Extension
     可复用指令/领域知识?            → Skill
     外部程序/Server/Web Client?     → RPC
     Node 进程内嵌?                  → SDK
     修改 Pi Core?                   → 架构风险，重新评估
```

## 4. Reference Routing（按任务类型读取）

不要默认加载整个 references/。按任务读取：

| 任务 | 读取 |
| --- | --- |
| **Extension 开发** | `architecture.md` → `decision-tree.md` → `extensions.md` → `anti-patterns.md` |
| **RPC 集成** | `architecture.md` → `decision-tree.md` → `rpc.md` → `sessions.md` → `anti-patterns.md` |
| **SDK 集成** | `architecture.md` → `decision-tree.md` → `sdk.md` → `sessions.md` → `anti-patterns.md` |
| **Skill 开发** | `skills.md`（+ `packages.md` 如需分发） |
| **Session 问题** | `sessions.md` → `compaction.md` → `rpc.md` 或 `sdk.md` → `anti-patterns.md` |
| **Web/Server 对接** | `architecture.md` → `decision-tree.md` → `rpc.md` → `sessions.md` → `anti-patterns.md` + `examples/web-bridge-minimal` |
| **打包分发** | `packages.md` |
| **架构验收** | `acceptance.md`（对照清单逐项） |

## 5. Anti-pattern Check（常见错误自查）

实现前/后快速自查（详见 `references/anti-patterns.md`）：

```text
❌ Parallel Agent Loop          ❌ Parallel Session Manager
❌ Parallel Message History     ❌ Parallel Tool Registry
❌ Parallel Agent State         ❌ 自造第二套 Session Identity
❌ 前端状态作权威                ❌ RPC success 当任务完成
❌ Copy Pi Core 到集成项目       ❌ 为普通功能改 coding-agent core
❌ Adapter 逐步重造 Pi
```

## 6. Implementation Rules

- 扩展：`registerTool`（typebox schema、execute、renderCall/renderResult、terminate）、`registerCommand`、`on(event)`；工厂里**不要**启动长驻资源（进程/定时器/监听），延迟到 `session_start` 或命令/工具内。
- RPC：严格 LF 分帧（Node `readline` 不兼容）；`message_update` 是 delta 需自行拼装，以 `message_end` 为准；`prompt` 的 `success:true` 只是接受 ≠ 完成；bash 结果下次 prompt 才进上下文。
- SDK：会话生命周期归 Pi runtime；`switchSession`/`newSession` 后事件订阅失效，须重订阅 + `bindExtensions`。
- 会话身份：一律从 Pi 派生（`get_state.sessionId` / SessionManager），不自造 id。
- 自定义数据：长期状态放 `custom` 条目（永存不进上下文）；注入 LLM 用 `custom_message`（会被压缩折叠）。

## 7. Acceptance（验收）

按 `references/acceptance.md` 对项目逐项验收：Architecture / Session / RPC / SDK / Extensions / UI。输出 `PASS` / `PASS WITH WARNINGS` / `FAIL`（FAIL 必须说明原因，回到 §3 重新评估）。

## 8. 官方资源

- 文档：https://pi.dev/docs/latest ｜ 源码：https://github.com/earendil-works/pi （MIT）｜ npm：`@earendil-works/pi-coding-agent`
- 安装：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- 参考项目：`agegr/pi-web`、`cellinlab/how-pi-agent-works`、`disler/pi-vs-claude-code`、`K-Dense-AI/scientific-agent-skills`、`spences10/pirecall`、`SaladDay/pi-from-scratch`
- 最小示例：`examples/`（extension-minimal / rpc-node-minimal / sdk-minimal / web-bridge-minimal）
