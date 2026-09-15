/**
 * test-case/fixtures/p2MemoryWiki.ts
 *
 * P2 三级标记测试共享夹具:issue_01 原文片段 + 三条标准 claim。
 *
 * test-verify.ts / test-ingest-template.ts 共用 —— 标记映射测试依赖
 * 这些 claim 在 verify() 下的确切判定(supported / unsupported /
 * insufficient),单点维护,防止两份拷贝漂移后耦合假设静默失效。
 */

/** 0915 路线图里描述 rawSlicer 的原文片段(见 issues/issue_01.md) */
export const RAWSPAN_RAWSlicer = [
  'rawSlicer.ts',
  '—— 只做规则匹配(代码块围栏 / 决策句模式 /',
  '/raw',
  '手动打点),',
  '不调用 LLM',
  ',不改写、不总结,保真不保优',
].join('\n');

/** 忠实结论:对原文轻度改写(去 ".ts"、换标点),verify → supported */
export const CLAIM_SUPPORTED = 'rawSlicer 只做规则匹配,不调用 LLM';

/** 否定翻转:原文说"不调用 LLM、不总结",verify → unsupported */
export const CLAIM_UNSUPPORTED = 'rawSlicer 会调用 LLM 做总结';

/** 与 rawSpan 零交集,verify → insufficient */
export const CLAIM_INSUFFICIENT = '分布式共识协议需要多数派确认';
