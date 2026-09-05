/**
 * test-case/test-tui-sync-hidden-commands.ts
 *
 * TUI 融合：验证 qwen-code 专属命令的 hidden 属性为 true
 *
 * 背景：ALICE 的 TUI 从 qwen-code 完整移植，但 BuiltinCommandLoader 无差别
 * 加载了 49 个内置命令，其中 14 个是 qwen-code IDE 专属命令，不应暴露在
 * ALICE 的斜杠命令补全列表中。修复方式：给这些命令添加 hidden: true 属性，
 * useSlashCompletion 通过 !cmd.hidden 过滤隐藏命令。
 *
 * 本测试通过静态检查（文件内容扫描）验证 14 个命令文件的 hidden 属性。
 *
 * 运行: bun run test-case/test-tui-sync-hidden-commands.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, assertEq, section, summary, srcPath } from './helpers/red.js';

// 待验证的 14 个 qwen-code 专属命令（name 字段，与 command-exists 注册名一致）
const HIDDEN_COMMANDS = [
  'ide',
  'extensions',
  'hooks',
  'terminal-setup',
  'setup-github',
  'insight',
  'doctor',
  'docs',
  'bug',
  'remember',
  'checkpoint',
  'context',
  'rename',
  'plan',
];

/** 命令注册名是 kebab-case，需要转为 camelCase 文件名。 */
function nameToFileName(name: string): string {
  if (name === 'terminal-setup') return 'terminalSetupCommand';
  if (name === 'setup-github') return 'setupGithubCommand';
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Command';
}

async function main(): Promise<void> {
  section('① 验证 14 个 qwen-code 专属命令 hidden === true');

  const results: Array<{ name: string; hidden: boolean; error?: string }> = [];

  for (const name of HIDDEN_COMMANDS) {
    const fileName = nameToFileName(name);
    const filePath = srcPath(`../src/ui/commands/${fileName}.ts`);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hasHidden = /hidden:\s*true/.test(content);
      results.push({ name, hidden: hasHidden });
      assert(
        hasHidden,
        `${name}: 命令文件 ${fileName}.ts 包含 hidden: true`,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ name, hidden: false, error: errMsg });
      assert(false, `${name}: 无法读取文件 ${fileName}.ts — ${errMsg}`);
    }
  }

  section('② 汇总');
  const allPassed = results.filter((r) => r.hidden).length;
  const total = HIDDEN_COMMANDS.length;
  assertEq(allPassed, total, `${allPassed}/${total} 个命令 hidden 已正确标记`);

  // 打印所有结果以便调试
  for (const r of results) {
    if (!r.hidden) {
      console.log(`  ⚠ ${r.name}: hidden=false${r.error ? ` (${r.error})` : ''}`);
    }
  }

  summary();
}

main().catch((err) => {
  console.error('test-tui-sync-hidden-commands 异常:', err);
  process.exit(1);
});
