/**
 * 工作区工具：获取当前目录
 */

import { cwd } from 'process';
import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const getCurrentDirectoryTool: AniTool = {
  name: 'getCurrentDirectory',
  label: '获取当前目录',
  description: '获取当前工作目录的绝对路径',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(toolCallId, params, signal, context): Promise<ToolResult> {
    try {
      return {
        success: true,
        data: { path: cwd(), platform: process.platform }
      };
    } catch (error: unknown) {
      return { success: false, error: `获取当前目录失败: ${getErrorMessage(error)}` };
    }
  }
};
