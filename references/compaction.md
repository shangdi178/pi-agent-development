---
source: https://pi.dev/docs/latest/compaction
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Compaction 参考（上下文压缩机制）

> 适用对象：需要理解压缩如何影响会话状态、外部状态如何与压缩后的会话保持一致的开发者。
>
> 事实等级：✅ OFFICIAL（官方文档明确说明） / ⚠️ INFERENCE（由官方 API/源码/行为推导） / 🧪 PRACTICE（工程实践建议）。

## 1. 是什么

"对话过长时，Pi 用压缩把较早内容总结掉，同时保留近期工作。" 两种机制共用同一摘要格式：

- **Compaction**：上下文超阈值自动触发，或 `/compact` 手动触发。
- **Branch summarization**：`/tree` 导航离开分支时保留上下文。

两者都累计跟踪文件操作，并使用全新的一次性路由会话 ID、禁用 prompt-cache 写入（一次性 prompt 不值得缓存）。

## 2. 触发条件与配置

自动压缩条件：`contextTokens > contextWindow - reserveTokens`。手动触发：`/compact [instructions]`（RPC：`{"type":"compact","customInstructions":"..."}`）。配置位于 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json`：

```json
{"compaction": {"enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000}}
```

| 设置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 自动压缩开关；`false` 只关自动，手动 `/compact` 仍有效 |
| `reserveTokens` | `16384` | 为 LLM 响应预留的 token |
| `keepRecentTokens` | `20000` | 保留不压缩的近期 token 数 |

## 3. 内部流程

1. **找切点**：从最新消息往回走，累计 token 估算直到 `keepRecentTokens`；
2. **提取消息**：从上一个保留边界（或会话起点）到切点；
3. **生成摘要**：结构化格式调 LLM，存在旧摘要时把旧摘要作为迭代上下文传入；
4. **追加 entry**：写 `CompactionEntry`（pi 生成时为 `summary` + `firstKeptEntryId`）；
5. **重建上下文**：summary + `firstKeptEntryId` 起的消息（若 entry 带 `retainedTail` 则直接使用内嵌消息，见 §5）。

重复压缩时，跨度从上次压缩的 `firstKeptEntryId` 开始（该 entry 缺失则从其下一个 entry），因此"逃过上次压缩的消息"会进入本次摘要；写入新 entry 前会基于重建后的上下文重算 `tokensBefore`。

**切点规则**：合法切点 = 用户消息、助手消息、`BashExecution` 消息、自定义消息（`custom_message`、`branch_summary`）；**绝不在工具结果处切**（工具结果必须与工具调用同存）。

**分裂回合**：一个回合以用户消息开头、到下一个用户消息结束。通常按回合边界切；若单回合超过 `keepRecentTokens`，切点落在回合中间（助手消息处），产生"分裂回合"：`isSplitTurn: true`、`messagesToSummarize: []`、`turnPrefixMessages` 保存前半段，生成两份摘要（历史 + 回合前缀）再合并。

**消息序列化**：摘要前用 `serializeConversation()` 序列化为 `[User]:`、`[Assistant thinking]:`、`[Assistant]:`、`[Assistant tool calls]:`、`[Tool result]:` 行，避免模型把它当连续对话；工具结果截断为 2000 字符并标记截断量。

## 4. 对开发者（自定义数据）的影响

| 问题 | 答案 |
|---|---|
| 自定义条目 compact 后还在吗？ | `custom` 条目不参与 LLM 上下文、也**不是合法切点**，仍在文件中；`custom_message` / `branch_summary` **是合法切点**，可能落在被摘要区域内而被折叠进 summary（不再逐字保留） |
| 工具结果会被切吗？ | 永不 —— 始终与工具调用在一起 |
| 自定义数据怎么保存？ | 两类 entry 都有通用 `details?: T`（任意 JSON 可序列化数据）。默认实现存 `{readFiles, modifiedFiles}`；扩展可实现自己的结构 |
| 文件跟踪丢失吗？ | 不丢失——文件操作从工具调用**和**上一次压缩/分支摘要的 details 中提取，跨多次压缩/嵌套分支累计，完整保留读/写文件历史 |
| LLM 用量丢失吗？ | 不丢失——生成的/扩展提供的摘要会记录 usage，计入会话总量 |
| 能拦截吗？ | `session_before_compact`（可取消、可提供自定义 summary）；`session_before_tree`（任何 `/tree` 导航前触发，可取消或提供自定义摘要） |

## 5. Entry 结构与摘要格式

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction"; id: string; parentId: string; timestamp: number;
  summary: string; firstKeptEntryId: string; tokensBefore: number;
  usage?: Usage;          // 生成摘要的 LLM 用量
  fromHook?: boolean;     // 由扩展提供（旧字段名）
  details?: T;            // 默认 CompactionDetails { readFiles: string[]; modifiedFiles: string[] }
}
```

**表示兼容性（重要）**：**不要假设所有 CompactionEntry 都只有一种表示方式**（官方文档同时描述了两种，见 `sessions.md` §3）：

- `firstKeptEntryId` → **compatibility / 旧表示**：官方源码（`session-manager.ts`）默认生成；上下文重建时从该 entry 起取保留消息。旧格式 `firstKeptEntryIndex` 会在加载时自动迁移为 `firstKeptEntryId`。
- `retainedTail` → **新式 harness 生成的检查点表示**：把压缩后保留的 `AgentMessage[]` 直接内嵌在 entry 上，重建上下文无需回走 compaction 之前的 entry（自包含检查点）。官方文档对它的说明："optional only for backward compatibility with older sessions"——即新生成带 `retainedTail` 的会话是为了兼容"无此字段的旧会话"而保留 `firstKeptEntryId` 路径。

读取外部会话文件时按存在性分支：有 `retainedTail` 用之，否则从 `firstKeptEntryId` 起。

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

## 6. 集成要点（坑）

1. **压缩的异步性**：`compact` 的 `estimatedTokensAfter` 是估算；压缩刚完成后 `get_session_stats.contextUsage` 的 `tokens/percent` 为 `null`，直到下一次助手响应带回 usage。压缩可能被 `session_before_compact` 钩子取消（RPC 侧表现为无 `compaction_end` 事件）。
2. **自定义数据策略**：长期扩展状态放 `custom` 条目（文件里永存、不进上下文、不受压缩影响）；需要注入 LLM 的用 `custom_message`（但**会被压缩折叠**，别把关键状态只放这里）；要跨压缩保留的状态放 `details` 并自行解析上次压缩的 `CompactionEntry.details`（默认是 `readFiles`/`modifiedFiles`，扩展可自定义结构）。
3. **压缩不会让外部状态失同步**（前提：外部状态从 Pi 派生）：外部状态若自行维护历史副本，压缩后可能漂移——正确做法是只依赖 `get_state`/事件流，不依赖消息历史副本。
4. **读取 CompactionEntry 兼容两种表示**：有 `retainedTail` 用之（自包含检查点），否则从 `firstKeptEntryId` 起（见 §5）。

> 相关：会话文件格式见 `sessions.md`；RPC/SDK 中的压缩命令见 `rpc.md` / `sdk.md`。
