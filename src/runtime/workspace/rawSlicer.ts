/**
 * src/runtime/workspace/rawSlicer.ts
 *
 * P1 · 收集层 —— 原始素材规则切片器
 *
 * 职责:对一段文本(对话 / 草稿 / 转写)做规则匹配,把命中片段落盘为
 * .raw/HHMM-hash.md 文件 + 同步追加一行到 projectRoot/.index.jsonl。
 *
 * 硬原则:
 *  - 保真不保优 —— 不做总结、改写、LLM 调用、原义理解
 *  - 写后不可变 —— 本模块只写新文件,绝不修改 / 删除既有 .raw 文件
 *  - 顺序无关 —— 同一段文本多次调用,只要落盘文件名唯一,效果一致
 *
 * 三种匹配规则(本轮范围,不做第四种):
 *   1) code     —— ```...``` 围栏块(含语言标注),保留原样
 *   2) decision —— 含决策关键词的行 / 句,整行入库(详见 DECISION_KEYWORDS)
 *   3) manual   —— `/raw` 字面量标记的一段,到下一个空行或下一个 `/raw`
 *
 * 路径:
 *  - 落盘目录:`projectRoot/.raw/`(由 P0 ensureMemoryWikiDirs 负责存在性)
 *  - 索引文件:`projectRoot/.index.jsonl`(append-only)
 *
 * 边界:
 *  - 不写到 os.homedir() 下任何路径(HOME 一律 throw)
 *  - 不调任何 LLM / 网络 / 不动 daemon / agentLoop
 *  - 不修改 / 删除既有 .raw / .index.jsonl 文件
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import {
  ensureMemoryWikiDirs,
} from './memoryWikiPaths.js';

export class RawSliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawSliceError';
  }
}

/** 三种切片类型 */
export type RawSliceKind = 'code' | 'decision' | 'manual';

/** 内部匹配结果(text 中的命中片段) */
interface RawMatch {
  kind: RawSliceKind;
  content: string;
  lang?: string;
  startPos: number;
  endPos: number;
}

/** 落盘结果 */
export interface RawSliceFile {
  kind: RawSliceKind;
  /** 相对 projectRoot/.raw/ 的文件名,如 '1030-a1b3c5d7.md' */
  file: string;
  /** 落盘绝对路径 */
  absPath: string;
  /** ISO8601 时间戳 */
  at: string;
}

export interface SlicePersistOptions {
  sessionId: string;
  tags?: string[];
  /** 测试用:覆盖"现在"的时间 */
  now?: Date;
}

export interface SlicePersistResult {
  files: RawSliceFile[];
  /** .index.jsonl 本次追加的行数(应 == files.length) */
  indexEntries: number;
}

// ── 路径与校验 ─────────────────────────────────────────────────────────

const RAW_DIRNAME = '.raw';
const INDEX_FILENAME = '.index.jsonl';
const HASH_HEX_LEN = 8;

/** 仿照 P0 assertInsideRoot:校验 target 在 root 之下 */
function assertInsideRoot(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.length === 0) {
    throw new RawSliceError(`refuse: target equals projectRoot`);
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RawSliceError(
      `refuse: path escapes projectRoot: root=${root} target=${target}`,
    );
  }
}

function resolveRoot(projectRoot: string): string {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new RawSliceError('refuse: projectRoot is empty');
  }
  if (projectRoot.includes('\0')) {
    throw new RawSliceError('refuse: projectRoot contains NUL byte');
  }
  return path.resolve(projectRoot);
}

function rawDirPath(root: string): string {
  const target = path.join(root, RAW_DIRNAME);
  assertInsideRoot(root, target);
  return target;
}

function indexPath(root: string): string {
  const target = path.join(root, INDEX_FILENAME);
  assertInsideRoot(root, target);
  return target;
}

// ── 决策关键词表(纯字符串 / 正则匹配,不做语义判断) ────────────────────

/**
 * 决策意图关键词表。
 *
 * 增删影响"什么算决策句"的边界 —— 是本模块的策略点。
 * 加新关键词:在此处加一行 + 在测试里加用例。
 * 删关键词:慎重,会让某些既有匹配消失。
 */
const DECISION_KEYWORDS: readonly string[] = [
  '决定',
  '改成',
  '改为',
  '不做',
  '别做',
  '明确不',
  '统一走',
  '统一用',
  '拍板',
  '定下',
  '定为',
  '推翻',
  '撤销',
];

/**
 * 决策句扫描:以"行"为单位,命中任一关键词即整行作为一条切片。
 *
 * 选择"按行"的理由:
 *  - 行是大多数协作工具(IDE / 聊天 / 笔记)的人类可读边界
 *  - 跨行"决策意图"判定本身超出规则匹配范畴,会让 rawSlicer 越界做语义判断
 *  - 任务书明确"别做语义判断,纯字符串 / 正则匹配"
 */
function matchDecisionLines(text: string): RawMatch[] {
  const re = new RegExp(DECISION_KEYWORDS.join('|'));
  const matches: RawMatch[] = [];
  // 用 split 保留每个换行位置
  const lines = text.split('\n');
  let pos = 0;
  for (const line of lines) {
    if (line.length > 0 && re.test(line)) {
      matches.push({
        kind: 'decision',
        content: line,
        startPos: pos,
        endPos: pos + line.length,
      });
    }
    // 行长度 + 1(\n)推进到下一行起点
    pos += line.length + 1;
    // 重置 lastIndex,避免 RegExp 对象在多次 test 间出错
    re.lastIndex = 0;
  }
  return matches;
}

// ── 代码块围栏(保留语言标注) ──────────────────────────────────────────

/**
 * 匹配 ```lang\n...\n``` 围栏块。
 * - 必须成对出现
 * - 中间含换行(强制多行,避免误判行内 inline code)
 * - 语言标注可空(```\n...``` 仍算)
 * - 捕获:lang + body
 *
 * 选择非贪婪 + 显式 \n``` 收尾:不让 ```...``` ... ``` 串到一起。
 */
const CODE_BLOCK_RE = /```([\w+\-#.]*)\n([\s\S]*?)\n```/g;

function matchCodeBlocks(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  CODE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_BLOCK_RE.exec(text)) !== null) {
    const lang = m[1] || '';
    const body = m[2];
    matches.push({
      kind: 'code',
      content: body,             // 写盘用去围栏的 body;围栏在 lang 字段有语言标注
      lang,
      startPos: m.index,
      endPos: m.index + m[0].length,
    });
  }
  return matches;
}

// ── /raw 手动段 ────────────────────────────────────────────────────────

/**
 * 手动打点:从 `/raw` 字面量开始,到下一个空行(中间允许空白)或下一个 `/raw` 或文本末尾。
 *
 * 取段边界(本模块的策略):
 *  - 起点:`/raw` 标记之后的第一个字符(剥触发器本身)
 *  - 终点(取最早出现的):
 *      a) 连续两个换行(中间可有空白)代表的空行 —— 含末尾换行
 *      b) 下一个 `/raw` 标记的起点(不含该 `/raw` 本身)
 *      c) 文本末尾
 *
 * 触发器必须是"行起始"的 `/raw`(行首或行首空白后)。
 * 这避免段内容内部的 `/raw` 字面量被误识别为触发器,例如:
 *   "/raw 第一段:从 /raw 到空行"
 *          ^^^^^             ← 触发器
 *                ^^^^^       ← 内容的一部分(非触发器)
 *
 * `/raw` 字面长度 = 4。
 */
const RAW_MARK_LEN = 4;
/** 单行内的 `/raw` 行首匹配:行首可选空白 + /raw + 词边界 */
const LINE_START_RAW = /^[ \t]*\/raw\b/;

function matchManualSegments(text: string): RawMatch[] {
  // 步骤 1:拆行,找所有 line-起始 /raw 的 markStart(text 中的字符偏移)
  const lineMarks: number[] = [];
  const lines = text.split('\n');
  let pos = 0;
  for (const line of lines) {
    const m = LINE_START_RAW.exec(line);
    if (m) {
      const indentLen = m[0].length - RAW_MARK_LEN;
      lineMarks.push(pos + indentLen);
    }
    pos += line.length + 1; // +1 for \n
  }

  // 步骤 2:按顺序切段
  const matches: RawMatch[] = [];
  for (let i = 0; i < lineMarks.length; i++) {
    const markStart = lineMarks[i];
    const afterMark = markStart + RAW_MARK_LEN;

    // 默认段终点:下一个 /raw 所在行的"行首位置之前"(\n 之后的位置,即下一个 \n)。
    // 如果 i 是最后一个,段终点 = text.length。
    let segmentEnd: number;
    if (i + 1 < lineMarks.length) {
      segmentEnd = lineMarks[i + 1] - 1; // 减去 1:下一个 markStart 前的 \n
    } else {
      segmentEnd = text.length;
    }

    // 在 [afterMark, segmentEnd] 之间找段边界
    const slice = text.slice(afterMark, segmentEnd);
    let endRel = slice.length;

    // a) 空行(连续两个换行,中间可有空白)
    const blankMatch = /\n[ \t]*\n/.exec(slice);
    if (blankMatch) {
      endRel = Math.min(endRel, blankMatch.index + blankMatch[0].length);
    }

    const content = slice.slice(0, endRel).replace(/\s+$/, '');

    matches.push({
      kind: 'manual',
      content,
      startPos: afterMark,
      endPos: afterMark + endRel,
    });
  }
  return matches;
}

// ── 匹配汇总 ──────────────────────────────────────────────────────────

/**
 * 对 text 做三种规则的全量扫描,返回所有命中片段(不去重,按出现顺序)。
 *
 * 同一文本片段可能被多种规则命中 —— 例如一段含 ``` 围栏的代码中又恰好有"决定"。
 * 本模块不去重、不裁决优先级:每条命中独立落盘,宁多勿漏。
 * 后续消费方按需去重。
 */
export function matchAll(text: string): RawMatch[] {
  return [
    ...matchCodeBlocks(text),
    ...matchDecisionLines(text),
    ...matchManualSegments(text),
  ];
}

// ── 文件名 / 时间 / 哈希 ──────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localHHMM(d: Date): string {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function shortHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content, 'utf-8')
    .digest('hex')
    .slice(0, HASH_HEX_LEN);
}

function baseFilename(at: Date, content: string): string {
  return `${localHHMM(at)}-${shortHash(content)}.md`;
}

// ── 最小 YAML front-matter 序列化(无依赖) ─────────────────────────────

/**
 * 把字符串用单引号包裹,内部单引号用 '' 转义 —— YAML 单引号字符串规则。
 * 不支持换行 / 控制字符:若 sessionId 异常,会让 YAML 解析失败,这是 caller 的责任。
 */
function yamlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * 把 tags 数组序列化成 YAML 行内数组:`['a', 'b']`。
 */
function yamlTags(tags: readonly string[]): string {
  if (tags.length === 0) return '[]';
  return `[${tags.map(yamlStr).join(', ')}]`;
}

/**
 * 组装 front-matter + body 字符串。
 *
 * sourceSpan 字段保留为空值(`sourceSpan:`),YAML 解析后是 null,但字段占位明确。
 * 这是为 P2 以后 wiki 回指 raw 行区间预留的口子,本轮不填值。
 */
function buildFileBody(meta: {
  kind: RawSliceKind;
  sessionId: string;
  at: string;
  tags: readonly string[];
  content: string;
}): string {
  const lines = [
    '---',
    `kind: ${meta.kind}`,
    `sessionId: ${yamlStr(meta.sessionId)}`,
    `at: ${meta.at}`,
    `tags: ${yamlTags(meta.tags)}`,
    'sourceSpan:',
    '---',
    '',
    meta.content,
  ];
  // 确保 body 以换行结尾(便于 diff / 拼接)
  return lines.join('\n') + '\n';
}

// ── 不可变写(撞名改序号) ──────────────────────────────────────────────

/**
 * 在 rawDir 下分配一个不存在的 filename,以 baseName 为起点;
 * 若 .md 已存在,改用 `-2.md`、`-3.md` ...(序号从 2 起跳)。
 *
 * 序号从 2 起跳的理由:`-1.md` 读起来"像个原始名",从 -2 起更不容易让人误以为
 * "这是某种特殊命名约定"。命名约定:无后缀 = 首发;有 `-N.md` = 第 N 次撞名。
 *
 * 用 `wx` 独占创建 + EEXIST 循环 —— 是"创建或换一个名"的可靠原语,
 * 比"先 stat 再 write"更原子(没有 TOCTOU 窗口)。
 *
 * 返回 { filename, absPath } —— 绝不修改任何已有文件。
 */
async function allocateAndWrite(
  rawDir: string,
  baseName: string,
  body: string,
): Promise<{ filename: string; absPath: string }> {
  const stem = baseName.replace(/\.md$/, '');
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? `${stem}.md` : `${stem}-${n + 1}.md`;
    const abs = path.join(rawDir, candidate);
    try {
      const fh = await fs.open(abs, 'wx', 0o600);
      try {
        await fh.writeFile(body, 'utf-8');
      } finally {
        await fh.close();
      }
      return { filename: candidate, absPath: abs };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'EEXIST') continue; // 撞名,换序号
      throw e;
    }
  }
}

// ── .index.jsonl append ────────────────────────────────────────────────

function buildIndexLine(file: RawSliceFile): string {
  const entry = {
    file: file.file,
    kind: file.kind,
    at: file.at,
  };
  return JSON.stringify(entry);
}

// ── 主流程 ─────────────────────────────────────────────────────────────

/**
 * 对 text 做规则匹配,落盘到 projectRoot/.raw/,同步追加 .index.jsonl。
 *
 * 流程:
 *  1) 解析 projectRoot(HOME / 空 / NUL 一律 throw)
 *  2) ensureMemoryWikiDirs(root) —— 确保 .raw 存在
 *  3) matchAll(text) —— 三种规则扫描,保序
 *  4) 对每条 match:
 *     a) 拼 front-matter + content
 *     b) 算 HHMM + content-hash
 *     c) allocateAndWrite(.raw/) —— 撞名改序号
 *     d) 追写一行到 .index.jsonl
 *  5) 返回 { files, indexEntries }
 *
 * 错误处理:
 *  - 任一步骤抛错:已落盘的文件保留(不删),后续匹配不再处理;抛错冒泡。
 *    调用方按需 catch + 决定是否重试。
 *  - .index.jsonl 写入失败:文件已落盘但未索引 —— 调用方应自检并重跑或重建索引。
 */
export async function sliceAndPersist(
  projectRoot: string,
  text: string,
  opts: SlicePersistOptions,
): Promise<SlicePersistResult> {
  const root = resolveRoot(projectRoot);
  if (root === os.homedir()) {
    throw new RawSliceError(`refuse: projectRoot equals HOME (${root})`);
  }

  if (!opts || typeof opts.sessionId !== 'string' || opts.sessionId.length === 0) {
    throw new RawSliceError('refuse: sessionId is required');
  }

  // P0:确保 .raw 存在(其它目录不管)
  await ensureMemoryWikiDirs(root);

  const rawDir = rawDirPath(root);
  const idxPath = indexPath(root);

  // 确保 .index.jsonl 存在(若不存在,创建空文件;后续追加不会失败)
  try {
    await fs.access(idxPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      // 'wx' 独占创建,避免覆盖(理论上不会,因为上面 ENOENT 已确认)
      const fh = await fs.open(idxPath, 'wx', 0o600);
      await fh.close();
    } else {
      throw e;
    }
  }

  const matches = matchAll(text);
  const files: RawSliceFile[] = [];
  const now = opts.now ?? new Date();
  const atISO = now.toISOString();
  const tags = opts.tags ?? [];

  for (const m of matches) {
    const baseName = baseFilename(now, m.content);
    const body = buildFileBody({
      kind: m.kind,
      sessionId: opts.sessionId,
      at: atISO,
      tags,
      content: m.content,
    });
    const { filename, absPath } = await allocateAndWrite(rawDir, baseName, body);
    const file: RawSliceFile = {
      kind: m.kind,
      file: filename,
      absPath,
      at: atISO,
    };
    files.push(file);

    // 同步追加一行 .index.jsonl(每个文件一行,append-only)
    await fs.writeFile(idxPath, buildIndexLine(file) + '\n', {
      flag: 'a',
      encoding: 'utf-8',
    });
  }

  return { files, indexEntries: files.length };
}