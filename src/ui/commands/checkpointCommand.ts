/**
 * /checkpoint 快照管理命令（T10）
 *
 * 子命令形式（参照 pluginsCommand 的多子命令模式）：
 *   /checkpoint list                列出当前会话文件的快照 id（时间倒序）
 *   /checkpoint restore <id>        恢复指定快照到文件
 *
 * 快照由 editFile/writeFile 落盘前写入（checkpointService.snapshotBeforeWrite），
 * 开关来自 settings general.checkpointing.enabled，默认关闭 → 无快照可管理。
 */

import * as fs from 'node:fs/promises';
import {
  type CommandContext,
  type SlashCommand,
} from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { checkpointService } from '../../services/checkpoint.js';
import { getErrorMessage } from '../../utils/errors.js';

function output(context: CommandContext, type: MessageType, text: string): void {
  context.ui.addItem({ type, text }, Date.now());
}

async function listAction(context: CommandContext, args: string): Promise<void> {
  const target = args.trim();
  if (!target) {
    output(context, MessageType.ERROR, '用法: /checkpoint list <文件路径>');
    return;
  }
  try {
    const ids = await checkpointService.list(target);
    if (ids.length === 0) {
      output(context, MessageType.INFO, `该文件暂无快照（注意：checkpointing 默认关闭，可在 settings.json 中设置 general.checkpointing.enabled: true 开启）: ${target}`);
      return;
    }
    const lines = [`文件 ${target} 的快照（时间倒序，共 ${ids.length} 个）:`];
    for (const id of ids) {
      lines.push(`- ${id}`);
    }
    output(context, MessageType.INFO, lines.join('\n'));
  } catch (error: unknown) {
    output(context, MessageType.ERROR, `列出快照失败: ${getErrorMessage(error)}`);
  }
}

async function restoreAction(context: CommandContext, args: string): Promise<void> {
  const match = args.trim().match(/^(\S+)\s+(\S+)$/);
  if (!match) {
    output(context, MessageType.ERROR, '用法: /checkpoint restore <文件路径> <checkpoint id>');
    return;
  }
  const [, target, id] = match;
  try {
    await checkpointService.restore(target!, id!);
    output(context, MessageType.INFO, `已恢复 ${target} 到快照 ${id}`);
  } catch (error: unknown) {
    output(context, MessageType.ERROR, `恢复失败: ${getErrorMessage(error)}`);
  }
}

async function statusAction(context: CommandContext): Promise<void> {
  try {
    await fs.access(checkpointService.getBaseDir());
    output(
      context,
      MessageType.INFO,
      `checkpointing 开关: settings general.checkpointing.enabled（默认关闭）\n快照目录: ${checkpointService.getBaseDir()}`,
    );
  } catch {
    output(
      context,
      MessageType.INFO,
      `快照目录不可访问: ${checkpointService.getBaseDir()}`,
    );
  }
}

const listCommand: SlashCommand = {
  name: 'list',
  description: '列出某文件的快照 id（时间倒序）',
  kind: CommandKind.BUILT_IN,
  action: (context, args) => listAction(context, args ?? ''),
};

const restoreCommand: SlashCommand = {
  name: 'restore',
  description: '恢复文件到指定快照',
  kind: CommandKind.BUILT_IN,
  action: (context, args) => restoreAction(context, args ?? ''),
};

const statusCommand: SlashCommand = {
  name: 'status',
  description: '查看 checkpointing 开关与快照目录',
  kind: CommandKind.BUILT_IN,
  action: (context) => statusAction(context),
};

export const checkpointCommand: SlashCommand = {
  name: 'checkpoint',
  description: '管理文件快照（list / restore <id> / status）',
  kind: CommandKind.BUILT_IN,
  subCommands: [listCommand, restoreCommand, statusCommand],
  action: (context) => statusAction(context),
};
