# Pi Agent Development Skill

**This repository is an Agent Skill** — an architecture guardrail for building ON TOP of Pi Agent (pi.dev) without rebuilding it. It is not a regular application repository and not an Agent Framework.

Core deliverable: `SKILL.md`（Router）+ `references/`（按需加载的知识）。

## 1. What this Skill is

帮助开发者和 Coding Agent 选择正确的扩展层，避免"在 Pi 外面重新造一个 Pi"：

- 开发前判断能力归属（Native / Extension / Skill / RPC / SDK）
- 避免重新实现 Pi 已经拥有的能力（会话、压缩、工具系统、模型管理…）
- 防止产生第二套 runtime / state / session / tool system
- 让大型 reference 按需加载（Progressive Disclosure）
- 验收一个 Pi 二次开发项目的架构是否正确

> 核心问题不是 "Pi 有哪些 API"，而是 **"一个需求应该使用 Pi 的哪一层能力实现，以及哪些东西不应该重新实现？"**

## 2. Install

**方式一：git clone**

```bash
git clone https://github.com/shangdi178/pi-agent-development ~/.pi/agent/skills/pi-agent-development
```

**方式二：Release 压缩包（推荐，无需 git）**

```text
GitHub Releases
→ 下载 pi-agent-development.zip（或 pi-agent-development.tar.gz）
→ 解压得到 pi-agent-development/
→ 放入 ~/.pi/agent/skills/
→ 重启 Pi 或 /reload
```

安装后，模型在做 Pi 二次开发任务时自动加载它作为架构守则（也可放入项目 `.pi/skills/`，需信任项目）。**只需 `SKILL.md` + `references/` 即可完成核心工作；`examples/` 与 `scripts/` 均非必需。**

## 3. How it works

```text
Install
↓
Pi discovers SKILL.md
↓
Agent loads Skill when Pi-development task matches
↓
SKILL.md performs architecture routing (Capability Assessment)
↓
Agent reads only required references/
```

## 4. Core architecture rule

```text
Native First
       ↓
Extension / Skill / RPC / SDK
       ↓
Thin Integration
       ↓
Pi remains runtime authority
```

## 5. Structure

```
pi-agent-development/
├── SKILL.md                    # Skill Router：核心规则 + Capability Assessment + Reference Routing
├── references/                 # 按需加载的详细知识（11 份，见下）
├── examples/                   # 可选学习/参考材料（见 §7，Skill 加载不依赖它们）
├── scripts/                    # 仓库维护工具（见 §8，正常使用 Skill 时不需要执行）
└── .github/workflows/verify.yml# 仓库 CI（见 §8）
```

## 6. References

`SKILL.md` 是路由器：核心规则 + 按任务路由，`references/` 按需加载，Agent 不预读全部。

| Reference | 内容 |
| --- | --- |
| `references/architecture.md` | 架构守则：分层模型、不可违反规则、责任边界 |
| `references/decision-tree.md` | 能力归属决策树 + Capability Assessment 模板 |
| `references/anti-patterns.md` | 11 个反模式（BAD / WHY / GOOD / EXCEPTION） |
| `references/extensions.md` | Extension API 参考（官方文档蒸馏） |
| `references/skills.md` | Skills 开发参考（官方文档蒸馏） |
| `references/rpc.md` | RPC Mode 集成参考（官方文档蒸馏） |
| `references/sdk.md` | SDK 内嵌参考（官方文档蒸馏） |
| `references/sessions.md` | 会话文件格式 + 会话身份术语（canonical） |
| `references/compaction.md` | 压缩机制参考（官方文档蒸馏） |
| `references/packages.md` | Pi Packages + Prompt Templates（官方文档蒸馏） |
| `references/acceptance.md` | 架构验收协议（PASS / WARNINGS / FAIL） |

事实等级：✅ OFFICIAL（官方明确说明）/ ⚠️ INFERENCE（由官方 API/源码/行为推导）/ 🧪 PRACTICE（工程实践建议）。所有 reference 标注 `source` / `verified_at` / `upstream_commit`。

## 7. Examples（可选）

```text
examples/ are optional learning/reference material.
They are not required for the Skill to load.
```

| 示例 | 前置 | 运行 | 演示什么 |
| --- | --- | --- | --- |
| `examples/extension-minimal/` | `npm install`（需已安装 pi） | 拷贝到 `~/.pi/agent/extensions/` 后 `/reload`，或 `pi -e ./src/index.ts` | 最小扩展：`registerTool` 注册一个工具 |
| `examples/rpc-node-minimal/` | 已安装 pi 命令 | `node index.js`（零依赖） | 零依赖 RPC 客户端：JSONL 分帧 + 流式拼装 |
| `examples/sdk-minimal/` | `npm install` | `node index.mjs` | Node 进程内嵌 SDK：`createAgentSession` + 事件订阅 |
| `examples/web-bridge-minimal/` | 已安装 pi 命令 | `node server.js` → 浏览器打开 `http://localhost:8080` | Browser ↔ Adapter ↔ Pi RPC：SSE + POST + abort + reconnect |

> 有模型凭据时四个示例均可完整对话；无凭据时仅 RPC/SSE 传输链路与语法可验证（CI 亦如此）。

## 8. Development / CI

```text
scripts/ contains repository validation tools.
They are not required during normal Skill invocation.
```

- `scripts/verify-docs.mjs` — 文档一致性 + **SKILL.md 自身格式**（frontmatter / name / description / 路由完整性）
- `scripts/verify-examples.mjs` — examples 的 npm install / 语法 / import 验证
- `scripts/verify-package.mjs` — Release 包结构验证（包根含 SKILL.md、无 node_modules/.git/日志/临时文件）
- `.github/workflows/verify.yml` — 以上三步的最小 CI，无需任何 LLM API key

## 它不是什么

- ❌ 不是 Pi 的 fork 或替代品
- ❌ 不是 Agent Framework
- ❌ 不是 Web UI / 具体应用
- ❌ 不提供任何特定业务实现
- ❌ 不包含任何私有项目内容

本仓库只保留 **generic / reusable / open-source friendly** 的 Pi 集成知识与规范。

## 许可证

[MIT](LICENSE)
