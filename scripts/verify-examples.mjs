#!/usr/bin/env node
// Examples 自动验证（零额外依赖，node scripts/verify-examples.mjs）。
// 目标：证明仓库没有结构性/语法性损坏——不依赖任何 LLM API key。
//   1. 对含依赖的 examples 执行 npm install（证明 package.json 可安装）
//   2. 对所有 JS/TS 入口做语法检查（node --check）
//   3. 对已安装依赖的 examples 做 import 验证（证明导出/导入图未损坏）
// 任一失败 → 非零码退出（供 CI 使用）。
"use strict";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(ROOT, "examples");

// name: 示例目录；install: 是否 npm install；files: 语法检查文件；imports: import 验证入口（cwd 为示例目录）
const EXAMPLES_CONFIG = [
  {
    name: "extension-minimal",
    install: true,
    files: ["src/index.ts"],
    imports: ["@earendil-works/pi-coding-agent", "typebox"],
  },
  {
    name: "rpc-node-minimal",
    install: false,
    files: ["index.js"],
  },
  {
    name: "sdk-minimal",
    install: true,
    files: ["index.mjs"],
    imports: ["@earendil-works/pi-coding-agent"],
  },
  {
    name: "web-bridge-minimal",
    install: false,
    files: ["server.js"],
  },
];

const errors = [];

function run(cmd, args, opts = {}) {
  // npm 在 Windows 是 .cmd shim，经 cmd.exe 显式执行（参数为代码内常量，无注入风险）；
  // node 直接 spawn（process.execPath 可能含空格，不能进 shell）
  if (process.platform === "win32" && cmd === "npm") {
    cmd = process.env.ComSpec || "cmd.exe";
    args = ["/c", "npm", ...args];
  }
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return res.status === 0;
}

// ---- 1 & 3. npm install + import 验证（需要依赖的示例）----
for (const ex of EXAMPLES_CONFIG) {
  const dir = join(EXAMPLES, ex.name);
  if (!existsSync(join(dir, "package.json"))) {
    errors.push(`${ex.name}: 缺少 package.json`);
    continue;
  }

  if (ex.install) {
    process.stdout.write(`\n[npm install] ${ex.name} ...\n`);
    if (!run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir })) {
      errors.push(`${ex.name}: npm install 失败`);
      continue;
    }
  }

  if (ex.imports) {
    const importScript =
      `Promise.all([${ex.imports.map((m) => `import("${m}")`).join(", ")}])` +
      `.then(() => { console.log("[import OK] ${ex.imports.join(", ")}"); })` +
      `.catch((err) => { console.error("[import FAIL]", err.message); process.exit(1); });`;
    process.stdout.write(`\n[import check] ${ex.name} ...\n`);
    if (!run(process.execPath, ["--input-type=module", "-e", importScript], { cwd: dir })) {
      errors.push(`${ex.name}: import 验证失败`);
    }
  }
}

// ---- 2. 语法检查（node --check；TS 文件兼容 Node 22 的 --experimental-strip-types）----
for (const ex of EXAMPLES_CONFIG) {
  for (const file of ex.files) {
    const full = join(EXAMPLES, ex.name, file);
    process.stdout.write(`\n[syntax] ${ex.name}/${file} ...\n`);
    if (full.endsWith(".ts")) {
      const plain = run(process.execPath, ["--check", full]); // Node ≥23.6 默认 strip types
      if (!plain && !run(process.execPath, ["--experimental-strip-types", "--check", full])) {
        errors.push(`${ex.name}/${file}: 语法检查失败`);
      }
    } else if (!run(process.execPath, ["--check", full])) {
      errors.push(`${ex.name}/${file}: 语法检查失败`);
    }
  }
}

// ---- 输出 ----
if (errors.length) {
  console.error(`\n❌ verify-examples: FAIL (${errors.length})`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\n✅ verify-examples: PASS（安装 / 语法 / import 全部通过）");
