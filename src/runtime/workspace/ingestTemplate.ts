/**
 * src/runtime/workspace/ingestTemplate.ts
 *
 * P2 · 三级标记 —— ingest 结论行模板([源]/[推]/[疑])
 *
 * 职责:给一批 {claim, rawSpan, sourceKind},输出带三级前缀的结论行。
 *
 * 标记语义(路线图 § 三级标记):
 *   [源] —— 结论可直接追溯到原文(verify = supported)
 *   [推] —— 多份 raw 综合推断得出(本轮不产出,见下)
 *   [疑] —— 存疑:verify = unsupported / insufficient,或来源本身不可信
 *
 * 规则:
 *  1) sourceKind === 'manual-suspect' → 强制 [疑],不管 verify 结果
 *     (issues/issue_01.md 的既定合并点:触发源不可信优先于内容可追溯。
 *      verify 仍执行,verdict 留在返回值里供审计留痕。)
 *  2) 其余按 verify() 映射:supported → [源];unsupported → [疑];
 *     insufficient → [疑]。
 *
 * 本轮简化(明确声明,不为凑三态硬造语义):
 *  - 输入是"单 claim × 单 rawSpan"形状,无法表达"多份 raw 综合推断",
 *    因此本函数不产出 [推]。ConclusionMark 类型保留 '推' 作为词表,
 *    等多份综合的输入形状(claim × rawSpan[])落地时再实现 [推] 分支。
 *
 * 边界:
 *  - 纯函数:不读写 fs、不调 LLM / 网络;输出顺序 == 输入顺序。
 *  - 行格式 `[标] claim`,claim 原文照抄、不改写(保真)。
 */

import { verify, type VerifyVerdict } from './verify.js';
import type { RawSliceKind } from './rawSlicer.js';

/** 三级标记词表('推' 本轮不产出,见头注) */
export type ConclusionMark = '源' | '推' | '疑';

export interface ConclusionInput {
  /** 结论句(KARPATHY 拟写入 wiki 的一行) */
  claim: string;
  /** 该结论所依据的原文片段 */
  rawSpan: string;
  /** 原文片段的切片来源 */
  sourceKind: RawSliceKind;
}

export interface MarkedConclusion {
  mark: ConclusionMark;
  /** verify() 的原始判定(manual-suspect 强制 [疑] 时仍留痕) */
  verdict: VerifyVerdict;
  /** `[标] claim` 成品行(claim 原文照抄;输出顺序 == 输入顺序,按位与输入对齐) */
  line: string;
}

/**
 * 给一批结论打三级标记(纯函数,规则见模块头注)。
 */
export function markConclusions(
  inputs: readonly ConclusionInput[],
): MarkedConclusion[] {
  return inputs.map(({ claim, rawSpan, sourceKind }) => {
    const verdict = verify(claim, rawSpan);
    // manual-suspect 强制 [疑](触发源不可信优先);其余 supported→[源],余皆 [疑]
    const mark: ConclusionMark =
      verdict === 'supported' && sourceKind !== 'manual-suspect' ? '源' : '疑';
    return { mark, verdict, line: `[${mark}] ${claim}` };
  });
}
