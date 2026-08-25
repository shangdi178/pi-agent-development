---
source: https://pi.dev/docs/latest （架构原则为项目自身提炼，非官方原文）
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Architecture Guardrail（架构守则）

> 核心问题不是 "Pi 有哪些 API"，而是 **"一个需求应该使用 Pi 的哪一层能力实现，以及哪些东西不应该重新实现？"**
>
> 核心原则：**Do not rebuild Pi outside Pi.**
>
> 事实等级：✅ OFFICIAL（官方文档明确说明） / ⚠️ INFERENCE（由官方 API/源码/行为推导） / 🧪 PRACTICE（工程实践建议，本文件多数条目属此类）。

## 1. Pi 的分层能力模型

```
┌─────────────────────────────────────────────────┐
│  Browser / External Program / Other Harness      │  ← 只能看到投影
│         ↓  投影（projection），不持有权威状态     │
│  Adapter / Server / CLI 包装                     │  ← 薄封装：传输转换 + 进程管理
│         ↓  RPC JSONL 或 SDK 调用                 │
│  Pi Agent Runtime（唯一权威）                     │  ← 会话 / 推理 / 工具 / 记忆 / 压缩
│     ├─ Native 能力（Sessions/Compaction/Tools/    │
│     │   Skills/Providers/模型选择…）              │
│     ├─ Extension 层（registerTool 等官方机制）     │
│     └─ Skills / Prompt Templates / Pi Packages    │
└─────────────────────────────────────────────────┘
```

| 层 | 职责 | 禁止 |
|---|---|---|
| **Native** | Pi 内核已具备的会话、压缩、工具、技能、模型、Provider 管理 | 重写、fork 内核 |
| **Extension** | 新增智能能力：工具/命令/事件/记忆（`pi.registerTool` 等官方机制） | 修改 coding-agent 核心源码 |
| **Skill** | 可复用的指令包与领域知识（Agent Skills 标准） | 把 Skill 写成第二个 Agent Runtime |
| **Adapter / Server** | Pi RPC 的薄封装 + 产品域持久化 | 再造会话/队列/状态机第二套逻辑 |
| **UI / Client** | 状态投影、交互收集 | 自造权威状态、第二个 Agent 循环 |

## 2. 四条不可违反的架构规则

### 2.1 Pi 是运行时权威（Runtime Authority）

会话生命周期、消息历史、工具执行、压缩时机——全部由 Pi 运行时拥有。任何外部系统只能**读取和投影**，不能成为权威来源。

- 会话身份来自 Pi（`get_state.sessionId` / `SessionManager.getSessionId()`），外部一律派生，不自造 `project-`/`rpc-` 兜底 id。
- 前端展示的状态是 Pi 状态的投影，不是第二份真相。

### 2.2 禁止平行实现（No Parallel Runtime）

以下任何一项都意味着你在"Pi 外面重新造 Pi"，属于架构错误：

- 第二个 Agent Loop（自己写 while 循环调用 LLM）
- 第二套 Session Manager / 消息历史（自己维护队列和会话桶）
- 第二套 Tool Registry（自己管理工具名和参数 schema）
- 第二套状态机（镜像缓存 Pi 的状态并当作真相）

⚠️ INFERENCE：Pi 的会话树、compaction、队列、工具系统都是原生能力；任何自造的平行实现都会在 compaction 或会话切换后失同步。

### 2.3 薄适配器（Thin Adapter）

Adapter/Server 只做三件事：**传输转换、RPC 进程管理、事件转发**。

- 不允许在 Adapter 中逐步复制 Pi 的逻辑（参数校验、会话记账、消息重组）。
- 判断标准：如果 Adapter 需要维护"当前会话在干什么"的状态，说明你正在重造第二个 Agent Backend。

### 2.4 Native First（原生优先）

- 需求先对照 Native 能力清单（见 `decision-tree.md` §1）。
- 能力已具备 → 直接调用/对接/投影，一行不写重实现。
- 能力缺失 → 按 `decision-tree.md` 选择 Extension / Skill / RPC / SDK。
- 需要修改 Pi Core → 默认视为架构风险，先重新评估需求。

## 3. 责任边界速查

| 对象 | 拥有什么 |
|---|---|
| Pi | Agent Runtime、Session Authority、Tool Runtime、Message Lifecycle、Compaction |
| Extension | 新增工具/命令/事件/记忆（通过官方 API） |
| Adapter Server | Transport Translation、RPC Process Management、Event Forwarding |
| Browser / Client | State Projection、User Interaction |

## 4. 通用集成模式

- **Native capability first**：所有需求先查原生能力。
- **Pi-owned runtime**：运行时/会话/工具全归 Pi。
- **Pi-owned session lifecycle**：列表/切换/新建/命名走原生 RPC 或 SessionManager。
- **State projection**：UI = Pi 状态的投影。
- **RPC event translation**：Pi 事件流 → 外部协议（SSE/WS/消息队列），只做翻译不做裁决。
- **Extension hook**：需要干预行为用官方事件（`tool_call` 拦截、`session_before_compact` 等）。
- **Agent Skills**：可复用指令/领域知识用 Skill。

## 5. 事实等级与来源纪律

本项目是公开技术资料项目，**事实可信度比内容数量重要**。

- ✅ **OFFICIAL**：Pi 官方明确说明的行为/API。
- ⚠️ **INFERENCE**：根据官方 API、源码或行为推导出的结论。
- 🧪 **PRACTICE**：工程实践建议，不代表 Pi 官方规范。

禁止把推论、项目经验、推荐架构写成 Pi 官方事实。无法验证的 API 或行为必须明确标记不确定性。来源记录见各文件 frontmatter（`source` / `verified_at` / `upstream_commit`）。

## 6. 版本基线与漂移防护

本 Skill 的 API 事实验证自各 reference frontmatter 锁定的 `upstream_commit`。Pi 迭代很快，Agent 在真实项目中使用本 Skill 时遵循以下可执行步骤：

1. **默认信任基线**：按本 Skill 记载的 API 写代码；**不凭记忆引入基线中不存在的 API 或参数**。
2. **核对触发条件**（任一命中即先核对再动手）：任务涉及安装/升级 `@earendil-works/pi-coding-agent`；代码报"符号不存在/类型不匹配"；用户要求使用基线之后的新特性。
3. **核对动作**：读本地 `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` 确认符号与签名存在；必要时查包内 `CHANGELOG.md`；以实际安装版本的类型为准，并提示用户"本 Skill 基线可能滞后于该版本"。

> 🧪 PRACTICE：此协议的思路借鉴自社区 skill 的版本基线管理实践（见 README 致谢），为本项目的工程纪律，非 Pi 官方规范。
