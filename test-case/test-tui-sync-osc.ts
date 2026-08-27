/**
 * test-case/test-tui-sync-osc.ts
 *
 * TUI 融合 W9：终端通知/进度 OSC —— 先红测试（TDD 第一阶段）
 *
 * 测试文件：test-case/test-tui-sync-osc.ts（本文件）
 * 实现目标（工程师须实现，禁止改动本测试）：
 *   新增 src/ui/utils/osc.ts，导出纯函数：
 *
 *     export function isProgressBarSupported(
 *       env: NodeJS.ProcessEnv = process.env,
 *       stdout?: Pick<typeof process.stdout, 'isTTY'>,
 *     ): boolean
 *
 *   判定契约（与 qwen-code useTerminalProgress.ts 的检测逻辑对齐，alice 按
 *   冻结计划 T3 升级为环境变量可注入的纯函数，便于单测）：
 *     - 非 TTY（CI/管道/重定向）一律 false —— 不发射任何转义序列
 *     - env.ITERM_SESSION_ID 存在（iTerm2）          → true
 *     - env.KITTY_WINDOW_ID 存在（Kitty，kitty 协议进度序列）→ true
 *     - env.GHOSTTY_RESOURCES_DIR 存在（Ghostty）     → true
 *     - 以上均无（未知终端）                          → false
 *
 *   说明：qwen-code 原版还检测 ConEmuPID/WT_SESSION（Windows 系）；alice
 *   本期只要求上述三个 POSIX 环境 + 未知分支（冻结计划 T3 验收 a 的四分支），
 *   实现者可以额外支持 Windows 变量，但不影响本测试的四个断言。
 *
 * 断言要点：
 *   - isProgressBarSupported 对 ITERM_SESSION_ID 返回 true
 *   - 对 KITTY_WINDOW_ID 返回 true
 *   - 对 GHOSTTY_RESOURCES_DIR 返回 true
 *   - 对未知终端（空 env）返回 false
 *   - stdout 非 TTY 时一律 false（即使 ITERM_SESSION_ID 存在）
 *
 * 预期先红原因：src/ui/utils/osc.ts 尚不存在（alice 未融合 W9）。
 *
 * 运行: bun run test-case/test-tui-sync-osc.ts
 */

import type { NodeJS } from 'node:process';
import { assert, section, summary, importModule, srcPath } from './helpers/red.js';

interface OscModule {
  isProgressBarSupported?: (
    env: NodeJS.ProcessEnv,
    stdout?: Pick<typeof process.stdout, 'isTTY'>,
  ) => boolean;
}

const tty = { isTTY: true };
const pipe = { isTTY: undefined };

async function main(): Promise<void> {
  section('① isProgressBarSupported 四分支判定');
  const { mod, error } = await importModule<OscModule>(srcPath('../src/ui/utils/osc.js'));
  const fn = mod?.isProgressBarSupported;

  if (!fn) {
    assert(
      false,
      'isProgressBarSupported 存在且可调用' +
        `（功能未实现：src/ui/utils/osc.ts 缺失或导出缺失；${error ?? '未知原因'}）`,
    );
    // 其余断言在函数缺失时全部记红，保持失败信息完整
    assert(false, 'ITERM_SESSION_ID → true（功能未实现）');
    assert(false, 'KITTY_WINDOW_ID → true（功能未实现）');
    assert(false, 'GHOSTTY_RESOURCES_DIR → true（功能未实现）');
    assert(false, '未知终端 → false（功能未实现）');
    assert(false, '非 TTY → false（功能未实现）');
    summary();
    return;
  }

  assert(
    fn({ ITERM_SESSION_ID: '1234-ABCD' }, tty) === true,
    'ITERM_SESSION_ID（iTerm2）→ true',
  );
  assert(
    fn({ KITTY_WINDOW_ID: '1:2' }, tty) === true,
    'KITTY_WINDOW_ID（Kitty）→ true',
  );
  assert(
    fn({ GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app' }, tty) === true,
    'GHOSTTY_RESOURCES_DIR（Ghostty）→ true',
  );
  assert(
    fn({}, tty) === false,
    '未知终端（空 env，TTY）→ false',
  );

  section('② 非 TTY 保护（CI/管道不发射转义序列）');
  assert(
    fn({ ITERM_SESSION_ID: '1234-ABCD' }, pipe) === false,
    'stdout 非 TTY 时即使 ITERM_SESSION_ID 存在也返回 false',
  );
  assert(fn({}, pipe) === false, 'stdout 非 TTY 且未知终端 → false');

  section('③ 纯函数契约：不读 process.env 全局状态');
  // 契约：函数签名必须支持 env 注入；这里用「全局 env 被污染」的反例验证
  // 注入参数优先（若实现读全局 env，本条会红）。
  const saved = process.env['ITERM_SESSION_ID'];
  try {
    delete process.env['ITERM_SESSION_ID'];
    assert(
      fn({ ITERM_SESSION_ID: 'X' }, tty) === true,
      'env 参数注入生效（不依赖 process.env 全局）',
    );
  } finally {
    if (saved !== undefined) process.env['ITERM_SESSION_ID'] = saved;
  }

  summary();
}

main().catch((err) => {
  console.error('test-tui-sync-osc 异常:', err);
  process.exit(1);
});
