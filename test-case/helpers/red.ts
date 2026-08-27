/**
 * test-case/helpers/red.ts
 *
 * 先红（TDD 第一阶段）测试通用脚手架，风格对齐 test-case 既有断言脚本
 * （参照 test-issue-018.ts 的 assert/section/summary 约定）。
 *
 * 用法：
 *   import { assert, assertEq, section, summary, importModule } from './helpers/red.js';
 *
 * - 每个脚本必须以 `summary()` 收尾，输出 `PASS: n  FAIL: m` 供
 *   scripts/run-test-suite.mjs 的 summarize() 解析；失败时 exit(1)。
 * - importModule()：对尚未实现的生产模块做动态 import，模块缺失时
 *   不抛异常，而是让断言以「功能未实现：<path>」清晰失败（先红原因明确，
 *   而不是 module not found 堆栈）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

/**
 * 把 test-case/ 视角的相对路径（如 '../src/config/keyBindings.js'）解析为
 * 绝对路径，供 importModule 使用（动态 import 的相对基准是调用模块，
 * 而 importModule 在 helpers/ 内，必须由调用方先解析）。
 */
export function srcPath(relativeFromTestCase: string): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', relativeFromTestCase);
}

export function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

export function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

export function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

export interface ImportResult<T> {
  mod: T | null;
  error: string | null;
}

/**
 * 动态 import 尚未实现的模块。模块/函数缺失时返回 { mod: null, error }，
 * 调用方应据此断言失败并输出「功能未实现」，而不是让整个脚本崩溃。
 *
 * 调用方须传入「绝对路径」（test-case 下用 srcPath('../src/...') 构造），
 * 因为本函数内的动态 import 以 helpers/ 为解析基准，无法直接吃 '../src'。
 */
export async function importModule<T = Record<string, unknown>>(
  spec: string,
): Promise<ImportResult<T>> {
  try {
    const mod = (await import(spec)) as T;
    return { mod, error: null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { mod: null, error: msg };
  }
}

/**
 * 打印汇总并退出。输出格式与 test-case 既有脚本一致：`PASS: n  FAIL: m`。
 * 先红阶段：FAIL > 0 → exit(1)，保证 runner 判定脚本失败（红）。
 */
export function summary(): void {
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}
