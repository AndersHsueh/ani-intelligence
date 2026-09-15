# Issue #01: rawSlicer manual 规则被 HTML 残留 `/raw` 字面量误命中

> 发现时间: 2026-09-15
> 状态: **已关闭**(2026-09-16,commit `9c3a60d` 修复,`fdfaf7f`/`a0f8c15` 承接三级标记与审计原语;已 fast-forward main)
> 来源: P2 首次手工 ingest 实验(`0915` 路线图切片 → `.wiki/工作记忆层落地.md`)
> 发现者: M3(实验中识别;作为 KARPATHY 编译者在 wiki 的"来源"章节如实标注了 manual 段为 rawSlicer 误用)

## 现象

0915 路线图纯文本 `/tmp/0915-plain.txt` 第 35 行是 HTML 提取时残留的字面量 `/raw` —— 原文是在描述 rawSlicer 自身的 `/raw` 规则时被嵌入的字面量:

```
rawSlicer.ts —— 只做规则匹配(代码块围栏 / 决策句模式 /
/raw
手动打点),不调用 LLM,...
```

rawSlicer 的 manual 规则扫全文时,把第 35 行当作 line-start `/raw` 触发器,把后面 78 行(原文第 36–113 行,含 P1 设计描述 / 节点判据 / 之后 / 本轮不做 / 复盘 / 签名)全吞入 manual 段。

产物 `.raw/1658-89011f6d.md` 被标 `kind: manual`,front-matter `kind` 与触发源不匹配 —— 不是"用户主动打点的真素材",而是原文里描述 rawSlicer 自身时被嵌入的字面量触发了规则。

## 影响

本次 ingest 我作为 KARPATHY 选择**承认 manual 段触发器误用 + 保留内容作为素材**(因内容真实)。后果:

- `.wiki/工作记忆层落地.md` 主题页中约 60% 的内容来自这条误触发的 manual 段
- 内容方向没崩(因 KARPATHY 在 wiki 的"来源"章节如实标注"manual 误触发")
- 但内容分布失衡:**如果 KARPATHY 不承认误用,可能直接基于误触发的 manual 段下结论,产生数据偏见**

## 复现

```bash
bun scripts/ingest-demo.mjs
ls .raw/
# 1658-2ee0c5e9.md     (decision 真命中,关键词"拍板")
# 1658-6463766c.md     (decision 真命中,关键词"决定")
# 1658-8f98b8c5.md     (decision 真命中,关键词"明确不")
# 1658-89011f6d.md     (manual 误触发 ← 本 issue 对象)
```

`code: 0` / `decision: 3` / `manual: 1`(误触发)

## 触发器上下文过滤的初步设想

给 manual 规则加一个 context filter:触发的 `/raw` 前面 5 行内若出现以下描述性词,标记 `manual-suspect` 而非纯 `manual`:

- `rawSlicer.ts`
- `手动打点`
- `规则切片器`

下游消费方可决定:`manual-suspect` 是否等同于 `manual`,还是需要人工二次确认才能晋升为 `manual`。

## 暂不动代码的理由

- 三级标记 + 独立审计(P2 第二部分)是 rawSlicer 的下一个落地步骤。该步骤会让 KARPATHY 对每条结论做 `[源]/[推]/[疑]` 标记并跑 `verify(claim, raw_span)`。在那个阶段,`manual-suspect` 自然成为 `[疑]` 类的来源之一
- 在 verify() 还没引入之前,加 `manual-suspect` 字段会让 front-matter 多一个无消费方的死字段(参考 P1 simplify 刚清理过的一波死字段)
- 等明天 ingest 模板落地 + verify() 设计时,这条 issue 跟 verify() 的"原文不足"分支自然合并,不需要现在硬编码一个孤立字段

## 关联

- `.wiki/工作记忆层落地.md` 来源章节 + 自核对章节:本次误触发被如实承认
- P2 ingest 模板(明天):应包含 `[源]/[推]/[疑]` 前缀字段 + `verify()` 审计函数
- 路线图:`outputs/0915-sword-comeback-record.html` § 三级标记 + 独立审计函数段

## 关闭记录(2026-09-16)

- **修复**:`9c3a60d fix(memory-wiki): P2-A 修 issue_01 —— manual-suspect 降级`。`matchManualSegments` 加上下文过滤,触发器前 5 行(原文本)出现 `rawSlicer.ts` / `手动打点` / `规则切片器` 任一描述性词 → 段 kind 降级为 `manual-suspect`(第 45–49 行的初步设想按字面落地,未加第 4 个自指词)。
- **承接**:`fdfaf7f`(verify() + ingestTemplate.ts 三级标记,`manual-suspect` 强制 `[疑]`)、`a0f8c15`(审计模型选型声明 + flip-rate 统计,config-only 未接线)—— 本 issue 提出的"下游消费方决定 manual-suspect 是否等同 manual"由 ingestTemplate 给出确定性答案:强制 `[疑]`。
- **验证**:issue_01 原始场景等价复现(`test-raw-slicer.ts` § ⑭)+ 真实 `/tmp/0915-plain.txt` 端到端 ingest-demo 复现,hash `89011f6d` 与本 issue 记录一致,现在标记为 `manual-suspect`。6 套件 172 断言全绿,`/simplify` 已跑。
- **状态**:已 fast-forward 进 `main`(`fe053ab..a0f8c15`),已推送 `github` 远程;`gitee` 远程由 Anders 手工同步。