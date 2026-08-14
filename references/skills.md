---
source: https://pi.dev/docs/latest/skills
source_extra: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Pi Agent Skills 开发参考（中文）

> 官方文档：https://pi.dev/docs/latest/skills
> 文档源码：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
> 定位：面向二次开发者的参考手册（蒸馏版，非文档搬运）

## 1. 技能是什么

技能（Skill）是「按需加载的自包含能力包」：把特定任务的工作流、设置说明、辅助脚本和参考资料打包在一起，模型在需要时才完整加载。Pi 实现了 Agent Skills 标准，对大多数违规只警告、不拒绝（宽松实现）。

核心机制：渐进式披露（progressive disclosure）——系统提示中只放技能名 + 描述（XML 形式列出），完整指令由模型用 `read` 按需加载，节省上下文。

注意：技能可指示模型执行任何操作（包括运行可执行文件），本质是模型的能力扩展。使用第三方技能前务必审查内容（官方安全提示）。

## 2. 目录结构

```
my-skill/
├── SKILL.md          # 必填：frontmatter + 指令正文
├── scripts/          # 辅助脚本（模型以相对路径调用）
│   └── process.sh
├── references/       # 详细文档，模型按需 read 加载
│   └── api-reference.md
└── assets/           # 资源文件（模板等）
    └── template.json
```

- 指令中一律使用「相对技能目录」的路径（`./scripts/...`、`references/...`）。
- 正文自由组织，通常含 Setup / Usage / 注意事项。

## 3. 发现路径与优先级

| 范围 | 路径 | 说明 |
|---|---|---|
| 全局 | `~/.pi/agent/skills/`、`~/.agents/skills/` | 用户级 |
| 项目 | `.pi/skills/`；`.agents/skills/`（cwd 及祖先目录，上溯到 git 仓库根或文件系统根） | 仅项目被信任后加载 |
| 包内 | 包的 `skills/` 目录，或 package.json 的 `pi.skills` 条目 | 见 packages 参考 |
| 设置 | settings 中 `skills` 数组（文件或目录） | 可指向其他 harness 的技能目录 |
| CLI | `--skill <path>`（可重复；即使加 `--no-skills` 也生效） | 临时显式加载 |

发现规则细节：

- `~/.pi/agent/skills/` 和 `.pi/skills/` 下：根目录直接放置的 `.md` 文件也当作单个技能。
- 所有技能位置：含 `SKILL.md` 的目录被递归发现。
- `~/.agents/skills/` 与项目 `.agents/skills/`：根目录 `.md` 文件被忽略（不算技能）。
- `--no-skills` 关闭自动发现，但显式 `--skill` 路径仍加载。
- 同名冲突：保留先找到的那个，并告警。

复用其他 harness 的技能（settings.json）：

```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

项目级 Claude Code 技能加入 `.pi/settings.json`：

```json
{
  "skills": ["../.claude/skills"]
}
```

## 4. SKILL.md 格式

YAML frontmatter + Markdown 正文：

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
```bash
cd /path/to/skill && npm install
```

## Usage

```bash
./scripts/process.sh <input>
```

See [the reference guide](references/REFERENCE.md) for details.
```

## 5. Frontmatter 字段（必填标注）

| 字段 | 必填 | 约束与说明 |
|---|---|---|
| `name` | 是 | ≤64 字符；仅小写字母 a-z、数字、连字符。Pi 不要求与父目录名一致。 |
| `description` | 是 | ≤1024 字符。做什么 + 何时用。**缺失 description 的技能不会被加载**（硬性）。 |
| `license` | 否 | 许可证名，或指向包内许可证文件的引用。 |
| `compatibility` | 否 | ≤500 字符，环境要求。 |
| `metadata` | 否 | 任意键值映射。 |
| `allowed-tools` | 否 | 空格分隔的预批准工具列表（实验性）。 |
| `disable-model-invocation` | 否 | 为 `true` 时从系统提示中隐藏，只能 `/skill:name` 手动加载。 |
| 未知字段 | - | 直接忽略。 |

name 命名规则（1–64 字符）：

- 合法：`pdf-processing`、`data-analysis`、`code-review`
- 非法：`PDF-Processing`（大写）、`-pdf`（首连字符）、`pdf--processing`（连续连字符）

description 最佳实践：描述决定模型何时触发技能，越具体越好。

- 好："Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents."
- 差："Helps with PDFs."

## 6. 模型如何触发技能

1. 启动时扫描技能位置，提取 name/description。
2. 系统提示中以 XML 形式列出可用技能（仅描述）。
3. 任务匹配时，模型用 `read` 加载完整 SKILL.md。
4. 按指令执行，用相对路径引用脚本/资源。

## 7. /skill:name 强制加载与参数传递

技能自动注册为 `/skill:name` 命令：

```
/skill:brave-search          # 加载并执行技能
/skill:pdf-tools extract     # 加载并传参
```

- 命令后的参数以 `User: <args>` 形式追加到技能内容末尾。
- 通过 `/settings` 或设置文件开关：

```json
{
  "enableSkillCommands": true
}
```

- 对 `disable-model-invocation: true` 的技能，这是唯一入口。

## 8. 依赖：scripts/ 与 references/

- `scripts/`：可执行脚本/程序，模型按指令运行（如 `./scripts/process.sh`）。技能自身的运行时依赖（如 npm 包）在 Setup 节说明，例如首次使用前 `cd /path/to/skill && npm install`。
- `references/`：按需加载的详细文档，SKILL.md 中用相对链接引用。典型用途：API 参考、长格式规范。
- `assets/`：非必需，存放模板等资源文件。

## 9. 验证与已知限制

- 对 Agent Skills 标准的违规大多只警告、仍可加载（宽松模式）。
- 警告条件：name >64 字符或含非法字符；name 首/尾连字符或连续连字符；description >1024 字符。
- 缺失 description 的技能不被加载（硬性失败）。
- 同名冲突：保留先找到的，告警。
- 未知 frontmatter 字段忽略。
- 技能内嵌的提示模板发现非递归（见 prompt-templates 文档）。

## 10. 参考示例：brave-search（官方文档示例）

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

```markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

```bash
cd /path/to/brave-search && npm install
```

## Search

```bash
./search.js "query" # Basic search
./search.js "query" --content # Include page content
```

## Extract Page Content

```bash
./content.js https://example.com
```
```

## 11. 技能仓库参考

- Anthropic Skills（文档处理 docx/pdf/pptx/xlsx、web 开发）：https://github.com/anthropics/skills
- Pi Skills（网页搜索、浏览器自动化、Google APIs、转录）：https://github.com/badlogic/pi-skills

## 12. 安全提示

技能可指示模型执行任意操作，且可能包含模型会调用的可执行代码。加载第三方技能前必须审查内容；官方文档明确建议：Review skill content before use.
