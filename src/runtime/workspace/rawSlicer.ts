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
 *      └─ 降级:若触发器前 5 行内出现描述性词(见 MANUAL_SUSPECT_HINTS),
 *         说明该 `/raw` 大概率是"描述 rawSlicer 自身规则"时残留的字面量
 *         (issues/issue_01.md),段 kind 记为 manual-suspect 而非 manual。
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
import path from 'path';
import crypto from 'crypto';

import {
  ensureMemoryWikiDirs,
  MEMORY_WIKI_DIRS,
} from './memoryWikiPaths.js';
import {
  resolveRoot,
  assertInsideRoot,
  isHome,
  type ErrorCtor,
} from './pathSafety.js';

export class RawSliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawSliceError';
  }
}

/** 三种切片类型 + manual 的降级形态(issue_01) */
export type RawSliceKind = 'code' | 'decision' | 'manual' | 'manual-suspect';

/** 内部匹配结果(text 中的命中片段) */
interface RawMatch {
  kind: RawSliceKind;
  content: string;
  lang?: string;
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

// ── 路径与校验(用共享 pathSafety)───────────────────────────────────

const RAW_DIRNAME = MEMORY_WIKI_DIRS[0]; // '.raw' —— 单点真相来自 P0
const INDEX_FILENAME = '.index.jsonl';
const HASH_HEX_LEN = 8;

const Err: ErrorCtor = RawSliceError;

function rawDirPath(root: string): string {
  const target = path.join(root, RAW_DIRNAME);
  assertInsideRoot(Err, root, target);
  return target;
}

function indexPath(root: string): string {
  const target = path.join(root, INDEX_FILENAME);
  assertInsideRoot(Err, root, target);
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
  for (const line of text.split('\n')) {
    if (line.length > 0 && re.test(line)) {
      matches.push({ kind: 'decision', content: line });
    }
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
    matches.push({
      kind: 'code',
      content: m[2],             // 写盘用去围栏的 body;语言标注保留在 lang
      lang: m[1] || '',
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

/**
 * manual-suspect 上下文过滤(issues/issue_01.md)。
 *
 * 触发器"往前数 5 行"(在原文本里,不含触发行本身)若出现任一描述性词,
 * 说明这个 line-start `/raw` 大概率是"描述 rawSlicer 自身规则"时嵌入的
 * 字面量残留(如路线图 / 设计文档),而不是用户主动打点 —— 段 kind 降级为
 * manual-suspect,是否采信交给下游消费方(P2 ingest 模板强制 [疑])。
 *
 * 词表只收 issue_01 实锤的三个词,保持高精度:
 * 过滤器的职责是"标记嫌疑"而非"分类语义",词表越宽,真实打点被误降级的
 * 风险越大(误伤 manual 信任度)。真正的语义审计归 verify() 管,不在此层。
 *
 * 窗口 5 行的理由:描述性文字与残留 `/raw` 在原文中相邻(issue_01 里
 * `rawSlicer.ts` 距触发器仅 2 行);5 行足以覆盖"标题 + 一行说明"的
 * 排版距离,又不会把整节文字都算作上下文。
 */
const MANUAL_SUSPECT_LOOKBACK_LINES = 5;
const MANUAL_SUSPECT_HINTS: readonly string[] = [
  'rawSlicer.ts',
  '手动打点',
  '规则切片器',
];

/** 触发器所在行往前 5 行内是否出现描述性词 */
function isSuspectContext(lines: readonly string[], triggerLineIdx: number): boolean {
  const from = Math.max(0, triggerLineIdx - MANUAL_SUSPECT_LOOKBACK_LINES);
  for (let j = from; j < triggerLineIdx; j++) {
    for (const hint of MANUAL_SUSPECT_HINTS) {
      if (lines[j].includes(hint)) return true;
    }
  }
  return false;
}

function matchManualSegments(text: string): RawMatch[] {
  // 步骤 1:拆行,找所有 line-起始 /raw,记 {start: text 中字符偏移, lineIdx: 所在行号}
  const marks: Array<{ start: number; lineIdx: number }> = [];
  const lines = text.split('\n');
  let pos = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const m = LINE_START_RAW.exec(line);
    if (m) {
      const indentLen = m[0].length - RAW_MARK_LEN;
      marks.push({ start: pos + indentLen, lineIdx: li });
    }
    pos += line.length + 1; // +1 for \n
  }

  // 步骤 2:按顺序切段
  const matches: RawMatch[] = [];
  for (let i = 0; i < marks.length; i++) {
    const markStart = marks[i].start;
    const afterMark = markStart + RAW_MARK_LEN;

    // 默认段终点:下一个 /raw 所在行的"行首位置之前"(\n 之后的位置,即下一个 \n)。
    // 如果 i 是最后一个,段终点 = text.length。
    let segmentEnd: number;
    if (i + 1 < marks.length) {
      segmentEnd = marks[i + 1].start - 1; // 减去 1:下一个 markStart 前的 \n
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

    const kind: RawSliceKind = isSuspectContext(lines, marks[i].lineIdx)
      ? 'manual-suspect'
      : 'manual';
    matches.push({ kind, content });
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
  const root = resolveRoot(Err, projectRoot);
  if (isHome(root)) {
    throw new RawSliceError(`refuse: projectRoot equals HOME (${root})`);
  }

  if (!opts || typeof opts.sessionId !== 'string' || opts.sessionId.length === 0) {
    throw new RawSliceError('refuse: sessionId is required');
  }

  // P0:确保 .raw 存在(其它目录不管)
  await ensureMemoryWikiDirs(root);

  const rawDir = rawDirPath(root);
  const idxPath = indexPath(root);

  // 确保 .index.jsonl 存在 —— `wx` 已经编码"exists vs create"语义,不需预 fs.access
  // (fs.access + fs.open 是 TOCTOU + 重复 syscall)
  try {
    const fh = await fs.open(idxPath, 'wx', 0o600);
    await fh.close();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== 'EEXIST') throw e;
    // EEXIST = 已存在,正常,继续
  }

  const matches = matchAll(text);
  const now = opts.now ?? new Date();
  const atISO = now.toISOString();
  const tags = opts.tags ?? [];

  // 步骤 1:准备所有 match 的写入计划(无 I/O)
  const plans = matches.map((m) => ({
    match: m,
    baseName: baseFilename(now, m.content),
    body: buildFileBody({
      kind: m.kind,
      sessionId: opts.sessionId,
      at: atISO,
      tags,
      content: m.content,
    }),
  }));

  // 步骤 2:并行写所有 .raw 文件,收集成功的 entries(失败抛错冒泡)
  const files: RawSliceFile[] = await Promise.all(
    plans.map(async (p): Promise<RawSliceFile> => {
      const { filename, absPath } = await allocateAndWrite(rawDir, p.baseName, p.body);
      return { kind: p.match.kind, file: filename, absPath, at: atISO };
    }),
  );

  // 步骤 3:一次性 batch 写 index(append-only,只包含成功写入的)
  if (files.length > 0) {
    const lines = files.map(buildIndexLine).join('\n') + '\n';
    await fs.writeFile(idxPath, lines, { flag: 'a', encoding: 'utf-8' });
  }

  return { files, indexEntries: files.length };
}