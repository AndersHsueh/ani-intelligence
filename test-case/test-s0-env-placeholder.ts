/**
 * test-case/test-s0-env-placeholder.ts
 *
 * S0 任务 2 红测试:`${VAR}` 占位符解析后污染 config 对象 → save 时被写成明文。
 *
 * 期望行为:
 *  - load 后,内存中 config.models[].apiKey 仍应是原始 `${VAR}` 占位符
 *  - save 后,磁盘文件里 apiKey 仍是 `${VAR}` 占位符(不写成明文)
 *  - 运行时通过 ConfigManager.getResolvedApiKey(name) 拿到解析后的真实值
 *
 * 红标准:
 *  - 当前实现就地改写 config.models[].apiKey(load 时替换为明文)
 *  - 之后 save 写回时,buildJsoncContent 输出 apiKey 的"已解析"明文
 *  - 所以:load → save 后磁盘上的 apiKey 会是明文
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager } from '../src/utils/config.js';

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
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
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

async function testEnvPlaceholder(): Promise<void> {
  section('任务 2: ${VAR} 占位符 load/save 不污染,运行时通过 getResolvedApiKey 拿值');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-env-'));
  const settingsPath = path.join(tmpDir, 'settings.jsonc');

  // 写一个含 ${TEST_ENV_KEY} 占位符的初始配置
  const initialConfig = `{
  // 默认使用的模型
  "default_model": "test-model",
  "suggest_model": "test-model",
  "cron-task-model": "",
  "models": [
    {
      "name": "test-model",
      "provider": "openai",
      "baseURL": "https://api.example.com/v1",
      "model": "test-model-id",
      "apiKey": "\${TEST_ENV_KEY}",
      "temperature": 0.5,
      "maxTokens": 1000,
      "last_update_datetime": null,
      "speed": null
    }
  ],
  "ui": { "banner": { "enabled": true, "style": "particle" }, "theme": "tech-blue" },
  "workspace": "/tmp/test-workspace",
  "dangerous_cmd": false,
  "maxIterations": 15,
  "multi_model_routing": false,
  "model_routing": { "format": null, "writing": null, "code": null, "reasoning": null }
}
`;
  // 设置环境变量(测试期间)
  process.env['TEST_ENV_KEY'] = 'sk-test-resolved-secret-value';

  // 用 Bun 写文件(Bun.file 比 fs.promises 简单)
  const { writeFileSync } = await import('node:fs');
  writeFileSync(settingsPath, initialConfig);

  // 加载
  const cm = new ConfigManager();
  cm.__setSettingsPathForTesting(settingsPath);
  await cm.init();

  // 1. 内存中的 config.models[].apiKey 仍应是原始占位符 ${TEST_ENV_KEY}
  const modelInMem = cm.getModel('test-model');
  assert(modelInMem !== undefined, 'getModel("test-model") 返回模型');
  assertEq(
    modelInMem?.apiKey,
    '${TEST_ENV_KEY}',
    `内存中 apiKey 仍是原始占位符(当前会被污染为明文),实际: ${JSON.stringify(modelInMem?.apiKey)}`,
  );

  // 2. 运行时通过 ConfigManager.getResolvedApiKey 拿到真实值
  const resolved = cm.getResolvedApiKey('test-model');
  assertEq(
    resolved,
    'sk-test-resolved-secret-value',
    `getResolvedApiKey 返回解析后真实值,实际: ${JSON.stringify(resolved)}`,
  );

  // 3. save 后磁盘文件 apiKey 仍应是 ${TEST_ENV_KEY}(不写成明文)
  await cm.save(cm.get());
  const diskContent = readFileSync(settingsPath, 'utf-8');
  assert(
    diskContent.includes('"apiKey": "${TEST_ENV_KEY}"'),
    `磁盘 apiKey 仍是占位符,实际片段: ${diskContent.match(/"apiKey":\s*"[^"]*"/)?.[0]}`,
  );
  assert(
    !diskContent.includes('sk-test-resolved-secret-value'),
    `磁盘文件不含明文 secret`,
  );

  // 清理
  process.env['TEST_ENV_KEY'] = '';
  await (await import('node:fs/promises')).rm(tmpDir, { recursive: true, force: true });
}

/* ─────────────────────────── 任务 2B: 测速/探测路径也现算 ─────────────────────────── */

/** 反证:testModel.ts 和 modelRegistry.ts 这两条路径如果传裸 ${VAR},
 *  它们的 ProviderFactory.create 调用会拿到未解析的占位符。
 *  我们通过断言"调用前的 resolve 路径覆盖"证明所有路径都走现算。 */
async function testSpeedAndProbePaths(): Promise<void> {
  section('任务 2B: 测速/探测路径使用 getResolvedApiKey 而非裸 model.apiKey');

  // 源码契约:grep 这两处必须用 configManager.getResolvedApiKey(model.name)
  const fsPromisesMod = await import('node:fs/promises');

  const testModelSrc = await fsPromisesMod.readFile(
    path.resolve(__dirname, '..', 'src/utils/testModel.ts'),
    'utf-8',
  );
  assert(
    /configManager\.getResolvedApiKey\(\s*model\.name\s*\)/.test(testModelSrc) &&
    !/\bapiKey:\s*model\.apiKey\b/.test(testModelSrc),
    'src/utils/testModel.ts 使用 configManager.getResolvedApiKey(model.name),不再传裸 model.apiKey',
  );

  const registrySrc = await fsPromisesMod.readFile(
    path.resolve(__dirname, '..', 'src/daemon/modelRegistry.ts'),
    'utf-8',
  );
  assert(
    /configManager\.getResolvedApiKey\(\s*model\.name\s*\)/.test(registrySrc) &&
    !/\bapiKey:\s*model\.apiKey\b/.test(registrySrc),
    'src/daemon/modelRegistry.ts 使用 configManager.getResolvedApiKey(model.name),不再传裸 model.apiKey',
  );

  // 运行时验证:getResolvedApiKey 真的能在 ${VAR} 场景下返回解析后值
  // (作为生产路径的实际行为快照)
  process.env['TEST_ENV_KEY'] = 'sk-runtime-resolved';
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'alice-s0-env2-'));
  const settingsPath = path.join(tmpDir, 'settings.jsonc');
  const initialConfig = `{
  "default_model": "rt", "suggest_model": "rt", "cron-task-model": "",
  "models": [
    { "name": "rt", "provider": "openai", "baseURL": "https://x", "model": "rt",
      "apiKey": "\${TEST_ENV_KEY}", "temperature": 0.7, "maxTokens": 100,
      "last_update_datetime": null, "speed": null }
  ],
  "ui": { "banner": { "enabled": true, "style": "particle" }, "theme": "tech-blue" },
  "workspace": "/tmp", "dangerous_cmd": false, "maxIterations": 15,
  "multi_model_routing": false, "model_routing": { "format": null, "writing": null, "code": null, "reasoning": null }
}`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(settingsPath, initialConfig);

  const cm = new ConfigManager();
  cm.__setSettingsPathForTesting(settingsPath);
  await cm.init();
  assertEq(
    cm.getResolvedApiKey('rt'),
    'sk-runtime-resolved',
    '运行时 getResolvedApiKey 返回解析值(供 testModel/modelRegistry 使用)',
  );

  // 清理
  process.env['TEST_ENV_KEY'] = '';
  await (await import('node:fs/promises')).rm(tmpDir, { recursive: true, force: true });
}

(async () => {
  try {
    await testEnvPlaceholder();
    await testSpeedAndProbePaths();
  } catch (err) {
    failed++;
    console.error('  ✗ 测试抛出未捕获异常:', err);
  }
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
})();
