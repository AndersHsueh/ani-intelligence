/**
 * test-case/test-verify.ts
 *
 * P2 · 三级标记 —— verify() 审计原语测试
 *
 * 节点判据(任务书):
 *  - supported / unsupported / insufficient 各至少一例
 *  - 纯函数:确定性(同输入同输出)、零 LLM 零网络(另用 grep 验证)
 *
 * 共享夹具:fixtures/p2MemoryWiki.ts(issue_01 原文片段 + 标准 claim)
 *
 * 运行: bun run test-case/test-verify.ts
 */

import { verify } from '../src/runtime/workspace/verify.js';
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
  // ── ① supported:结论的关键内容在原文中可追溯 ──────────────────
  section('① supported:claim 可被 rawSpan 追溯');
  {
    // claim 对原文做了轻度改写(去掉 ".ts"、换标点),关键内容全部在原文出现
    const verdict = verify(CLAIM_SUPPORTED, RAWSPAN_RAWSlicer);
    assert(verdict === 'supported', `轻度改写的忠实结论 → supported (实际 ${verdict})`);
  }

  // ── ② unsupported:原文足以相关,但结论不可追溯 ──────────────────
  section('② unsupported:话题相关但 claim 不可追溯');
  {
    // 否定翻转:原文说"不调用 LLM、不总结",claim 说"会调用 LLM 做总结"。
    // 话题词元大量重合(覆盖率落入可判定带),但关键谓词词元缺失 → unsupported。
    // 这是审计要抓的典型形态(本地小模型幻觉:把否定句读反)。
    const v1 = verify(CLAIM_UNSUPPORTED, RAWSPAN_RAWSlicer);
    assert(v1 === 'unsupported', `否定翻转的 claim → unsupported (实际 ${v1})`);

    // 锚点缺失:claim 引入原文没有的拉丁锚点(tmp+rename)。
    // 锚点(文件名/标识符/版本)必须字面命中,缺失即不可 supported。
    const v2 = verify(
      'watermark 推进用 tmp+rename 落盘',
      'watermark 推进策略已讨论完毕',
    );
    assert(v2 === 'unsupported', `锚点缺失(tmp+rename)→ unsupported (实际 ${v2})`);
  }

  // ── ③ insufficient:原文不足,无从判定 ─────────────────────────
  section('③ insufficient:原文不足');
  {
    const v1 = verify(CLAIM_INSUFFICIENT, '今天天气不错。');
    assert(v1 === 'insufficient', `零交集 → insufficient (实际 ${v1})`);

    const v2 = verify('', RAWSPAN_RAWSlicer);
    assert(v2 === 'insufficient', `空 claim → insufficient (实际 ${v2})`);

    const v3 = verify(CLAIM_SUPPORTED, '');
    assert(v3 === 'insufficient', `空 rawSpan → insufficient (实际 ${v3})`);
  }

  // ── ④ 确定性:同输入两次调用同结果(纯函数) ────────────────────
  section('④ 确定性:同输入两次调用同结果');
  {
    const a = verify(CLAIM_SUPPORTED, RAWSPAN_RAWSlicer);
    const b = verify(CLAIM_SUPPORTED, RAWSPAN_RAWSlicer);
    assert(a === b, `两次调用一致 (${a} === ${b})`);
  }

  summarize(counters);
}

main();
