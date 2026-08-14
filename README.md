# Pi Agent 二次开发：Architecture Guardrail + Agent Skill

**Pi Agent（pi.dev）二次开发指南与架构约束 Skill**——帮助开发者和 Coding Agent 选择正确的扩展层，避免"在 Pi 外面重新造一个 Pi"。

## 它解决什么问题

> 核心问题不是 "Pi 有哪些 API"，而是 **"一个需求应该使用 Pi 的哪一层能力实现，以及哪些东西不应该重新实现？"**

- 开发前判断能力归属（Native / Extension / Skill / RPC / SDK）
- 避免重新实现 Pi 已经拥有的能力（会话、压缩、工具系统、模型管理…）
- 防止产生第二套 runtime / state / session / tool system
- 让大型 reference 按需加载
- 验收一个 Pi 二次开发项目的架构是否正确

## 基本原则

```text
Native First
       ↓
Extension / Skill / RPC / SDK
       ↓
Thin Integration
       ↓
Pi remains runtime authority
```

## 使用方式

**作为 Skill（推荐）**：把本目录放入 `~/.pi/agent/skills/`（或项目 `.pi/skills/`，需信任项目）。模型在做 Pi 二次开发任务时会自动加载它作为架构守则。

**作为文档**：`SKILL.md` 是路由器（核心规则 + 按任务路由），`references/` 是按需加载的详细知识。

## 仓库结构

```
pi-agent-development/
├── SKILL.md                    # Router：核心规则 + Capability Assessment + Reference Routing
├── references/
│   ├── architecture.md         # 架构守则：分层模型、四条不可违反规则、责任边界
│   ├── decision-tree.md        # 能力归属决策树 + Capability Assessment 模板
│   ├── anti-patterns.md        # 11 个反模式（BAD / WHY / GOOD / EXCEPTION）
│   ├── extensions.md           # Extension API 全量参考（官方文档蒸馏）
│   ├── skills.md               # Skills 开发参考（官方文档蒸馏）
│   ├── rpc.md                  # RPC Mode 集成参考（官方文档蒸馏）
│   ├── sdk.md                  # SDK 内嵌参考（官方文档蒸馏）
│   ├── sessions.md             # 会话文件格式参考（官方文档蒸馏）
│   ├── compaction.md           # 压缩机制参考（官方文档蒸馏）
│   ├── packages.md             # Pi Packages + Prompt Templates（官方文档蒸馏）
│   └── acceptance.md           # 架构验收协议（PASS / WARNINGS / FAIL）
└── examples/
    ├── extension-minimal/      # 最小扩展示例
    ├── rpc-node-minimal/       # 最小 RPC 客户端（零依赖）
    ├── sdk-minimal/            # 最小 SDK 内嵌示例
    └── web-bridge-minimal/     # Browser ↔ Adapter ↔ Pi RPC 通用技术示范
```

## 事实等级

所有 reference 标注来源（`source` / `verified_at` / `upstream_commit`），并区分：

- ✅ **OFFICIAL** — Pi 官方明确说明的行为/API
- ⚠️ **INFERENCE** — 由官方 API/源码/行为推导
- 🧪 **PRACTICE** — 工程实践建议，不代表官方规范

## 它不是什么

- ❌ 不是 Pi 的 fork 或替代品
- ❌ 不是 Agent Framework
- ❌ 不是 Web UI / 具体应用
- ❌ 不提供任何特定业务实现
- ❌ 不包含任何私有项目内容

本仓库只保留 **generic / reusable / open-source friendly** 的 Pi 集成知识与规范。

## 许可证

[MIT](LICENSE)
