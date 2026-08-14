---
source: https://pi.dev/docs/latest/session-format
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Session 格式参考（JSONL 会话文件）

> 适用对象：需要理解/解析会话文件、做持久游标、或需要与 Pi 会话树交互的开发者。
>
> 事实等级：✅ OFFICIAL（官方文档明确说明） / ⚠️ INFERENCE（由官方 API/源码/行为推导） / 🧪 PRACTICE（工程实践建议）。

## 1. 文件位置与命名

- 路径：`~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`，其中 `<path>` 是工作目录、`/` 替换为 `-`。
- 每行一个 JSON 对象，首行是 session header；**删除 `.jsonl` 即删除会话**（`/resume` 支持交互删除，优先用系统回收站）。
- 会话经 `id`/`parentId` 组成树：第一个 entry 的 `parentId: null`，分支在更早的 entry 下挂新孩子，leaf 即当前位置。
- 版本：v1 线性（旧版自动迁移）、v2 树结构、v3 将 `hookMessage` 角色改名为 `custom`；**加载时自动迁移到 v3**。

## 2. Entry 基础字段（header 除外）

```typescript
interface SessionEntryBase {
  type: string;                 // entry 类型
  id: string;                   // 8 位 hex，稳定不变 → 可作持久游标
  parentId: string | null;      // 父 entry（首个为 null）
  timestamp: string;            // ISO 时间戳
}
```

## 3. Entry 类型一览

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

**CompactionEntry（`type:"compaction"`）** — 新式还带 `retainedTail`（压缩后保留的 `AgentMessage[]`，使该 entry 成为自包含检查点）：

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

## 4. 树结构与上下文构建

```
[user msg] ─── [assistant] ─── [user msg] ─── [assistant] ─┬─ [user msg] ← 当前 leaf
                                                            └─ [branch_summary] ─── [user msg] ← 废弃分支
```

- `buildContextEntries()`：从 leaf 回走到 root，得到活动 entry 列表并应用压缩；路径上有 `CompactionEntry` 时先包含它（有 `retainedTail` 则自包含，否则从 `firstKeptEntryId` 起）；非消息 entry 保留供 TUI 渲染。
- `buildSessionContext()`：产出 LLM 消息列表 —— `message` → 存储的 AgentMessage；`compaction` → `compactionSummary` + `retainedTail`；`branch_summary` → `branchSummary`；`custom_message` → `CustomMessage`；`custom` → **忽略**。

## 5. 落盘说明

- 文件是**追加式 JSONL**，append 方法即时返回新 entry id；`getSessionFile()` 在内存会话下为 `undefined`，`isPersisted()` 可判别。
- ⚠️ INFERENCE：落盘时机官方未明示（无"延迟/批量 flush"文档）——**别把"RPC 事件到达"当"文件已落盘"的信号**；需要确定性同步点时用 `compact` 响应、`export_html`、`new_session`/`switch_session` 等有确定响应的命令。

## 6. 会话身份的三层权威（集成时区分）

⚠️ INFERENCE：会话身份有三个层级，用途不同：

| 层级 | 形态 | 用途 |
|---|---|---|
| 会话级 | header UUID（`get_state.sessionId` / `SessionManager.getSessionId()`） | **对外暴露的权威身份**；不得自造 `project-`/`rpc-` 兜底 id |
| entry 级 | 8 位 hex id | 树内稳定，可作 `get_entries(since=...)` 持久游标 |
| 文件级 | `.jsonl` 路径 | `switch_session` / `open` 以路径为键 |

## 7. 集成要点（坑）

1. **文件删除即删会话**：会话按项目目录隔离存储（`--<path>--/`），删除文件前确认。
2. **版本迁移**：加载时自动迁移到 v3；解析外部文件时按 `version` 字段兼容，注意 `hookMessage` 在 v3 中已改名为 `custom`。
3. **`get_messages` vs `get_entries` 视角不同**：前者压缩后视角（仅供 LLM 上下文），后者完整追加历史（含废弃分支）——持久化/归档用 `get_entries`，显示当前对话用 `get_messages`。
4. **自定义数据策略**：`custom` 条目永存不进上下文（适合长期扩展状态）；`custom_message` 进上下文但会**被压缩折叠**（别把关键状态只放这里）；跨压缩保留的状态放 `details` 并自行解析上次 `CompactionEntry.details`。

> 相关：压缩机制见 `compaction.md`；RPC/SDK 中的会话命令见 `rpc.md` / `sdk.md`。
