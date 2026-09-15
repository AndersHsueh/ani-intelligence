/**
 * test-case/test-ingest-template.ts
 *
 * P2 · 三级标记 —— ingest 结论行模板测试
 *
 * 节点判据(任务书):
 *  - manual-suspect 强制 [疑](不管 verify 结果)—— issue_01 既定合并点
 *  - 正常 verify 映射:supported→[源] / unsupported→[疑] / insufficient→[疑]
 *  - 本轮简化:单份输入形状不产出 [推]
 *
 * 共享夹具:fixtures/p2MemoryWiki.ts(issue_01 原文片段 + 标准 claim)
 *
 * 运行: bun run test-case/test-ingest-template.ts
 */

import { markConclusions } from '../src/runtime/workspace/ingestTemplate.js';
import {
  RAWSPAN_RAWSlicer,
  CLAIM_SUPPORTED,
  CLAIM_UNSUPPORTED,
  CLAIM_INSUFFICIENT,
} from './fixtures/p2MemoryWiki.js';
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
  // ── ① manual-suspect 强制 [疑](issue_01 合并点) ───────────────
  section('① manual-suspect → 强制 [疑],不管 verify 结果');
  {
    // claim 本来 verify=supported,但来源是 manual-suspect(issue_01 那条),
    // 触发源不可信优先于内容可追溯 → [疑];verdict 仍留痕 supported
    const [r] = markConclusions([
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'manual-suspect' },
    ]);
    assert(r.mark === '疑', `manual-suspect 强制疑 (实际 ${r.mark})`);
    assert(
      r.verdict === 'supported',
      `verify verdict 仍留痕 supported (实际 ${r.verdict})`,
    );
    assert(r.line.startsWith('[疑] '), `结论行以 [疑] 开头 (实际 ${r.line})`);
  }

  // ── ② 正常 verify 映射 ─────────────────────────────────────────
  section('② verify 映射:supported→[源] / unsupported→[疑] / insufficient→[疑]');
  {
    const [r1] = markConclusions([
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'manual' },
    ]);
    assert(r1.mark === '源', `manual + supported → 源 (实际 ${r1.mark})`);

    const [r2] = markConclusions([
      { claim: CLAIM_UNSUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'code' },
    ]);
    assert(r2.mark === '疑', `code + unsupported → 疑 (实际 ${r2.mark})`);

    const [r3] = markConclusions([
      { claim: CLAIM_INSUFFICIENT, rawSpan: '今天天气不错。', sourceKind: 'decision' },
    ]);
    assert(r3.mark === '疑', `decision + insufficient → 疑 (实际 ${r3.mark})`);
  }

  // ── ③ 批量:保序 + claim 保真 ──────────────────────────────────
  section('③ 批量输入:输出顺序 == 输入顺序,claim 原文保留');
  {
    const inputs = [
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'manual' as const },
      { claim: CLAIM_UNSUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'code' as const },
      { claim: CLAIM_INSUFFICIENT, rawSpan: '今天天气不错。', sourceKind: 'decision' as const },
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'manual-suspect' as const },
    ];
    const rs = markConclusions(inputs);
    assert(rs.length === inputs.length, `输出行数 == 输入条数 (${rs.length})`);
    const marks = rs.map((r) => r.mark).join(',');
    assert(marks === '源,疑,疑,疑', `四条标记序列 = 源,疑,疑,疑 (实际 ${marks})`);
    for (let i = 0; i < inputs.length; i++) {
      assert(
        rs[i].line === `[${rs[i].mark}] ${inputs[i].claim}`,
        `行 ${i} 格式 [标] + claim 原文`,
      );
    }
  }

  // ── ④ 本轮简化:单份输入不产出 [推] ─────────────────────────────
  section('④ 简化声明:单 claim × 单 rawSpan 形状不产出 [推]');
  {
    const rs = markConclusions([
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'manual' },
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'code' },
      { claim: CLAIM_SUPPORTED, rawSpan: RAWSPAN_RAWSlicer, sourceKind: 'decision' },
    ]);
    assert(
      rs.every((r) => r.mark !== '推'),
      '任何单份输入都不产出 [推](多份综合形状落地前)',
    );
  }

  summarize(counters);
}

main();
