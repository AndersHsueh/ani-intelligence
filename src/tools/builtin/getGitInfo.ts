/**
 * 工作区工具：获取 Git 信息
 */

import path from 'path';
import simpleGit from 'simple-git';
import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const getGitInfoTool: AniTool = {
  name: 'getGitInfo',
  label: '获取 Git 信息',
  description: '获取当前目录的 Git 仓库信息（分支、状态等）',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Git 仓库目录（默认为当前目录）'
      }
    },
    required: []
  },

  async execute(toolCallId, params, signal, context): Promise<ToolResult> {
    const { directory = '.' } = params;
    const base = context?.workspace ?? process.cwd();
    const resolvedDir = path.isAbsolute(directory) ? directory : path.resolve(base, directory);

    try {
      const git = simpleGit(resolvedDir);
      if (!await git.checkIsRepo()) {
        return { success: false, error: '当前目录不是 Git 仓库' };
      }

      const [branch, status, remotes, log] = await Promise.all([
        git.branch(),
        git.status(),
        git.getRemotes(true),
        git.log({ maxCount: 5 })
      ]);

      return {
        success: true,
        data: {
          currentBranch: branch.current,
          branches: branch.all,
          status: {
            modified: status.modified,
            created: status.created,
            deleted: status.deleted,
            staged: status.staged,
            ahead: status.ahead,
            behind: status.behind
          },
          remotes: remotes.map(r => ({
            name: r.name,
            url: r.refs.fetch
          })),
          recentCommits: log.all.map(c => ({
            hash: c.hash.substring(0, 7),
            message: c.message,
            author: c.author_name,
            date: c.date
          }))
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `获取 Git 信息失败: ${getErrorMessage(error)}`
      };
    }
  }
};
