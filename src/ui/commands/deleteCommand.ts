/**
 * /delete 删除会话命令（W5，融合自 qwen-code deleteCommand.ts）
 *
 * action 仅负责打开 delete 对话框；真正的会话选择与删除
 * 由 useDeleteCommand + SessionPicker（DialogManager 分支）完成。
 */

import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';

export const deleteCommand: SlashCommand = {
  name: 'delete',
  kind: CommandKind.BUILT_IN,
  description: 'Delete a previous session',
  action: async (): Promise<SlashCommandActionReturn> => ({
    type: 'dialog',
    dialog: 'delete',
  }),
};
