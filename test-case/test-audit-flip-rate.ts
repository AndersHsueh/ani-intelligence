/**
 * test-case/test-audit-flip-rate.ts
 *
 * P2 · 审计层地基 —— flip-rate 统计 + 审计模型声明测试
 *
 * 节点判据(任务书):
 *  - 空输入 / 全不翻转 / 部分翻转 / 全翻转,翻转率数值正确
 *  - 审计模型 alias 只声明不接调用(声明内容 + 未接线标记)
 *
 * 运行: bun run test-case/test-audit-flip-rate.ts
 */

import {
  AUDIT_MODEL,
  AUDIT_MODEL_WIRED,
  flipRateSourceToSuspect,
} from '../src/runtime/workspace/audit.js';
import {
  makeCounters,
  makeAssert,
  makeSection,
  summarize,
} from './_harness.js';

const counters = makeCounters();
const assert = makeAssert(counters);
const section = makeSection();

function main(): void {
  // ── ① 空输入 ──────────────────────────────────────────────────
  section('① 空输入 → 0');
  {
    const r = flipRateSourceToSuspect([]);
    assert(r === 0, `空输入翻转率 = 0 (实际 ${r})`);
  }

  // ── ② 全不翻转 ────────────────────────────────────────────────
  section('② 全不翻转 → 0');
  {
    const r = flipRateSourceToSuspect([
      { before: '源', after: '源' },
      { before: '源', after: '源' },
      { before: '推', after: '推' },
      { before: '疑', after: '疑' },
    ]);
    assert(r === 0, `全部保持原标 → 0 (实际 ${r})`);
  }

  // ── ③ 部分翻转 ────────────────────────────────────────────────
  section('③ 部分翻转 → 翻转数 / 审计前 [源] 总数');
  {
    // 4 条 before=源,其中 1 条翻转为疑 → 1/4 = 0.25
    // 推→疑 / 疑→源 不进分子也不进分母(只统计 源→疑)
    const r = flipRateSourceToSuspect([
      { before: '源', after: '疑' },   // 翻转 ✓
      { before: '源', after: '源' },
      { before: '源', after: '源' },
      { before: '源', after: '推' },   // 源→推 不算 源→疑
      { before: '推', after: '疑' },   // 非 源 起跳,不计
      { before: '疑', after: '源' },   // 非 源 起跳,不计
    ]);
    assert(r === 0.25, `1/4 源→疑 → 0.25 (实际 ${r})`);
  }

  // ── ④ 全翻转 ──────────────────────────────────────────────────
  section('④ 全翻转 → 1');
  {
    const r = flipRateSourceToSuspect([
      { before: '源', after: '疑' },
      { before: '源', after: '疑' },
      { before: '源', after: '疑' },
    ]);
    assert(r === 1, `3/3 源→疑 → 1 (实际 ${r})`);
  }

  // ── ⑤ 审计模型声明:只声明不接调用 ──────────────────────────────
  section('⑤ 审计模型 alias 声明(config-only)');
  {
    assert(AUDIT_MODEL.alias === 'audit', `alias = 'audit' (实际 ${AUDIT_MODEL.alias})`);
    assert(
      AUDIT_MODEL.model === 'deepseek-v4.1-flash',
      `model = deepseek-v4.1-flash (实际 ${AUDIT_MODEL.model})`,
    );
    assert(
      AUDIT_MODEL_WIRED === false,
      `AUDIT_MODEL_WIRED = false(未接线,接入点待定) (实际 ${AUDIT_MODEL_WIRED})`,
    );
  }

  summarize(counters);
}

main();
