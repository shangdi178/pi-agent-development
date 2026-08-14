#!/usr/bin/env node
// 仓库文档一致性检查（零依赖，node scripts/verify-docs.mjs）。
// 职责（保持轻量，不做复杂静态分析）：
//   1. reference frontmatter：核心 reference 必须含 source / verified_at / upstream / upstream_commit
//   2. 禁止内容：不得出现明显特定业务/私有项目关键词（小 blacklist）
//   3. 旧文件引用：不得引用已被拆除的 reference 路径（如 references/integration.md）
//   4. reference links：所有文档中引用的 references/*.md 必须真实存在
//   5. 结构检查：核心文件与四个 examples 必须存在
// 任一检查失败 → 打印原因并以非零码退出（供 CI 使用）。
"use strict";

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);

// 必须存在的核心文件（结构检查）
const CORE_FILES = [
  "SKILL.md",
  "README.md",
  "references/architecture.md",
  "references/decision-tree.md",
  "references/anti-patterns.md",
  "references/rpc.md",
  "references/sdk.md",
  "references/sessions.md",
  "references/compaction.md",
  "references/extensions.md",
  "references/skills.md",
  "references/packages.md",
  "references/acceptance.md",
  "scripts/verify-docs.mjs",
  "scripts/verify-examples.mjs",
  ".github/workflows/verify.yml",
  "examples/extension-minimal/package.json",
  "examples/extension-minimal/src/index.ts",
  "examples/rpc-node-minimal/index.js",
  "examples/sdk-minimal/index.mjs",
  "examples/web-bridge-minimal/server.js",
  "examples/web-bridge-minimal/index.html",
];

// 核心 reference 的 frontmatter 必填键
const REQUIRED_FRONTMATTER = ["source", "verified_at", "upstream", "upstream_commit"];
const REFERENCE_FILES = [
  "architecture.md", "decision-tree.md", "anti-patterns.md", "rpc.md",
  "sdk.md", "sessions.md", "compaction.md", "extensions.md", "skills.md",
  "packages.md", "acceptance.md",
];

// 禁止内容 blacklist（特定业务/私有项目关键词，小写匹配）。
// 注意：本文件自身与 .git/ node_modules/ 不参与扫描。
const BLACKLIST = ["comsol"];

// 已拆除、禁止再被引用的 reference 路径
const REMOVED_REFERENCES = ["references/integration.md"];

const TEXT_EXT = new Set([".md", ".js", ".mjs", ".ts", ".json", ".html", ".txt", ".yml", ".yaml"]);

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (TEXT_EXT.has(extOf(name))) {
      out.push(full);
    }
  }
  return out;
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function read(path) {
  return readFileSync(path, "utf8");
}

// ---- 1. 结构检查 ----
for (const rel of CORE_FILES) {
  if (!existsSync(join(ROOT, rel))) errors.push(`缺少核心文件: ${rel}`);
}

// ---- 2. reference frontmatter ----
for (const name of REFERENCE_FILES) {
  const rel = `references/${name}`;
  const full = join(ROOT, rel);
  if (!existsSync(full)) continue; // 已在结构检查中报错
  const text = read(full);
  const fm = parseFrontmatter(text);
  for (const key of REQUIRED_FRONTMATTER) {
    if (!(key in fm) || !String(fm[key]).trim()) {
      errors.push(`${rel}: frontmatter 缺少必填键 ${key}`);
    }
  }
}

// ---- 3 & 4. reference links（含已拆除文件检查）----
const mdFiles = walk(ROOT).filter((f) => f.endsWith(".md"));
const linkRe = /references\/[a-z0-9-]+\.md/g;
for (const file of mdFiles) {
  const rel = file.slice(ROOT.length + 1);
  const text = read(file);
  for (const match of text.matchAll(linkRe)) {
    const link = match[0];
    if (REMOVED_REFERENCES.includes(link)) {
      errors.push(`${rel}: 引用了已拆除的 ${link}`);
    } else if (!existsSync(join(ROOT, link))) {
      errors.push(`${rel}: 引用了不存在的 ${link}`);
    }
  }
}

// ---- 5. 禁止内容 blacklist ----
for (const file of walk(ROOT)) {
  if (file === SELF) continue;
  const rel = file.slice(ROOT.length + 1);
  const lower = read(file).toLowerCase();
  for (const word of BLACKLIST) {
    if (lower.includes(word)) {
      errors.push(`${rel}: 出现禁止内容关键词 "${word}"`);
    }
  }
}

// ---- 输出 ----
if (warnings.length) {
  console.log(`⚠️  warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.error(`❌ FAIL (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("✅ verify-docs: PASS（结构 / frontmatter / 链接 / 禁止内容 全部通过）");

// ---- 简单 YAML frontmatter 解析（仅顶层 key: value）----
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const out = {};
  for (const line of text.slice(3, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
