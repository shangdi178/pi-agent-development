---
source: https://pi.dev/docs/latest （反模式清单为项目自身提炼，基于官方架构文档）
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Anti-patterns（常见架构反模式）

> 这些实现"看起来能工作"，但在 Pi 架构下是不正确的。每个反模式按 BAD → WHY IT FAILS → GOOD → WHEN AN EXCEPTION MAY EXIST 组织。
>
> 事实等级：🧪 PRACTICE（工程实践建议，基于官方架构文档提炼，非官方规范原文）。

## 1. Parallel Agent Loop（第二套 Agent 循环）

**BAD**

自己写 `while (true)` 循环调 LLM API、拼消息、处理工具调用，模拟"Agent"。

**WHY IT FAILS**

你正在复制 Pi 的 Agent Runtime：流式管理、思考级别、工具调用循环、重试、steering 队列、自动压缩——每一项都要重写且永远赶不上 Pi 的语义。一旦 Pi 升级（新参数、新事件），你的循环立刻失配。会话历史也不再被 Pi 拥有，compaction 时必然漂移。

**GOOD**

Pi 拥有循环。需要新工具用 `registerTool`；需要干预行为用官方事件（`tool_call` 拦截）；需要程序化控制用 RPC/SDK 的 `prompt`/`steer`/`abort`。

**WHEN AN EXCEPTION MAY EXIST**

暂无。任何"自己跑 Agent 循环"的需求都应先评估是否真的需要 Pi 之外的循环——通常是需要重新理解需求。

---

## 2. Parallel Session Manager（第二套会话管理器）

**BAD**

自己维护会话列表、会话切换逻辑、"当前会话"指针，把 Pi 的会话树再抄一遍。

**WHY IT FAILS**

会话的权威在 Pi（`get_state.sessionId`、SessionManager、`.jsonl` 文件）。第二套管理器从创建起就与 Pi 不同步：fork/clone/compaction/switch 后你的记录全是错的。多一份状态 = 多一份需要同步的真相 = 多一类 bug。

**GOOD**

列表/切换/新建/命名全部走原生能力：RPC 侧用 `switch_session`/`new_session`/`set_session_name`，SDK 侧用 `SessionManager`（`list`/`open`/`continueRecent`/`getSessionId`）。外部只存 Pi 返回的 id/路径，不存"自己的会话状态"。

**WHEN AN EXCEPTION MAY EXIST**

仅当你的产品域需要与 Pi 无关的持久化（如把会话元数据存进自己的数据库做检索）——但此时仍以 Pi 的 id 为外键，不复制会话逻辑。

---

## 3. Parallel Message History（第二套消息历史）

**BAD**

前端/服务端自己维护一份消息列表副本，resume 时逐条回放，之后靠自己追加新消息。

**WHY IT FAILS**

消息历史是 Pi 的权威状态：compaction 会折叠历史、branch 会替换历史、`get_messages` 与 `get_entries` 视角不同。你的副本在任意一次压缩后就会与 Pi 漂移，回放还会产生"重复消息"。

**GOOD**

UI 只做**状态投影**：以 Pi 快照初始化，之后持续以事件流（`message_start`/`message_update`/`message_end`）更新，以 `message_end.message` 为准。

**WHEN AN EXCEPTION MAY EXIST**

临时渲染优化（如本地增量渲染）可以保留短期副本，但必须明确它不是权威，且以 Pi 事件为准刷新。

---

## 4. Parallel Tool Registry（第二套工具注册表）

**BAD**

自己维护"可用工具列表 + 参数 schema + 权限"，再映射到 Pi 的工具。

**WHY IT FAILS**

工具注册的权威在 Pi（`getAllTools`/`getActiveTools`/`setActiveTools`、Extension `registerTool`、SDK `customTools`）。第二套注册表很快与 Pi 不一致：扩展加载、工具启用/禁用、模型上下文中的工具列表，你的映射永远是过期的。

**GOOD**

需要新工具 → Extension `registerTool` 或 SDK `defineTool`；需要管理 → 原生 `getAllTools`/`setActiveTools`；UI 要展示 → 从 Pi 查询后投影。

**WHEN AN EXCEPTION MAY EXIST**

暂无。

---

## 5. Parallel Agent State（第二套 Agent 状态）

**BAD**

镜像缓存 Pi 的运行状态（isStreaming、isCompacting、当前工具执行中…）并当作真相信号驱动 UI。

**WHY IT FAILS**

镜像状态没有权威来源：事件丢失、顺序错乱、重连后镜像为空——UI 会显示错误状态。你在维护一个必然过期的真相副本。

**GOOD**

以 `get_state` + 事件流为唯一信号源：`agent_start/end`、`turn_start/end`、`tool_execution_*`、`compaction_start/end`。UI 状态是这些信号的纯函数。

**WHEN AN EXCEPTION MAY EXIST**

暂无。

---

## 6. 自己生成第二套 Session Identity（自造会话 id）

**BAD**

自己生成 `project-${id}`、`rpc-${Date.now()}` 之类的会话 id，并用自己的 id 与 Pi 的会话对应。

**WHY IT FAILS**

Pi 的会话身份（`sessionId`）是 uuidv7，写入会话 header，并用于会话文件命名与 `get_state.sessionId`；但 **`switch_session` 的定位参数是会话文件路径（`sessionPath`），不是 `sessionId`**——路径与身份是两把键，不能混用（术语见 `sessions.md` §6）。自造的 id 与 Pi 无关联，重连、切换、多端并发时无法映射；一旦 Pi 的 id 变了，你的整个记录失效。

**GOOD**

一切从 Pi 派生：`new_session` 的响应、`get_state.sessionId`、`SessionManager.getSessionId()`。外部系统只存 Pi 的 id（或 `.jsonl` 路径作为文件级键）。

**WHEN AN EXCEPTION MAY EXIST**

产品域需要自己的业务 id（如数据库主键）时，用它作外键引用 Pi id，而不是替换它。

---

## 7. 将前端状态作为 Agent Runtime 权威状态

**BAD**

UI 组件持有"当前会话/当前消息/当前工具状态"，并基于它做决策（如决定要不要发送、显示什么、禁用什么按钮），Pi 反而只是附属。

**WHY IT FAILS**

权威倒置：浏览器刷新、多标签、网络重连后 UI 状态丢失，而 Pi 才是持有真相的一方。UI 基于过期状态做的任何决策都是错的。

**GOOD**

**UI 是 Pi 状态的投影**：重连时读取权威状态（`get_state`/`get_entries`/事件流）重建视图；交互（发送、中止、切换）只是向 Pi 发出请求。

**WHEN AN EXCEPTION MAY EXIST**

纯视觉状态（主题、折叠、滚动位置）归 UI 没问题——它们不是 Agent 状态。

---

## 8. 将 RPC command success 理解为 Agent 已完成任务

**BAD**

```javascript
const res = await sendCommand({ type: "prompt", message: "fix the bug" });
if (res.success) showToast("完成！");
```

**WHY IT FAILS**

`success:true` 只表示命令被**接受/排队**，不代表 Agent 任务完成。真正的结果在事件流里（`agent_end`/`agent_settled`、`message_end`），失败也走事件/消息通道。按 `success` 判断会让 UI 在 Agent 还在思考时就宣布完成，或在失败时不提示。

**GOOD**

- 接受信号：`response.success`
- 完成信号：`agent_end` / `agent_settled`（配合 `message_end` 取最终文本）
- 失败信号：`extension_error`、错误消息、`abort` 后的 `agent_end`

**WHEN AN EXCEPTION MAY EXIST**

只关心"命令是否被受理"的场景（如只入队不等待结果）。

---

## 9. Copy Pi Core Logic 到集成项目

**BAD**

把 Pi 的 `SessionManager`、compaction 算法、工具执行逻辑的代码片段复制/改写进你的项目。

**WHY IT FAILS**

你在维护 Pi 内核的私人 fork：上游修复的 bug、新特性永远到不了你这里；你的副本与官方行为逐步分叉，最终无法验证正确性。这也违反 MIT 项目的基本维护纪律。

**GOOD**

通过官方 API 使用：`@earendil-works/pi-coding-agent` 导入、RPC 调用、Extension 注册。需要理解原理就读源码/文档（如 `SaladDay/pi-from-scratch` 这类学习项目），但**不复制到产品代码**。

**WHEN AN EXCEPTION MAY EXIST**

仅当你在向 Pi 上游贡献（fork + PR），且不部署为独立产品。

---

## 10. 为普通功能直接修改 coding-agent core

**BAD**

直接改 `node_modules/@earendil-works/pi-coding-agent` 或源码仓库里的 `packages/coding-agent/src/*.ts` 来实现你的功能。

**WHY IT FAILS**

升级即丢失（npm 重装/拉新版本全部覆盖）；你失去了官方支持；你的改动无法审查。绝大多数需求都有官方扩展点。

**GOOD**

默认使用 Extension 层：`registerTool`/`registerCommand`/`on(event)`/`registerProvider`。验收标准：`git diff` 核心源码为空。

**WHEN AN EXCEPTION MAY EXIST**

提交 PR 回上游（不本地长期持有）；或上游明确接受 patch 且你维护 fork。

---

## 11. 在 Adapter 中逐步重新实现 Pi

**BAD**

Adapter/Server 一开始只是转发 RPC，后来逐步加入：参数校验、会话记账、消息重组、错误重试逻辑、状态推断……最终变成"第二个 Agent Backend"。

**WHY IT FAILS**

最隐蔽的反模式：每加一点都"只是个小逻辑"，但累积起来 Adapter 成为并行运行时——两处逻辑两处真相，任何不一致都难查。

**GOOD**

Adapter 职责固定为三件：**传输转换、RPC 进程管理、事件转发**。新增需求先问：这逻辑应该在 Pi（Extension/事件）还是在投影层（UI），还是根本不该有？

**WHEN AN EXCEPTION MAY EXIST**

产品域的持久化（与 Pi 无关的业务数据）允许在 Adapter，但必须与 Pi 状态隔离，以 Pi id 为外键。

---

## 对应推荐方案速查

| ❌ 反模式 | ✅ 推荐方案 |
|---|---|
| Parallel Agent Loop | Pi-owned Runtime |
| Parallel Session Manager | Pi-owned Session Lifecycle |
| Parallel Message History | State Projection |
| Parallel Tool Registry | Pi-owned Tool Execution |
| Parallel Agent State | RPC Event Translation |
| 自造 Session Identity | Pi 派生 id |
| 前端状态作权威 | State Projection |
| success 当完成 | 事件流判断 |
| Copy Core Logic | 官方 API / Thin Adapter |
| 改 core | Extension Hook |
| Adapter 重造 Pi | Thin Adapter / Agent Skills / Native first |
