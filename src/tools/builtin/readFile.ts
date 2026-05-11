/**
 * 文件系统工具：读取文件
 */

import { readFile as fsReadFile } from 'fs/promises';
import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';
import { resolveFromContext } from '../utils.js';

export const readFileTool: AniTool = {
  name: 'readFile',
  label: '读取文件',
  description: '读取指定路径的文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      encoding: {
        type: 'string',
        description: '文件编码',
        enum: ['utf-8', 'utf8', 'ascii', 'base64']
      }
    },
    required: ['path']
  },

  async execute(toolCallId, params, signal, context): Promise<ToolResult> {
    const { path: filePath, encoding = 'utf-8' } = params;
    const resolvedPath = resolveFromContext(filePath, context);

    try {
      const content = await fsReadFile(resolvedPath, encoding as BufferEncoding);
      const size = Buffer.byteLength(content, encoding as BufferEncoding);

      return {
        success: true,
        data: {
          path: resolvedPath,
          content,
          size,
          encoding
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `读取文件失败: ${getErrorMessage(error)}`
      };
    }
  }
};
