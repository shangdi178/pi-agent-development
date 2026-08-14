---
source: https://pi.dev/docs/latest （决策树为项目自身提炼，基于官方能力文档）
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Architecture Decision Tree（能力归属决策）

> 先判断能力归属，再实现。
>
> 所有 Pi 二次开发任务的统一入口：**需求 → 判断 → 选择层 → 实现 → 验收**。

## 1. Pi Native 能力清单（先查这里）

以下能力 **Pi 原生已具备**，任何需求先对照此清单：

| 能力 | 说明 |
|---|---|
| 会话（Session） | 新建/切换/分支/fork/clone/命名/恢复（RPC 或 SDK） |
| 消息历史 | 追加式 JSONL 会话树，`get_messages`/`get_entries` 读取 |
| 上下文压缩（Compaction） | 自动/手动触发，摘要保留近期工作 |
| 工具系统（Tool Registry） | 内置工具 + 扩展注册，LLM 自动调用 |
| 模型管理 | 多 Provider、模型切换、思考级别、OAuth 登录 |
| Skills | Agent Skills 标准：按需加载的能力包 |
| Prompt Templates | 可复用提示词 |
| 主题（Themes） | 界面主题 |
| 队列与 Steering | steer/followUp 排队投递机制 |

✅ 命中清单 → **直接调用 / 对接 / 状态投影，不重新实现。**

## 2. 决策树

```text
需求
 ↓
Pi Native 是否已经支持？
 ├─ YES
 │   ↓
 │  直接调用 / 对接 / 状态投影
 │  不重新实现
 │
 └─ NO
     ↓
属于 Agent 智能行为（工具/命令/事件/记忆）？
     → Extension

属于可复用指令/领域知识？
     → Skill

外部程序 / Server / Web Client 与 Pi 集成？
     → RPC

Node.js 进程需要直接内嵌 Pi？
     → SDK

需要修改 Pi Core？
     → 默认视为架构风险，重新评估需求
     （几乎总可以通过 Extension 或 RPC 替代）
```

## 3. Capability Assessment（开发前必填）

**复杂开发任务在写代码前，必须先完成 Capability Assessment** 并输出以下格式（可以直接作为实现的验收依据）：

```text
Capability Assessment

Requirement:
...（需求一句话）

Pi Native Capability:
...（对照 §1 清单，写明命中/未命中的原生能力）

Selected Integration Layer:
Native / Extension / Skill / RPC / SDK

Pi Core Modification:
NO

Parallel Agent Runtime:
NO

Parallel Session State:
NO

Parallel Tool Registry:
NO

Implementation Boundary:
...（实现范围：哪些归 Pi，哪些归你的代码）
```

## 4. 常见任务的正确路径

| 需求 | 错误做法 | 正确做法 |
|---|---|---|
| 给模型加一个新工具 | 自己写循环调 LLM | Extension `registerTool` |
| Web UI 展示会话 | 前端自己维护会话桶 | RPC + 状态投影 |
| 服务器对接 | Adapter 里实现会话逻辑 | RPC 薄封装 |
| Node 进程内嵌 | 复制 Pi 内核代码 | SDK `createAgentSession` |
| 重复的指令流程 | 写在每个 prompt 里 | Skill |
| 会话列表/切换 UI | 自己存 session 列表 | 原生 RPC 命令 |

## 5. 停止信号

出现以下任一情况，**停止编码，重新执行 Capability Assessment**：

- 实现开始大量复制 Pi 的原生能力；
- 需要自己维护"当前会话状态"的镜像；
- 需要自己管理工具名/参数 schema 的注册表；
- 需要解释"Pi 的会话和我们的会话怎么同步"。

> 继续判断：架构细节见 `architecture.md`；具体层实现见 `extensions.md` / `skills.md` / `rpc.md` / `sdk.md`；常见错误见 `anti-patterns.md`；验收见 `acceptance.md`。
