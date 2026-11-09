---
source: https://github.com/earendil-works/pi （需按目标版本核对包结构）
verified_at: 2026-11-10
upstream: earendil-works/pi
upstream_commit: unverified-for-this-guidance
fact_level: PRACTICE
---

# Minimum Package Layer — pi-ai / pi-agent / pi-coding-agent

> 🧪 PRACTICE：这是本项目的架构选择规则，并非对所有上游版本的 API、依赖关系或稳定性的官方承诺。实施前核对实际安装包的 exports、类型声明与版本。

## 1. 三层能力边界

| 选择 | 何时足够 | 不应默认引入 |
| --- | --- | --- |
| pi-ai | 单次/流式模型推理、Provider 适配、消息转换 | Agent loop、工具执行、coding workspace |
| pi-agent | 需要多步 Agent loop、工具调用、执行事件与状态 | 终端、文件编辑、coding-agent 会话 UI |
| pi-coding-agent | 需要 Pi 编程工作区、内置文件/终端能力、会话、Extension/Skill/RPC/SDK 集成 | 额外的平行 runtime、session、tool registry |

**最低充分层原则**：从 pi-ai 开始评估，只有明确缺失的能力才上升一层。高层可能依赖低层，但业务侧不必把高层当作统一入口。

## 2. 与 Native / Extension / Skill / RPC / SDK 的关系

这是两个正交决策：
1. **Package layer**：实际需要哪些执行能力？pi-ai / pi-agent / pi-coding-agent。
2. **Integration mechanism**：在选定运行时中，使用原生能力、Extension、Skill、RPC 还是 SDK？

Native / Extension / Skill / RPC / SDK 主要描述对 **Pi coding-agent 产品运行时** 的集成方式，不能机械套用到仅使用 pi-ai 的应用。若只用 pi-ai 自建应用，不存在必须由 Pi coding-agent 持有的会话权威。

## 3. 决策流程

```text
需求
├─ 只需模型响应/流式推理？ → pi-ai
├─ 需要循环规划、工具调用？ → pi-agent
└─ 需要 Pi coding workspace / 终端 / 文件 / 会话 / 扩展生态？ → pi-coding-agent

选择最低层后：
├─ 接入既有 Pi coding-agent → Native first，再选 Extension/Skill/RPC/SDK
└─ 独立服务或专业 Agent → 明确自己的 runtime/session/tool authority，避免双重权威
```

## 4. 专业 Agent 与多 Bot

- **科研/仿真 Agent**：可使用 pi-agent + 专业工具协议/服务；COMSOL 或其他求解器由专门适配器管理，不要求 coding-agent，也不默认经 Shell。
- **秘书/协调 Agent**：如需要多步调用检索、记忆、协调工具，可选 pi-agent；若只是模型路由或单次分类，可选 pi-ai。
- **开发 Agent**：只有需要真实 coding workspace、文件操作、终端、Pi 扩展生态时选择 pi-coding-agent。
- **多 Bot 平台**：共享协议、模型网关和基础库；各 Bot 的执行实例、权限、会话和资源边界明确隔离。外部协调器可以管理任务分派，但不应冒充某个 Pi session 的内部状态权威。
- **按需接入**：区分按任务启用工具、按进程初始化 Agent、按部署安装依赖；三者的成本和隔离效果不同。

## 5. Capability Assessment 扩展字段

```text
Minimum Package Layer: pi-ai | pi-agent | pi-coding-agent
Why Not Lower: ...
Integration Mechanism: Native | Extension | Skill | RPC | SDK | Standalone
Runtime Authority: ...
Session Authority: ...
Tool Authority: ...
Specialized Capability Boundary: ...
Permissions / Isolation: ...
Version Evidence: package version + exports/types/docs checked
```

## 6. 验收与反模式

PASS 条件：
- 选择最低充分层，升级到高层有明确功能理由。
- 不为单次模型推理加载完整 coding runtime。
- 专业工具不被强制包裹成终端脚本。
- 运行时、会话、工具注册权威清晰；每个独立 Agent 实例只有一个权威来源。
- 多 Bot 的权限和执行实例可隔离。
- 对未验证的上游 API 不作肯定性承诺。

FAIL 示例：
- 仅需 pi-ai 却启动完整 coding-agent。
- 在 Pi coding-agent 会话之外复制第二套 Agent loop/session/tool registry 并双向同步。
- 以“共享 Runtime”为由让只读 Bot 继承 Shell/写文件权限。
- 将本文件的工程建议写成 Pi 官方保证。
