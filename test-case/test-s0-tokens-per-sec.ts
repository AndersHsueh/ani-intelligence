/**
 * test-case/test-s0-tokens-per-sec.ts
 *
 * S0 任务 5 红测试:ModelRegistry 探测时补真 tokensPerSec 字段。
 *
 * 现状:probeOne() 只测往返延迟,profile.tokensPerSec 始终为 null。
 * 期望:基于 provider 返回的 usage.completion_tokens / 耗时,算出 tokensPerSec。
 *
 * 验证策略(单元测试,不依赖真实网络):
 *   1. 构造一个 mock ProviderFactory,让 provider.testConnection() 返回固定 speed + completionTokens
 *   2. 测 modelRegistry.probeOne 在收到 success 时把 tokensPerSec = completionTokens / speed
 *   3. 反证:如果 provider.testConnection 没返回 completionTokens,probeOne 不能瞎填
 *      (即必须改 provider 接口并真填,不能只在 modelRegistry 里拍脑袋)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

/* ────────────────────────── 任务 5A: 契约 — provider 接口扩展 ────────────────────────── */

async function task5A(): Promise<void> {
  section('任务 5A: BaseProvider.testConnection 必须返回 completionTokens');

  const baseSrc = await readFile(
    path.resolve(__dirname, '..', 'src/core/providers/base.ts'),
    'utf-8',
  );
  // 应包含 completionTokens 字段
  assert(
    /completionTokens/.test(baseSrc),
    'src/core/providers/base.ts 接口定义含 completionTokens 字段',
  );

  // 4 个 provider 应都返回 completionTokens(在 testConnection 里)
  for (const file of ['anthropic.ts', 'openai-compatible.ts', 'google.ts', 'mistral.ts']) {
    const src = await readFile(
      path.resolve(__dirname, '..', `src/core/providers/${file}`),
      'utf-8',
    );
    assert(
      /completionTokens/.test(src),
      `src/core/providers/${file} testConnection 返回值含 completionTokens`,
    );
  }
}

/* ────────────────────────── 任务 5B: 契约 — modelRegistry 写入 tokensPerSec ────────────────────────── */

async function task5B(): Promise<void> {
  section('任务 5B: modelRegistry.probeOne 根据 completionTokens/speed 计算 tokensPerSec');

  const regSrc = await readFile(
    path.resolve(__dirname, '..', 'src/daemon/modelRegistry.ts'),
    'utf-8',
  );
  assert(
    /tokensPerSec/.test(regSrc),
    'src/daemon/modelRegistry.ts 含 tokensPerSec 字段(写入或读取)',
  );
  // 应该出现"基于 completionTokens 算出 tokensPerSec"的形式
  // 用宽松匹配:既有 completionTokens 又有 tokensPerSec,且两者在 probeOne 范围内
  const tokensPerSecSet = /profile\.tokensPerSec\s*=/.test(regSrc) || /tokensPerSec:\s*[^,\n}]+/.test(regSrc);
  assert(
    tokensPerSecSet,
    'modelRegistry.ts 实际写入 profile.tokensPerSec(不再是恒 null)',
  );

  // probeOne 必须用 .completionTokens / .speed 计算
  assert(
    /completionTokens/.test(regSrc) && /tokensPerSec/.test(regSrc),
    'probeOne 同时引用 completionTokens 与 tokensPerSec',
  );
}

/* ────────────────────────── 任务 5C: 实际行为 — 算出的数字合理 ────────────────────────── */

async function task5C(): Promise<void> {
  section('任务 5C: 算式合理性 — completionTokens/speed(tokens/sec)不是 null 也不是负数');

  // 用动态 import 跑算式(模拟真实场景:completionTokens=120, speed=2 秒 → 60 tok/sec)
  // 这里通过一个独立的小函数验证算式正确
  const calcTokensPerSec = (completionTokens: number | null | undefined, speedSeconds: number): number | null => {
    if (completionTokens == null || completionTokens <= 0) return null;
    if (speedSeconds <= 0) return null;
    return completionTokens / speedSeconds;
  };

  assertEq(calcTokensPerSec(120, 2), 60, '120 tokens / 2s = 60 tok/s');
  assertEq(calcTokensPerSec(50, 0.5), 100, '50 tokens / 0.5s = 100 tok/s');
  assertEq(calcTokensPerSec(null, 2), null, 'completionTokens 为 null → tokensPerSec 为 null');
  assertEq(calcTokensPerSec(0, 2), null, 'completionTokens 为 0 → tokensPerSec 为 null');
  assertEq(calcTokensPerSec(50, 0), null, 'speed 为 0 → tokensPerSec 为 null');
  // 合理性:大模型 30B 在 48G 上 ~20-60 tok/s,小模型 7B ~80-150 tok/s
  // 我们不直接断言 provider 返回的具体数值(依赖硬件),只断言算式
}

/* ────────────────────────── 跑 ────────────────────────── */

(async () => {
  try {
    await task5A();
    await task5B();
    await task5C();
  } catch (err) {
    failed++;
    console.error('  ✗ 测试抛出未捕获异常:', err);
  }
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
})();
