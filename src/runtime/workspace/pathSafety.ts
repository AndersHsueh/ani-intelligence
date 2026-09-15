/**
 * src/runtime/workspace/pathSafety.ts
 *
 * workspace 子模块共享的路径 / HOME 校验原语。
 *
 * 背景:
 *  P0 memoryWikiPaths.ts / P1 rawSlicer.ts / P1 watermark.ts 三处各自定义了
 *  几乎一样的 `resolveRoot` / `assertInsideRoot` / `isHome`。这里提取共享版本,
 *  通过参数化 ErrorClass 让调用方仍抛自己的错误类型(便于上层 catch 区分),
 *  底层检查只有一份。
 *
 * 边界:
 *  - 不调任何 LLM / 网络 / 不动 daemon / agentLoop
 *  - 不写任何文件:本模块只做输入校验,落盘由调用方负责
 *  - 不抛自己定义的错误类;调用方传什么 ErrorClass,就抛什么
 */

import os from 'os';
import path from 'path';

/** 错误类构造函数签名 —— 任何 `new (msg: string) => Error` 都接受 */
export type ErrorCtor = new (message: string) => Error;

/**
 * 解析 projectRoot 并做输入校验。
 *  - 必须是非空字符串
 *  - 拒绝 NUL 字节(规避路径注入)
 *  - 解析为绝对路径
 *
 * 抛错由 ErrorClass 决定。
 */
export function resolveRoot(
  ErrorClass: ErrorCtor,
  projectRoot: string,
): string {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new ErrorClass('refuse: projectRoot is empty');
  }
  if (projectRoot.includes('\0')) {
    throw new ErrorClass('refuse: projectRoot contains NUL byte');
  }
  return path.resolve(projectRoot);
}

/** 判断解析后路径是否为 os.homedir()。 */
export function isHome(p: string): boolean {
  return p === os.homedir();
}

/**
 * 校验 target 路径在解析后仍位于 root 之下。
 * 任何 `../` 跳出或绝对路径都拒绝。
 */
export function assertInsideRoot(
  ErrorClass: ErrorCtor,
  root: string,
  target: string,
): void {
  const rel = path.relative(root, target);
  if (rel.length === 0) {
    throw new ErrorClass(`refuse: target equals projectRoot`);
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ErrorClass(
      `refuse: path escapes projectRoot: root=${root} target=${target}`,
    );
  }
}