/**
 * 文件系统工具：列出目录
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';
import { resolveFromContext } from '../utils.js';

export const listFilesTool: AniTool = {
  name: 'listFiles',
  label: '列出目录',
  description: '列出指定目录下的文件和文件夹',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: '目录路径（默认为当前目录）'
      },
      detailed: {
        type: 'boolean',
        description: '是否显示详细信息（大小、修改时间等）'
      }
    },
    required: []
  },

  async execute(toolCallId, params, signal, context): Promise<ToolResult> {
    const { directory = '.', detailed = false } = params;
    const resolvedDir = resolveFromContext(directory, context);

    try {
      const entries = await readdir(resolvedDir, { withFileTypes: true });

      const files = await Promise.all(entries.map(async entry => {
        const item: any = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        };
        if (detailed) {
          try {
            const s = await stat(join(resolvedDir, entry.name));
            item.size = s.size;
            item.modified = s.mtime;
          } catch {
            // 忽略无法访问的文件
          }
        }
        return item;
      }));

      return {
        success: true,
        data: {
          directory: resolvedDir,
          total: files.length,
          files: files.filter(f => f.type === 'file').length,
          directories: files.filter(f => f.type === 'directory').length,
          items: files
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `列出目录失败: ${getErrorMessage(error)}`
      };
    }
  }
};
