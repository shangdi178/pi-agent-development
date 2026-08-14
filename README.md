# Pi Agent 二次开发指南（Extension-First）

Pi Agent（pi.dev）"小核心 + 扩展"架构下的二次开发指南：扩展（Extensions）、Agent Skills、RPC Mode、SDK 内嵌、Pi Packages 打包与官方资源索引。

> 完整内容见 [SKILL.md](SKILL.md)（Agent Skills 标准格式，可直接放入 `~/.pi/agent/skills/` 或 `~/.agents/skills/` 使用）。

## 内容概览

| 章节 | 主题 |
| --- | --- |
| §1 | 官方资源（文档 / 源码 / npm 包 / 安装） |
| §2 | 开发前检查清单（先查原生能力，再决定扩展/对接，禁止重写内核） |
| §3 | Extensions（TypeScript）：`registerTool` / `registerCommand` / 事件订阅 |
| §4 | Skills：Agent Skills 标准与发现路径 |
| §5 | RPC Mode：stdin/stdout JSONL 程序化集成 |
| §6 | SDK：Node 内嵌（`createAgentSession` / `SessionManager`） |
| §7 | Pi Packages：打包分发扩展 + skills + prompts + themes |
| §8 | 参考项目索引（Web UI / 原理剖析 / 技能库等） |
| §9 | 常见坑（会话权威 / 平行状态 / lazy 落盘等） |

## 使用方法

- 作为技能：将本目录放入 `~/.pi/agent/skills/` 或项目 `.pi/skills/`（需信任项目），模型会在相关任务时自动加载。
- 作为文档：直接阅读 `SKILL.md`。

## 相关资源

- Pi Agent 文档：https://pi.dev/docs/latest
- Pi Agent 源码：https://github.com/earendil-works/pi （MIT）
- npm 包：`@earendil-works/pi-coding-agent`

## 许可

[MIT](LICENSE)
