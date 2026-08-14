// 最小 Pi Extension：只做一件事 —— 注册一个自定义工具。
// 通过 registerTool + typebox schema 演示"扩展添加能力"的最小完整结构。
// 不实现、不覆盖 Agent Runtime / Session Manager / Tool Registry，这些都属于 Pi 内核。
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 扩展 = 导出默认工厂函数的 TS 模块，pi 会 await 后再继续启动。
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    // 工具名是给 LLM 调用的标识；用中性示例名，不携带任何业务含义。
    name: "greet",
    label: "Greet",
    description: "向指定名称的人问好并返回问候语，用于演示自定义工具的最小注册结构。",
    // 工具在工具列表里的一行摘要，以及触发该工具的指导（供 LLM 参考）。
    promptSnippet: "Greet someone by name",
    promptGuidelines: [
      "当用户要求打招呼或问候某人时，使用 greet 工具。",
    ],
    // 参数 schema：typebox Type.Object 完整结构。
    // 枚举类参数建议用 StringEnum（保证 Google 模型兼容），本示例用可选参数演示。
    parameters: Type.Object({
      name: Type.String({ description: "要问候的名称" }),
      greeting: Type.Optional(
        Type.String({ description: "自定义问候语前缀，默认 'Hello'" }),
      ),
    }),
    // 执行体：返回 { content（发给 LLM）, details（供渲染与状态） }。
    async execute(toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "已取消" }], details: {} };
      }
      const prefix = params.greeting ?? "Hello";
      return {
        content: [{ type: "text", text: `${prefix}, ${params.name}!` }],
        details: { greeted: params.name },
      };
    },
    // 可选：renderCall / renderResult 自定义 TUI 渲染，最小示例从略。
  });
}
