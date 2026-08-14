#!/usr/bin/env node
// Release 包验证（零依赖，node scripts/verify-package.mjs [dir]）。
// 验证一个目录可以作为 Pi Skill 的 Release 包根：
//   [ ] 根目录直接含 SKILL.md（禁止 pi-agent-development-vX.Y.Z/pi-agent-development/ 双层嵌套）
//   [ ] references/ 存在
//   [ ] SKILL.md frontmatter 合法（name / description 符合 Agent Skills 规范）
//   [ ] SKILL.md 路由指向的 references/*.md 全部存在
//   [ ] 无 node_modules / .git（默认扫描仓库根时 .git 属仓库元数据，放行）/ 日志 / 临时文件
// 任一失败 → 非零码退出（供 CI 与发布前使用）。
"use strict";

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? resolve(process.argv[2]) : ROOT;
const isRepoRoot = target === ROOT;

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
const SKILL_DESC_MAX = 1024;
const linkRe = /references\/[a-z0-9-]+\.md/g;

const errors = [];

// ---- 1. 根结构 ----
if (!existsSync(join(target, "SKILL.md"))) {
  errors.push(`${target}: 根目录缺少 SKILL.md（Release 包根必须是 pi-agent-development/，不能多套一层）`);
}
if (!existsSync(join(target, "references"))) {
  errors.push(`${target}: 缺少 references/ 目录`);
}

// ---- 2. SKILL.md frontmatter 合法 ----
if (existsSync(join(target, "SKILL.md"))) {
  const fm = parseFrontmatter(readFileSync(join(target, "SKILL.md"), "utf8"));
  const name = String(fm.name ?? "").trim();
  const desc = String(fm.description ?? "").trim();
  if (!fm || Object.keys(fm).length === 0) errors.push("SKILL.md: 缺少 YAML frontmatter");
  if (!name) errors.push("SKILL.md: name 缺失或为空");
  if (!desc) errors.push("SKILL.md: description 缺失或为空");
  if (name.length > SKILL_NAME_MAX) errors.push(`SKILL.md: name 超过 ${SKILL_NAME_MAX} 字符`);
  if (desc.length > SKILL_DESC_MAX) errors.push(`SKILL.md: description 超过 ${SKILL_DESC_MAX} 字符`);
  if (name && !SKILL_NAME_RE.test(name)) errors.push(`SKILL.md: name "${name}" 非法（仅小写字母/数字/连字符，无首尾/连续连字符）`);
}

// ---- 3. 路由指向的 references 全部存在 ----
if (existsSync(join(target, "SKILL.md"))) {
  const text = readFileSync(join(target, "SKILL.md"), "utf8");
  for (const match of text.matchAll(linkRe)) {
    if (!existsSync(join(target, match[0]))) {
      errors.push(`SKILL.md: 路由指向不存在的 ${match[0]}`);
    }
  }
}

// ---- 4. 禁止内容：node_modules / .git / 日志 / 临时文件 ----
const FORBIDDEN_DIRS = isRepoRoot ? ["node_modules"] : ["node_modules", ".git"];
const FORBIDDEN_FILE_EXT = new Set([".log", ".tmp", ".bak"]);
const FORBIDDEN_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

function scan(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (FORBIDDEN_DIRS.includes(name)) {
        errors.push(`包内存在禁止目录: ${full.slice(target.length + 1)}/`);
      } else {
        scan(full);
      }
    } else {
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      if (FORBIDDEN_FILE_EXT.has(ext) || FORBIDDEN_FILE_NAMES.has(name)) {
        errors.push(`包内存在禁止文件: ${full.slice(target.length + 1)}`);
      }
    }
  }
}
scan(target);

// ---- 输出 ----
if (errors.length) {
  console.error(`❌ verify-package: FAIL (${errors.length})`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✅ verify-package: PASS（${target} 可作为 Skill Release 包根）`);

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
