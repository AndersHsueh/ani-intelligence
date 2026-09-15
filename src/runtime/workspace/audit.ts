/**
 * src/runtime/workspace/audit.ts
 *
 * P2 · 审计层地基 —— 审计模型选型声明 + flip-rate 统计
 *
 * 本模块只做两件事,都是"打地基",不接任何线上执行路径:
 *  1) AUDIT_MODEL —— 审计模型的 provider alias 声明(config-only)
 *  2) flipRateSourceToSuspect —— 审计前后 [源]→[疑] 翻转率的纯统计函数
 *
 * ── 审计模型选型 ────────────────────────────────────────────────
 *
 * 二选一选了 deepseek-v4.1-flash(候选:glm-5.3-flash),理由:
 *  - 审计是"判定"任务(claim↔source 是否支持),偏推理而非格式化;
 *    仓库自己的 ModelConfig.notes 示例(src/types/index.ts)把 GLM-flash
 *    线标为"轻量版,只做格式化,不适合推理"
 *  - DeepSeek 线在仓库能力推断(src/daemon/modelRegistry.ts)中被列为
 *    known-strong(deepseek-r),家族在判定类任务上更稳
 *  - flash 档位满足审计定位:便宜、快、绝不阻塞主 Agent(路线图原话)
 *
 * 为什么不登记进 ProviderRegistry(src/core/providers/index.ts):
 *  - Registry 的键是 provider 类型(构造函数映射),不是模型名;模型名
 *    归 ModelConfig 层管
 *  - 登记即 create() 可用 = 进入可调用状态,超出本轮"只声明不调用"边界
 *  故取任务书允许的最小形态:独立常量声明。provider 字段记厂商名
 *  'deepseek'(OpenAI 兼容协议),接线时按 lmstudio/ollama 同款方式映射到
 *  OpenAICompatibleProvider;baseURL / apiKey 留给接线任务书,不在本轮猜。
 *
 * AUDIT_MODEL_WIRED = false 是机器可检的"未接线"标记:
 * 任何执行路径(ANI / lint / daemon)在本标记翻真之前不得引用 AUDIT_MODEL
 * 发起调用。接入点(lint item vs ANI 第四分诊)待定,见路线图
 * outputs/0915-sword-comeback-record.html § 三级标记 + 独立审计函数。
 *
 * ── flip-rate ───────────────────────────────────────────────────
 *
 * 源→疑 翻转率 = 审计后从 [源] 被改标 [疑] 的条数 / 审计前为 [源] 的总条数。
 * 用途:真跑审计后追踪"本地 4B 幻觉率"——主 Agent(小模型)标 [源] 的结论
 * 被独立审计否掉的比例,越高说明小模型 [源] 标越不可信。
 *
 * 口径约定(写死,便于跨批次对比):
 *  - 分母只含 before === '源' 的对子;推/疑 起跳的不参与
 *  - 分子只含 before === '源' 且 after === '疑';源→推 不算翻转
 *  - 空输入(或无 before=源 的对子)→ 0(无可翻转基数,不是"无数据"信号;
 *    调用方若需区分,自行看分母——本函数保持纯数值返回)
 *
 * 边界:纯函数、零 LLM / 零网络 / 零 fs;不 import A/B 的实现,仅复用
 * ConclusionMark 类型词表(type-only,词表单点真相在 ingestTemplate)。
 */

import type { ConclusionMark } from './ingestTemplate.js';

/** 审计模型 alias 声明(config-only,未接线 —— 见头注) */
export const AUDIT_MODEL = {
  /** alias 名:接线后在 ModelConfig.name / 能力路由里以 'audit' 引用 */
  alias: 'audit',
  /** 厂商(OpenAI 兼容协议;接线时映射 OpenAICompatibleProvider) */
  provider: 'deepseek',
  /** 模型 id */
  model: 'deepseek-v4.1-flash',
} as const;

/**
 * 未接线标记:false = 只声明不调用。
 * 翻真需要下一份任务书拍板接入点(lint item vs ANI 第四分诊)。
 */
export const AUDIT_MODEL_WIRED = false;

/** 一对审计前后标记 */
export interface MarkFlip {
  before: ConclusionMark;
  after: ConclusionMark;
}

/**
 * 源→疑 翻转率(口径见模块头注)。
 * 输入审计前后的标记对,返回 [0, 1] 的比例;空输入 / 无 before=源 → 0。
 */
export function flipRateSourceToSuspect(pairs: readonly MarkFlip[]): number {
  let sourceBefore = 0;
  let flipped = 0;
  for (const p of pairs) {
    if (p.before !== '源') continue;
    sourceBefore++;
    if (p.after === '疑') flipped++;
  }
  if (sourceBefore === 0) return 0;
  return flipped / sourceBefore;
}
