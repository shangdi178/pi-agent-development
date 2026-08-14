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

## 安装与使用

**方式一：git clone**

```bash
git clone https://github.com/shangdi178/pi-agent-development ~/.pi/agent/skills/pi-agent-development
```

**方式二：Release 压缩包（无 git 环境时）**

```text
GitHub Releases 下载 pi-agent-development-vX.Y.Z.zip
→ 解压
→ 把 pi-agent-development/ 目录放到 ~/.pi/agent/skills/
→ 重启 Pi 或执行 /reload
```

安装后，模型在做 Pi 二次开发任务时自动加载它作为架构守则（也可放入项目 `.pi/skills/`，需信任项目）。

**作为文档使用**：`SKILL.md` 是路由器（核心规则 + 按任务路由），`references/` 是按需加载的详细知识。

## 仓库结构

```
pi-agent-development/
├── SKILL.md                    # Router：核心规则 + Capability Assessment + Reference Routing
├── references/
│   ├── architecture.md         # 架构守则：分层模型、四条不可违反规则、责任边界
│   ├── decision-tree.md        # 能力归属决策树 + Capability Assessment 模板
│   ├── anti-patterns.md        # 11 个反模式（BAD / WHY / GOOD / EXCEPTION）
│   ├── extensions.md           # Extension API 参考（官方文档蒸馏）
│   ├── skills.md               # Skills 开发参考（官方文档蒸馏）
│   ├── rpc.md                  # RPC Mode 集成参考（官方文档蒸馏）
│   ├── sdk.md                  # SDK 内嵌参考（官方文档蒸馏）
│   ├── sessions.md             # 会话文件格式 + 会话身份术语（canonical）
│   ├── compaction.md           # 压缩机制参考（官方文档蒸馏）
│   ├── packages.md             # Pi Packages + Prompt Templates（官方文档蒸馏）
│   └── acceptance.md           # 架构验收协议（PASS / WARNINGS / FAIL）
├── examples/                   # 最小可运行示例（见下）
├── scripts/                    # 仓库自检脚本（verify-docs / verify-examples）
└── .github/workflows/verify.yml# 最小 CI：结构 + 语法 + import 验证（无需 LLM key）
```

## Examples 快速运行

| 示例 | 前置 | 运行 | 演示什么 |
| --- | --- | --- | --- |
| `extension-minimal/` | `npm install`（需已安装 pi） | 拷贝到 `~/.pi/agent/extensions/` 后 `/reload`，或 `pi -e ./src/index.ts` | 最小扩展：`registerTool` 注册一个工具 |
| `rpc-node-minimal/` | 已安装 pi 命令 | `node index.js`（零依赖） | 零依赖 RPC 客户端：JSONL 分帧 + 流式拼装 |
| `sdk-minimal/` | `npm install` | `node index.mjs` | Node 进程内嵌 SDK：`createAgentSession` + 事件订阅 |
| `web-bridge-minimal/` | 已安装 pi 命令 | `node server.js` → 浏览器打开 `http://localhost:8080` | Browser ↔ Adapter ↔ Pi RPC：SSE + POST + abort + reconnect |

> 有模型凭据时四个示例均可完整对话；无凭据时仅 RPC/SSE 传输链路与语法可验证（CI 亦如此）。

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
