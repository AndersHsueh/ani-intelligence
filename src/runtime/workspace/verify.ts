/**
 * src/runtime/workspace/verify.ts
 *
 * P2 · 三级标记 —— 结论↔原文 确定性审计原语
 *
 * 职责:给定一条结论句(claim)和一段原文片段(rawSpan),用纯规则判定
 * claim 是否被 rawSpan 支持,输出三态:
 *   supported    —— claim 的关键内容在 rawSpan 中可追溯
 *   unsupported  —— rawSpan 与 claim 足够相关、足以判定,但 claim 不可追溯
 *   insufficient —— 原文不足:rawSpan 与 claim 几乎无交集,无从判定
 *
 * 硬原则:
 *  - 纯函数:同输入同输出,无副作用
 *  - 确定性:只依赖子串包含与计数阈值,无随机、无时间、无外部状态
 *  - 零 LLM / 零网络 / 零 fs —— 永不阻塞主 Agent 的前置审计层
 *
 * 规则设计(为什么选这套规则、阈值怎么定的):
 *
 *  1) 词元(token)= 拉丁 token + 中文 bigram
 *     - 拉丁 token:[a-z0-9_+.\\-/#] 连续段,小写化,长度 ≥ 2。
 *       覆盖标识符 / 文件名 / 版本号 / 路径(rawslicer.ts、tmp+rename、v3.0.1);
 *       单字符拉丁噪声太大,弃。
 *     - 中文 bigram:连续汉字段取相邻二字("不调用" → {不调, 调用})。
 *       中文无词边界,bigram 是免词典的经典确定性近似;单字不成 bigram,弃。
 *
 *  2) 覆盖率 cov = claim 词元中"作为子串出现在 rawSpan(小写)里"的比例
 *     子串判定对拉丁与 bigram 统一:bigram 本就是连续子串;拉丁子串包含
 *     天然兼容形态扩展(claim 写 rawSlicer、原文写 rawSlicer.ts)。
 *
 *  3) 三态阈值:
 *     - cov ≥ 0.8 且全部锚点命中 → supported
 *     - cov ≥ 0.3               → unsupported(相关但不可追溯)
 *     - cov < 0.3               → insufficient(原文不足)
 *     锚点(anchor)= claim 中的拉丁 token。任一锚点缺失即不可 supported ——
 *     命名实体(文件名 / 版本 / 标识符)是幻觉高发位,正是本审计要抓的主目标
 *     (路线图:追踪本地 4B 幻觉率);锚点必须字面命中,不接受语义近似。
 *
 *  4) 阈值取值理由(保守初值,待真实审计数据回流后校准):
 *     - 0.8:允许 claim 对原文轻度改写(删饰词 / 换标点)仍判 supported;
 *       谓词级差异会击穿此线。例:claim "rawSlicer 会调用 LLM 做总结" vs
 *       原文 "不调用 LLM、不总结" —— 6 词元失 2(会调、做总),cov=0.67,
 *       落入 unsupported 带。否定翻转不需要专门的否定规则即被捕获。
 *     - 0.3:低于此线说明原文与结论几乎无关,"判不支持"缺乏事实基础,
 *       只能承认原文不足;高于此线说明原文足以相关,缺失记在结论头上。
 *
 * 边界:
 *  - 不做语义理解 / 同义词 / 否定深判 —— 那是 LLM 审计层(审计模型)的活;
 *    本层只提供确定性、可复现的第一道闸。
 *  - claim 无有效词元(空 / 纯标点)→ insufficient。
 */
export type VerifyVerdict = 'supported' | 'unsupported' | 'insufficient';

/** 拉丁词元:小写后的连续段,长度 ≥ 2(见头注 1) */
const LATIN_TOKEN_RE = /[a-z0-9_+.\-/#]{2,}/g;
/** 连续汉字段(bigram 的原料) */
const CJK_RUN_RE = /[一-鿿]+/g;

const COV_SUPPORTED = 0.8;
const COV_JUDGEABLE = 0.3;

/**
 * 切词元:拉丁 token(小写)+ 中文 bigram,去重;tokens 为两者合并。
 *
 * 互相参照:src/services/memory/SessionMemory.ts 另有一个导出 tokenize
 * (latin + CJK bigram)。两者刻意不统一 —— 那边的拉丁字符类无 +.-/#、
 * 保留单字 CJK、且不区分 latin/bigram;本模块需要文件名/版本字符类
 * (锚点检测)与 latin/bigram 分离返回。任一侧改动分词语义时,请对照
 * 另一侧评估是否仍应分叉。
 */
function tokenize(s: string): { tokens: string[]; latin: string[] } {
  const latinSet = new Set(s.toLowerCase().match(LATIN_TOKEN_RE) ?? []);
  const bigramSet = new Set<string>();
  for (const run of s.match(CJK_RUN_RE) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      bigramSet.add(run.slice(i, i + 2));
    }
  }
  return { tokens: [...latinSet, ...bigramSet], latin: [...latinSet] };
}

/**
 * 判定 claim 是否被 rawSpan 支持(纯函数,规则见模块头注)。
 */
export function verify(claim: string, rawSpan: string): VerifyVerdict {
  const { tokens, latin } = tokenize(claim);
  if (tokens.length === 0) return 'insufficient';

  const hay = rawSpan.toLowerCase();
  const anchorSet = new Set(latin);
  let covered = 0;
  let anchorMiss = false;
  for (const t of tokens) {
    if (hay.includes(t)) {
      covered++;
    } else if (anchorSet.has(t)) {
      anchorMiss = true;
    }
  }
  const cov = covered / tokens.length;

  if (cov < COV_JUDGEABLE) return 'insufficient';
  if (cov >= COV_SUPPORTED && !anchorMiss) return 'supported';
  return 'unsupported';
}
