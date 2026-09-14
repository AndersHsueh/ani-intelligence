/**
 * src/runtime/workspace/memoryWikiPaths.ts
 *
 * P0 · 约定层(工作记忆层落地路线 2026-09-15)
 *
 * 仅做三件事:
 *  1) ensureMemoryWikiDirs(projectRoot) —— 幂等创建 .raw / .wiki / .outputs
 *  2) appendMemoryWikiGitignore(projectRoot) —— 幂等追加 .gitignore 块
 *  3) MEMORY_WIKI_DIRS 常量,供其它层共享
 *
 * 硬边界:
 *  - 不写到 os.homedir() 下任何路径
 *  - 不写到 projectRoot(解析后)之外任何路径
 *  - 不新建 .gitignore(只在它已存在时追加)
 *  - 不触碰既有文件(目录已存在时不动;块已存在时不写)
 *  - 不调任何 LLM、不动 daemon / agentLoop
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/** 工作记忆层三点目录名(相对 projectRoot) */
export const MEMORY_WIKI_DIRS = ['.raw', '.wiki', '.outputs'] as const;
export type MemoryWikiDir = (typeof MEMORY_WIKI_DIRS)[number];

/** .gitignore 追加块 —— 包含一个唯一 marker 行,用于幂等判定 */
const GITIGNORE_MARKER = '# alice-code memory wiki (auto-added, idempotent)';
const GITIGNORE_BLOCK =
  `${GITIGNORE_MARKER}\n` +
  `.raw/\n` +
  `.wiki/\n` +
  `.outputs/\n`;

export class MemoryWikiPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryWikiPathError';
  }
}

/**
 * 解析 projectRoot 并做输入校验(只挡空 / NUL,HOME 由各函数自己决定策略)。
 *  - 必须解析为绝对路径
 *  - 拒绝空字符串 / 非字符串
 *  - 拒绝包含空字节(规避路径注入)
 *  - 不在此处挡 HOME —— `ensureMemoryWikiDirs` 选 throw,`appendMemoryWikiGitignore`
 *    选 silent no-op,以贴合各自 spec 的语气。
 */
function resolveRoot(projectRoot: string): string {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new MemoryWikiPathError(`refuse: projectRoot is empty`);
  }
  if (projectRoot.includes('\0')) {
    throw new MemoryWikiPathError(`refuse: projectRoot contains NUL byte`);
  }
  return path.resolve(projectRoot);
}

function isHome(p: string): boolean {
  return p === os.homedir();
}

/**
 * 校验目标路径在解析后仍位于 root 之下。
 * 任何 ../ 跳出或绝对路径都拒绝。
 */
function assertInsideRoot(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.length === 0) {
    throw new MemoryWikiPathError(`refuse: target equals projectRoot`);
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new MemoryWikiPathError(
      `refuse: path escapes projectRoot: root=${root} target=${target}`,
    );
  }
}

export interface EnsureResult {
  projectRoot: string;
  created: MemoryWikiDir[];
  existed: MemoryWikiDir[];
}

/**
 * 幂等创建 .raw / .wiki / .outputs 三目录。
 *
 * 行为:
 *  - 已存在的目录:skip,加入 existed 列表,不读不改不删
 *  - 不存在的目录:mkdir(非 recursive,失败冒泡),加入 created 列表
 *  - 路径存在但不是目录:throw(绝不让一个文件被替换)
 *  - 硬边界:resolveSafeRoot 拒绝 HOME / 空 / NUL
 */
export async function ensureMemoryWikiDirs(
  projectRoot: string,
): Promise<EnsureResult> {
  const root = resolveRoot(projectRoot);
  // HOME 严格策略:大概率是 caller 配错,直接抛错让它显式处理
  if (isHome(root)) {
    throw new MemoryWikiPathError(`refuse: projectRoot equals HOME (${root})`);
  }
  const created: MemoryWikiDir[] = [];
  const existed: MemoryWikiDir[] = [];

  for (const name of MEMORY_WIKI_DIRS) {
    const target = path.join(root, name);
    assertInsideRoot(root, target);

    let stat: import('fs').Stats | null = null;
    try {
      stat = await fs.stat(target);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') throw e;
    }

    if (stat) {
      if (!stat.isDirectory()) {
        throw new MemoryWikiPathError(
          `refuse: ${target} exists but is not a directory`,
        );
      }
      existed.push(name);
      continue;
    }

    await fs.mkdir(target, { recursive: false });
    created.push(name);
  }

  return { projectRoot: root, created, existed };
}

export interface GitignoreAppendResult {
  appended: boolean;
  reason: string;
  gitignorePath?: string;
}

/**
 * 幂等追加工作记忆层 .gitignore 块。
 *
 * 三条件必须**同时**满足才追加:
 *  ① projectRoot 是 git 仓库(存在 .git,且 .git 是目录)
 *  ② .gitignore 文件已存在(只追加,不新建)
 *  ③ 三条目标条目(.raw/、.wiki/、.outputs/)都还不在 .gitignore 里
 *
 * 任一不满足就什么都不做,返回 { appended: false, reason }。
 */
export async function appendMemoryWikiGitignore(
  projectRoot: string,
): Promise<GitignoreAppendResult> {
  const root = resolveRoot(projectRoot);
  // HOME 策略:贴合 spec "不满足任一条件就什么都不做" —— silent no-op
  if (isHome(root)) {
    return {
      appended: false,
      reason: 'projectRoot equals HOME (refusing to write)',
    };
  }

  // ① 是 git 仓库
  const gitDir = path.join(root, '.git');
  assertInsideRoot(root, gitDir);
  let gitStat: import('fs').Stats | null = null;
  try {
    gitStat = await fs.stat(gitDir);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== 'ENOENT') throw e;
  }
  if (!gitStat) {
    return { appended: false, reason: 'not a git repository (.git missing)' };
  }
  if (!gitStat.isDirectory()) {
    return { appended: false, reason: '.git exists but is not a directory' };
  }

  // ② .gitignore 已存在
  const gitignorePath = path.join(root, '.gitignore');
  assertInsideRoot(root, gitignorePath);
  let existing: string;
  try {
    existing = await fs.readFile(gitignorePath, 'utf-8');
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return { appended: false, reason: '.gitignore does not exist (not creating)' };
    }
    throw e;
  }

  // ③ 块尚未存在(以三条目标行全在为准 —— 即便用户手写过这些行也算"已存在")
  const linesToAdd = ['.raw/', '.wiki/', '.outputs/'];
  const existingLines = new Set(
    existing.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0),
  );
  const allPresent = linesToAdd.every((l) => existingLines.has(l));
  if (allPresent) {
    return { appended: false, reason: 'all entries already present', gitignorePath };
  }

  // 写入:保留原有内容,补尾换行后追加块
  const sep = existing.endsWith('\n') ? '' : '\n';
  const next = existing + sep + GITIGNORE_BLOCK;
  await fs.writeFile(gitignorePath, next, 'utf-8');
  return { appended: true, reason: 'appended', gitignorePath };
}
