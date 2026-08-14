# extension-minimal —— 最小 Pi Extension

证明"向 Pi 添加一个能力"最少需要多少代码：一个 `package.json` + 一个 `src/index.ts`，仅注册一个自定义工具 `greet`。

## 文件结构

```
extension-minimal/
├── package.json   # 声明扩展入口与两个示例依赖
└── src/index.ts   # 扩展工厂函数：pi.registerTool({...})
```

## 安装依赖

```bash
npm install
```

> `@earendil-works/pi-coding-agent`（ExtensionAPI 类型）与 `typebox`（参数 schema）仅为此示例演示而声明。一个纯工具扩展通常只需要 typebox；类型注解用 `import type` 擦除，不会增加运行时负担。

## 文件放哪

| 位置 | 作用域 |
| --- | --- |
| `~/.pi/agent/extensions/pi-extension-minimal/` | 全局，任意项目可用 |
| `<项目>/.pi/extensions/pi-extension-minimal/` | 仅该项目（需先信任项目） |

放入后 Pi 自动发现（`package.json` 的 `"pi": {"extensions": ["./src/index.ts"]}` 声明入口），重启 Pi 或 `/reload` 热加载。

## 如何测试

```bash
# 方式一：快速验证（不装到目录里）
pi -e ./src/index.ts

# 方式二：装到 ~/.pi/agent/extensions/ 后，在任意会话里让模型调用 greet 工具
# 重启 Pi 或 /reload 生效；验证 `pi.getActiveTools()` / `pi.getAllTools()` 里出现 greet
```

## 责任边界

| 谁 | 负责什么 |
| --- | --- |
| **本扩展** | 只**添加**一个能力（工具 greet）：声明 schema、校验参数、执行并返回结果。不修改任何内置行为。 |
| **Pi 内核** | 工具注册表（Tool Registry）与工具的注册/启停/调用生命周期、Agent Runtime（模型调用、回合调度）、Session Manager（会话文件、分支、压缩）。 |
| **边界规则** | 扩展是"插件"不是"补丁"：不要试图从扩展里替换内核实现或自己实现第二套会话/运行时；扩展只通过 `pi.registerTool` / `pi.registerCommand` / 事件订阅与内核协作。 |

> ⚠️ 扩展拥有完整系统权限，只安装可信来源。不要在工厂函数里启动长驻资源（进程/定时器/文件监听）——工厂可能在无会话的调用中运行；需要时延迟到 `session_start` 或工具执行体里。
