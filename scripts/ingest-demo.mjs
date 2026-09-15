#!/usr/bin/env bun
/**
 * scripts/ingest-demo.mjs
 *
 * 一次性 ingest 演示:P1 rawSlicer 跑通。
 * 把一段已存的纯文本喂给 sliceAndPersist,落 cwd/.raw/ + .index.jsonl。
 *
 * 用法:
 *   bun scripts/ingest-demo.mjs
 *   bun scripts/ingest-demo.mjs <input.txt>   # 默认 /tmp/0915-plain.txt
 *
 * 输出:
 *   cwd/.raw/HHMM-hash.md × N(每条切片一个文件,含 YAML front-matter)
 *   cwd/.index.jsonl(每行 {file, kind, at},append-only)
 *   stdout 一份 JSON 汇总(files / indexEntries)
 *
 * 不动 wiki/ 或 raw/(老的,无点前缀,跟本脚本无关)。
 */

import {
  sliceAndPersist,
} from '../src/runtime/workspace/rawSlicer.js';

const inputPath = process.argv[2] ?? '/tmp/0915-plain.txt';
const sessionId = process.argv[3] ?? 'manual-ingest-0915';

console.log(`[ingest-demo] input=${inputPath}`);
console.log(`[ingest-demo] sessionId=${sessionId}`);

const text = await Bun.file(inputPath).text();
console.log(`[ingest-demo] text 长度: ${text.length} 字符, ${text.split('\n').length} 行`);

const result = await sliceAndPersist(process.cwd(), text, {
  sessionId,
  tags: ['manual-ingest', '0915'],
});

// 汇总:按 kind 分组,每组列文件名(kind 集合随 rawSlicer 演进,动态建组)
const byKind = {};
for (const f of result.files) {
  (byKind[f.kind] ??= []).push(f.file);
}

console.log(`\n[ingest-demo] 共 ${result.files.length} 条切片(indexEntries=${result.indexEntries}):`);
for (const [k, list] of Object.entries(byKind)) {
  console.log(`  ${k}: ${list.length} 条`);
  for (const name of list) console.log(`    - ${name}`);
}

console.log(`\n[ingest-demo] .index.jsonl 写入完成(${result.indexEntries} 行)`);