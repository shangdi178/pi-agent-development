---
source: https://pi.dev/docs/latest/packages
source_extra: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md
verified_at: 2026-08-14
upstream: earendil-works/pi
upstream_commit: 9d2ec7f
---

# Pi Agent Packages 开发参考（中文）

> 官方文档：https://pi.dev/docs/latest/packages
> 文档源码：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md
> 定位：面向二次开发者的参考手册（蒸馏版，非文档搬运）

## 1. 什么是 pi package

Pi 包把扩展（extensions）、技能（skills）、提示模板（prompts）、主题（themes）打包，通过 npm 或 git 分发共享。资源既可声明在 package.json 的 `pi` 键下，也可用约定目录自动发现。`pi` 本身可帮助脚手架创建 pi package。

安全警告（官方原文）：Pi 包以完整系统权限运行。扩展执行任意代码，技能可指示模型执行任何操作（包括运行可执行文件）。安装第三方包前务必审查源码。

## 2. package.json 的 pi 字段

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

- 路径相对包根目录；数组支持 glob 模式与 `!` 排除。
- keywords 中加 `pi-package` 便于 gallery 发现。

Gallery 元数据（可选）：

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

- `video`：仅 MP4；桌面端悬停自动播放、点击全屏。
- `image`：PNG / JPEG / GIF / WebP 静态预览。
- 两者都设置时 video 优先。

## 3. 约定目录（无 manifest 时自动发现）

| 目录 | 加载内容 |
|---|---|
| `extensions/` | `.ts` 和 `.js` 文件 |
| `skills/` | 递归找含 `SKILL.md` 的目录；顶层 `.md` 文件也作为技能 |
| `prompts/` | `.md` 文件 |
| `themes/` | `.json` 文件 |

## 4. 打包流程与依赖规则

1. 添加 `pi` manifest（或使用约定目录）+ `pi-package` keyword。
2. 第三方运行时依赖放 `dependencies`；pi 在 npm/git 安装时自动执行 `npm install`。
3. 核心包**不得打包进 tarball**，须列在 `peerDependencies`（`"*"`）：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`。
4. 其他 pi 包必须打进 tarball：`dependencies` + `bundledDependencies`，并在 `pi` 字段中通过 `node_modules/` 路径引用：

```json
{
  "dependencies": {
    "shitty-extensions": "^1.0.1"
  },
  "bundledDependencies": ["shitty-extensions"],
  "pi": {
    "extensions": ["extensions", "node_modules/shitty-extensions/extensions"],
    "skills": ["skills", "node_modules/shitty-extensions/skills"]
  }
}
```

Pi 以独立的模块根加载各包，不同安装互不冲突、不共享模块。

## 5. 分发与安装命令

```bash
# 安装
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo   # 裸 URL 亦可
pi install /absolute/path/to/package
pi install ./relative/path/to/package

# 管理
pi remove npm:@foo/bar
pi list                    # 查看 settings 中已安装的包
pi update                  # 仅更新 pi 本体
pi update --all            # pi + 包 + 对齐固定 git ref
pi update --extensions     # 仅更新包 + 对齐 ref
pi update --models         # 仅刷新模型目录
pi update --self           # 仅更新 pi
pi update --self --force   # 即使当前也强制重装 pi
pi update npm:@foo/bar     # 更新单个包
pi update --extension npm:@foo/bar

# 临时（仅本次运行，不写 settings）
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

包来源细节：

- **npm**：`npm:@scope/pkg@1.2.3` 或 `npm:pkg`。带版本号的 spec 会被固定、更新时跳过。全局装到 `~/.pi/agent/npm/`，项目装到 `.pi/npm/`。settings.json 的 `npmCommand` 可指定 npm 包装器（如 `["mise", "exec", "node@20", "--", "npm"]`）。
- **git**：支持 `git:github.com/user/repo@v1`、`git:git@github.com:user/repo@v1`、`https://github.com/user/repo@v1`、`ssh://git@github.com/user/repo@v1`。不带 `git:` 前缀时只接受协议 URL。ref 固定到 tag/commit；更新只同步 clone、不移动 ref。clone 到 `~/.pi/agent/git/<host>/<path>`（全局）或 `.pi/git/<host>/<path>`（项目）。checkout 变化时 pi 会 reset/clean 该 clone 并在存在 package.json 时自动 `npm install`。CI 提示：`GIT_TERMINAL_PROMPT=0` 禁用交互提示，`GIT_SSH_COMMAND` 可设 batch 模式。
- **本地路径**：绝对/相对路径指向文件或目录；文件按单个扩展加载，目录按包规则加载；相对路径相对 settings 文件解析。**不复制**，直接指向磁盘位置。

## 6. 作用域（user / project / temporary）

| 作用域 | 标志 | 行为 |
|---|---|---|
| 用户（全局） | 默认 | 写入 `~/.pi/agent/settings.json`；npm 装 `~/.pi/agent/npm/`，git 克隆 `~/.pi/agent/git/` |
| 项目 | `-l` | 写入 `.pi/settings.json`，可与团队共享；项目被信任后启动时自动补装缺失的包 |
| 临时 | `-e` / `--extension` | 安装到临时目录，仅当前运行生效 |

## 7. 包过滤（settings 对象形式）

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

规则：省略键 = 加载该类型全部；`[]` = 不加载；`!pattern` 排除；`+path` / `-path` 相对包根做精确强制包含/排除。过滤叠加在 manifest 之上，层层收窄。

## 8. 启用/禁用与去重

- `pi config` 可开关已安装包与本地目录的资源；从全局 settings 开始，Tab 切换全局/项目；`pi config -l` 从项目覆盖开始（继承的全局资源置灰显示）。
- 同一包同时出现在全局与项目 settings 时，项目条目优先；除非项目条目设 `autoload: false`，此时作为全局条目的 delta 叠加。
- 身份识别：npm 按包名；git 按去 ref 后的仓库 URL；本地按解析后的绝对路径。

## 9. 与直接放目录的区别

| | 本地路径直接引用 | npm / git 安装 |
|---|---|---|
| 复制/克隆 | 不复制，就地指向磁盘位置 | 复制/克隆进受管缓存目录 |
| 依赖 | 不自动安装 | 自动 `npm install` |
| 资源加载规则 | 相同（pi manifest 或约定目录） | 相同 |

`pi` manifest 方式适用于任何包根（含本地路径）；约定目录只是无 manifest 时的回退方案。

## 10. Prompt Templates 简述

> 官方文档：https://pi.dev/docs/latest/prompt-templates
> 文档源码：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md

- **是什么**：Markdown 片段，输入 `/名字` 展开为完整提示词；文件名（去 `.md`）即命令名。`pi` 可为你生成模板。
- **放哪里**（Pi 均会加载）：
  - 全局：`~/.pi/agent/prompts/*.md`
  - 项目：`.pi/prompts/*.md`（仅项目被信任后）
  - 包内：`prompts/` 目录或 package.json 的 `pi.prompts` 条目
  - settings：`prompts` 数组（文件或目录）
  - CLI：`--prompt-template <path>`（可重复）；`--no-prompt-templates` 关闭发现
- **格式**：

```markdown
---
description: Review staged git changes
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
```

  - `description` 可选，缺省时用首个非空行；`argument-hint` 可选，显示在自动补全下拉中（如 `<PR-URL>`）。
- **用法**：`/review`、`/component Button`、`/component Button "click handler"`（多参数）。
- **参数**：`$1`、`$2` 位置参数；`$@` / `$ARGUMENTS` 全部参数拼接；`${1:-default}` 有值时用值、否则用默认；`${@:-default}` / `${ARGUMENTS:-default}` 同上（全部参数）；`${@:N}` 取第 N 位起；`${@:N:L}` 取 N 起共 L 个。例：`Summarize the current state in ${1:-7} bullet points.`
- **注意**：`prompts/` 内模板发现**非递归**，子目录模板须显式加入 settings 或包 manifest。
