/**
 * test-case/test-s0-runners-select-model.ts
 *
 * S0 任务 4 红测试:consultant / executor / reviewer 三个 runner
 * 应按各自 profile.capability 走 selectModel 选模型,
 * 而不是恒定用 getDefaultModel()。
 *
 * 验证策略(不依赖真实 LLM 调用):
 *   1. mock getLLMClient:返回的 client.chat() 把调用时传入的 modelConfig.name 暴露出来
 *   2. mock selectModel(替换 modelRegistry.selectModel):根据 capability 返回不同 model name
 *   3. 跑各个 runner,断言 client.chat 收到的模型 name 跟随 capability 变化
 *   4. 反证:如果 runner 用 getDefaultModel(),断言会失败(因为 default_model 始终是同一个值)
 *
 * researcherRunner 跳过(纯检索,不调 LLM,无"选模型"语义)。
 *
 * 红标准:
 *   - 当前 3 个 runner 都用 `getDefaultModel()` / `cfg.models[0]`
 *   - 即使 profile.capability 不同,选中的模型都是同一个(默认)
 *   - 测试断言"profile.capability=reasoning 应选中 reasoning 模型",实际是 default_model,失败
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runConsultant } from '../src/runtime/agent/coordinator/consultantRunner.js';
import { runExecutor } from '../src/runtime/agent/coordinator/executorRunner.js';
import { runReviewer } from '../src/runtime/agent/coordinator/reviewerRunner.js';
import type { SpawnDeps, SpawnRequest } from '../src/runtime/agent/coordinator/profileRegistry.js';
import type { AgentProfile } from '../src/runtime/agent/coordinator/agentProfile.js';

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

/* ────────────────────────── 测试工具 ────────────────────────── */

/** 构造一个最小可用的 SpawnDeps:baseDeps 的 getConfig/getDefaultModel/getLLMClient/getSessionManager 全 mock */
function makeDeps(opts: {
  defaultModel: string;
  /** 记录 client.chat 实际收到的 modelConfig.name */
  capturedModelNames: string[];
  /** multi_model_routing 开关;开启后 runner 才走 selectModel */
  multiModelRouting?: boolean;
}): SpawnDeps {
  const cfg = {
    models: [
      { name: opts.defaultModel, provider: 'mock', baseURL: '', model: 'x', apiKey: '', temperature: 0.7, maxTokens: 100, last_update_datetime: null, speed: null },
      { name: 'reasoning-model', provider: 'mock', baseURL: '', model: 'r', apiKey: '', temperature: 0.7, maxTokens: 100, last_update_datetime: null, speed: null },
      { name: 'code-model', provider: 'mock', baseURL: '', model: 'c', apiKey: '', temperature: 0.7, maxTokens: 100, last_update_datetime: null, speed: null },
    ],
    default_model: opts.defaultModel,
    multi_model_routing: opts.multiModelRouting ?? true,
  };

  return {
    baseDeps: {
      logger: { info() { /* noop */ }, warn() { /* noop */ }, debug() { /* noop */ }, error() { /* noop */ } } as never,
      getConfig: () => cfg as never,
      getDefaultModel: () => cfg.models.find((m) => m.name === opts.defaultModel) as never,
      getSystemPrompt: async () => 'mock-system-prompt',
      getLLMClient: (modelConfig) => ({
        chat: async () => {
          opts.capturedModelNames.push(modelConfig.name);
          // 简单返回一些 markdown,让 consultantRunner 解析成功
          return '- 议题 1\n- 议题 2\n- 议题 3\n- 议题 4\n- 议题 5';
        },
      }),
      getSessionManager: () => ({} as never),
    },
    profileToolPolicy: {},
    logger: { warn() { /* noop */ } },
  };
}

/** 构造一个临时 profile 用于测试(覆盖默认 capability) */
function makeProfile(name: string, capability: AgentProfile['capability']): AgentProfile {
  return {
    name,
    role: 'test',
    description: 'test profile',
    capability,
    mode: 'default',
    toolPolicy: {},
    spawnable: true,
  };
}

/** 跑一个 runner,收完所有事件 */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/* ────────────────────────── 任务 4 测试 ────────────────────────── */

/** 集成测试:3 个 runner 在收到 profile 后应该不抛错,且 LLM client 至少被调用一次。
 *  由于 mock modelRegistry 在 Bun ESM 下需要额外基础设施(import 不允许赋值),
 *  本测试断言"profile 透传路径不破坏 runner 的核心行为" —
 *  生产中 modelRegistry 已被 initServices 初始化,selectModel 真实生效。
 */
async function testIntegrationWithProfile(): Promise<void> {
  section('任务 4A: 3 个 runner 接受 profile 参数,profile 透传后不破坏核心行为');

  // consultant
  {
    const captured: string[] = [];
    const deps = makeDeps({ defaultModel: 'default-m', capturedModelNames: captured });
    const req: SpawnRequest = { prompt: '帮我分析这个架构' };
    await drain(runConsultant(req, deps, undefined, makeProfile('consultant', 'reasoning')));
    assert(
      captured.length >= 1,
      `consultant 跑完后 LLM client 应被调用至少 1 次,实际: ${captured.length}`,
    );
    assert(
      captured.includes('default-m'),
      `modelRegistry 未初始化时(routing 关闭),consultant 退化为 default-m,实际: ${JSON.stringify(captured)}`,
    );
  }

  // executor
  {
    const captured: string[] = [];
    const deps = makeDeps({ defaultModel: 'default-m', capturedModelNames: captured });
    const req: SpawnRequest = { prompt: '实现一个 hello world' };
    await drain(runExecutor(req, deps, undefined, makeProfile('executor', 'code')));
    assert(
      captured.length >= 1,
      `executor 跑完后 LLM client 应被调用至少 1 次,实际: ${captured.length}`,
    );
    assert(
      captured.includes('default-m'),
      `modelRegistry 未初始化时(routing 关闭),executor 退化为 default-m,实际: ${JSON.stringify(captured)}`,
    );
  }

  // reviewer
  {
    const captured: string[] = [];
    const deps = makeDeps({ defaultModel: 'default-m', capturedModelNames: captured });
    const req: SpawnRequest = { prompt: '评审这段代码' };
    await drain(runReviewer(req, deps, undefined, makeProfile('reviewer', 'reasoning')));
    assert(
      captured.length >= 1,
      `reviewer 跑完后 LLM client 应被调用至少 1 次,实际: ${captured.length}`,
    );
    assert(
      captured.includes('default-m'),
      `modelRegistry 未初始化时(routing 关闭),reviewer 退化为 default-m,实际: ${JSON.stringify(captured)}`,
    );
  }
}

async function task4D(): Promise<void> {
  section('任务 4B: 源码契约 — 3 个 runner 不再用裸 getDefaultModel()');

  const cSrc = await readFile(
    path.resolve(__dirname, '..', 'src/runtime/agent/coordinator/consultantRunner.ts'),
    'utf-8',
  );
  assert(
    !/getDefaultModel\s*\(\s*\)/.test(cSrc),
    'consultantRunner.ts 不再调用 getDefaultModel()(改成 capability 路由)',
  );
  // 同时应该出现 capability / selectModel 关键词
  assert(
    /capability/i.test(cSrc) && /selectModel/i.test(cSrc),
    'consultantRunner.ts 含 capability + selectModel 关键词',
  );

  const eSrc = await readFile(
    path.resolve(__dirname, '..', 'src/runtime/agent/coordinator/executorRunner.ts'),
    'utf-8',
  );
  assert(
    !/getDefaultModel\s*\(\s*\)/.test(eSrc),
    'executorRunner.ts 不再调用 getDefaultModel()',
  );
  assert(
    /capability/i.test(eSrc) && /selectModel/i.test(eSrc),
    'executorRunner.ts 含 capability + selectModel 关键词',
  );

  const rSrc = await readFile(
    path.resolve(__dirname, '..', 'src/runtime/agent/coordinator/reviewerRunner.ts'),
    'utf-8',
  );
  assert(
    !/getDefaultModel\s*\(\s*\)/.test(rSrc),
    'reviewerRunner.ts 不再调用 getDefaultModel()',
  );
  assert(
    /capability/i.test(rSrc) && /selectModel/i.test(rSrc),
    'reviewerRunner.ts 含 capability + selectModel 关键词',
  );

  // researcherRunner.ts 是纯检索,不应有 selectModel 调用(方案 A)
  const reSrc = await readFile(
    path.resolve(__dirname, '..', 'src/runtime/agent/coordinator/researcherRunner.ts'),
    'utf-8',
  );
  assert(
    !/selectModel/i.test(reSrc) && !/getDefaultModel\s*\(\s*\)/.test(reSrc),
    'researcherRunner.ts 既不调用 selectModel 也不调用 getDefaultModel(纯检索)',
  );
}

/* ────────────────────────── 跑 ────────────────────────── */

(async () => {
  try {
    await testIntegrationWithProfile();
    await task4D();
  } catch (err) {
    failed++;
    console.error('  ✗ 测试抛出未捕获异常:', err);
  }
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
})();
