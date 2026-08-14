---
source: https://pi.dev/docs/latest （验收清单为项目自身提炼，基于官方架构文档）
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Acceptance Protocol（二次开发架构验收）

> 用于验收任何基于 Pi Agent 的二次开发项目。逐项勾选，输出 `PASS` / `PASS WITH WARNINGS` / `FAIL` 并说明失败原因。
>
> 事实等级：🧪 PRACTICE（工程实践建议，基于官方架构文档提炼，非官方规范原文）。

## Architecture

```text
[ ] Pi core source unchanged unless explicitly justified
[ ] No parallel agent loop
[ ] No unnecessary parallel session manager
[ ] No parallel message history used as authority
[ ] No parallel tool registry
[ ] Pi remains runtime authority
```

## Session

```text
[ ] Session identity comes from Pi
[ ] New session semantics are correct
[ ] Switch session semantics are correct
[ ] Fork / clone behavior is correct when used
[ ] Compaction does not desynchronize external state
[ ] Restart / reconnect can restore authoritative state
```

## RPC

```text
[ ] JSONL framing is correct (LF-only, no readline)
[ ] Protocol stdout is not polluted
[ ] Command accepted != agent task completed
[ ] Streaming delta is assembled correctly
[ ] message_end is treated as authoritative final message
[ ] toolCallId correlation is correct
[ ] Abort is supported
[ ] Runtime errors propagate correctly
```

## SDK

```text
[ ] Session lifecycle is owned by Pi runtime
[ ] Runtime replacement is handled correctly
[ ] Event subscriptions are correctly restored when required
[ ] Native SessionManager behavior is not duplicated
```

## Extensions

```text
[ ] Native ExtensionAPI hooks are preferred
[ ] Extension lifecycle is respected (no long-running resources in factory)
[ ] Long-running resources are initialized in appropriate lifecycle stages
[ ] Core monkey patching is avoided
```

## UI / External Integration

```text
[ ] UI is a projection of Pi state
[ ] Reconnect reads authoritative state
[ ] External identifiers do not replace Pi session identity
[ ] Streaming status comes from Pi runtime events
```

## 验收结果

```text
PASS
PASS WITH WARNINGS
FAIL
```

失败必须说明原因。任何 `FAIL` 项都应回到 `decision-tree.md` 重新做 Capability Assessment，而不是打补丁绕过。

> 相关：判断依据见 `architecture.md` / `anti-patterns.md` / `decision-tree.md`。
