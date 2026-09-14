/**
 * test-case/test-s0-agent-mode-capability.ts
 *
 * S0 任务 3 红测试:`inferCapability` 应跟随 agentMode 变化,
 * 而不是恒定返回 office 模式(短文本→format,长文本→writing)。
 *
 * 红标准:
 *  - 当前 agentLoop.ts:260 调用 `inferCapability(req)`,不传 agentMode
 *  - 所以哪怕 baseDeps.getAgentMode() 返回 'coder',capability 也走 office 分支
 *  - coder 模式 + 含"架构"关键词的短文本,本应返回 'reasoning',实际会返回 'format'
 *
 * 测试方式:不直接 import inferCapability(它是模块私有,没 export),
 * 改为测"传不同 agentMode 进 deps,跑 agentLoop,看 selectModel 是否按 coder 分支选模型"。
 *
 * 简化策略:mock modelRegistry.selectModel(capability),断言:
 *  - agentMode='coder' + prompt 含"架构" → 期望 selectModel 收到 'reasoning'
 *  - agentMode='coder' + 普通 prompt     → 期望 selectModel 收到 'code'
 *  - agentMode='office'(默认)+ 短文本   → 期望 selectModel 收到 'format'
 *  - agentMode='office' + 长文本         → 期望 selectModel 收到 'writing'
 *
 * 同时做源码契约检查:agentLoop.ts:260 必须传 agentMode(grep)。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as inferCapabilityModule from '../src/runtime/agent/agentLoop.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** 通过运行时导出 + 反射调用模块私有函数 inferCapability。 */
function callInferCapability(
  agentMode: string | undefined,
  message: string,
): string {
  // agentLoop.ts 没 export inferCapability,但 TypeScript 编译时若用 export 标记,运行时可拿到
  // 用反射从 module 上找
  const fn = (inferCapabilityModule as unknown as Record<string, (...args: unknown[]) => string>)['inferCapability'];
  if (typeof fn !== 'function') {
    throw new Error('inferCapability 未从 agentLoop.js 导出,无法直接测');
  }
  return fn({ message }, agentMode);
}

function task3A(): void {
  section('任务 3A: inferCapability 跟随 agentMode 变化');

  // coder 模式 + 含"架构"关键词 → reasoning
  assertEq(
    callInferCapability('coder', '请帮我做一个架构方案'),
    'reasoning',
    "coder 模式 + '架构'关键词 → 'reasoning'",
  );

  // coder 模式 + 普通短文本 → code
  assertEq(
    callInferCapability('coder', '实现一个 hello world'),
    'code',
    "coder 模式 + 普通短文本 → 'code'",
  );

  // office 模式 + 短文本(无代码关键词) → format
  assertEq(
    callInferCapability('office', '你好'),
    'format',
    "office 模式 + 短文本 → 'format'",
  );

  // office 模式 + 长文本 → writing
  const longText = 'a'.repeat(600);
  assertEq(
    callInferCapability('office', longText),
    'writing',
    "office 模式 + 长文本(>500) → 'writing'",
  );

  // 默认(undefined)应与 office 表现一致
  assertEq(
    callInferCapability(undefined, '你好'),
    'format',
    "未传 agentMode(默认)→ 'format'(office 行为)",
  );
}

async function task3B(): Promise<void> {
  section('任务 3B: 源码契约 — agentLoop.ts:260 调用必须传 agentMode');

  const agentLoopSrc = await readFile(
    path.resolve(__dirname, '..', 'src/runtime/agent/agentLoop.ts'),
    'utf-8',
  );

  // 必须存在 `inferCapability(req, ...)` 形式(带第二个参数)
  // 容忍 `inferCapability(req, agentMode)` 或 `inferCapability(req, deps.getAgentMode?.())` 等
  assert(
    /inferCapability\(\s*req\s*,\s*[^)]+\)/.test(agentLoopSrc),
    'agentLoop.ts 源码中 inferCapability(req, ...) 至少传 2 个参数',
  );

  // 同时不允许老的"只传 req"调用残留
  // (用负向断言: `inferCapability(req)` 后紧跟 `)` 不能还有第二个参数)
  // 严格检查 `inferCapability(req)`(紧跟右括号)不应该再出现在生产调用位置
  // (允许函数定义本身)
  const callsOnlyOneArg = /inferCapability\(\s*req\s*\)/g;
  const matches = [...agentLoopSrc.matchAll(callsOnlyOneArg)];
  // 至少有一个匹配,但**调用上下文**应只有一个(函数定义 + 真正调用算 1)
  // 简单点:grep 行号确认只出现在函数定义那行
  if (matches.length > 0) {
    const firstMatch = matches[0]!;
    const lineStart = agentLoopSrc.lastIndexOf('\n', firstMatch.index!) + 1;
    const lineEnd = agentLoopSrc.indexOf('\n', firstMatch.index!);
    const lineText = agentLoopSrc.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    assert(
      /function inferCapability|export\s+function inferCapability/.test(lineText),
      `老的 inferCapability(req) 只剩在函数定义那一行(实际行: ${lineText.trim()})`,
    );
  } else {
    // 如果完全没了,说明函数定义签名也改了(也是 OK 的)
    passed++;
    console.log('  ✓ 老的 inferCapability(req) 已被替换');
  }
}

(async () => {
  try {
    task3A();
    await task3B();
  } catch (err) {
    failed++;
    console.error('  ✗ 测试抛出未捕获异常:', err);
  }
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
})();
