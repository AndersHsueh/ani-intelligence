/** Regression coverage for daemon readiness and provider response boundaries. */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import axios from 'axios';
import type { Message } from '../src/types/index.js';
import { AnthropicProvider } from '../src/core/providers/anthropic.js';
import { waitForDaemonReady } from '../src/utils/daemonClient.js';
import { extractTextContent } from '../src/utils/textContent.js';
import { generateCaption } from '../src/runtime/agent/agentLoop.js';
import { extractMemories } from '../src/services/memory/extractMemories.js';

let passed = 0;
let failed = 0;

function assert(value: unknown, message: string): void {
  if (value) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function msg(role: Message['role'], content: string): Message {
  return { role, content, timestamp: new Date() };
}

const logger = {
  warn: () => undefined,
} as never;

async function testDelayedReadiness(): Promise<void> {
  let checks = 0;
  await waitForDaemonReady(
    async () => ++checks >= 3,
    { timeoutMs: 250, intervalMs: 1 },
  );
  assert(checks === 3, '进程存活但 socket 晚到时持续轮询至 ready');

  const startedAt = Date.now();
  let timedOut = false;
  try {
    await waitForDaemonReady(async () => false, { timeoutMs: 20, intervalMs: 1 });
  } catch (error: unknown) {
    timedOut = error instanceof Error && error.message.includes('等待 daemon 就绪超时');
  }
  assert(timedOut && Date.now() - startedAt < 200, 'daemon 永久不可用时按短超时返回明确错误');
}

async function testCaptionStructuredResponse(): Promise<void> {
  const caption = await generateCaption(
    undefined,
    [msg('user', '请整理发布计划')],
    {
      chat: async () => ({
        content: [{ type: 'text', text: '整理发布计划' }],
      }),
    },
    logger,
    new AbortController().signal,
  );
  assert(caption?.includes('整理发布计划') === true, 'caption 从结构化 content 提取文本');
  assert(caption?.includes('[object Object]') === false, 'caption 不产生 [object Object]');
}

async function testAnthropicProviderBoundary(): Promise<void> {
  const originalPost = axios.post;
  axios.post = (async () => ({
    data: { content: [{ type: 'text', text: 'provider-boundary' }] },
  })) as typeof axios.post;

  try {
    const provider = new AnthropicProvider({
      baseURL: 'https://example.invalid/anthropic',
      model: 'MiniMax-M3',
      apiKey: 'test-only',
      temperature: 0,
      maxTokens: 32,
    }, 'test system prompt');
    const text = await provider.chat([msg('user', 'ping')]);
    assert(text === 'provider-boundary', 'AnthropicProvider.chat 在 provider 边界返回纯文本');
    assert(typeof text === 'string', 'AnthropicProvider.chat 保持 Promise<string> 契约');
  } finally {
    axios.post = originalPost;
  }
}

async function testMemoryStructuredResponse(): Promise<void> {
  const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-runtime-boundary-'));
  try {
    const messages = [msg('user', '项目使用 Bun 和 ESM')];
    const result = await extractMemories('structured', messages, {
      memoryDir,
      summarize: async () => ({
        content: [{ type: 'text', text: '- 项目使用 Bun\n- 项目使用 ESM\n- 提交前运行测试' }],
      }),
    });
    assert(result.bullets.length === 3, 'memory 从结构化 content 提取 bullets');
    assert((await fs.readFile(result.filePath, 'utf8')).includes('- 项目使用 Bun'), '结构化 memory 正常落盘');

    const empty = await extractMemories('empty', messages, {
      memoryDir,
      summarize: async () => ({ content: [] }),
    });
    assert(empty.bullets.length === 0, 'memory 空结构化响应安全跳过');
    const emptyExists = await fs.stat(empty.filePath).then(() => true, () => false);
    assert(!emptyExists, 'memory 空响应不创建文件');
  } finally {
    await fs.rm(memoryDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log('🧪 test-issue-022 — runtime response boundaries\n');
  assert(extractTextContent({ message: { content: 'hello' } }) === 'hello', 'helper 兼容嵌套 message.content');
  await testDelayedReadiness();
  await testAnthropicProviderBoundary();
  await testCaptionStructuredResponse();
  await testMemoryStructuredResponse();
  console.log(`\nPASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

await main();
