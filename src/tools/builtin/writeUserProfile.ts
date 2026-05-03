/**
 * Onboarding 工具：保存用户档案
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { writeProfile } from '../../onboarding/profileManager.js';
import { getErrorMessage } from '../../utils/error.js';

export const writeUserProfileTool: AniTool = {
  name: 'write_user_profile',
  label: '保存用户档案',
  description: '当已收集到用户的姓名、岗位和工作平台信息后，调用此工具将用户档案保存到本地。',
  parameters: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        description: '用户的姓名或称呼，用于创建目录（建议用拼音或英文，避免特殊字符）',
      },
      display_name: {
        type: 'string',
        description: '用户的显示名称（可以是中文）',
      },
      role_title: {
        type: 'string',
        description: '用户的岗位名称（用户自己的描述）',
      },
      role_slug: {
        type: 'string',
        description: '岗位的英文或拼音缩写，用于创建目录（如 pm、hr、rd）',
      },
      platforms: {
        type: 'array',
        items: { type: 'string' },
        description: '用户主要使用的工作平台列表（如飞书、钉钉、微信、OA系统）',
      },
    },
    required: ['username', 'display_name', 'role_title', 'role_slug', 'platforms'],
  },

  async execute(toolCallId: string, params: any, signal: AbortSignal, context?: any): Promise<ToolResult> {
    try {
      const { username, display_name, role_title, role_slug, platforms } = params;
      const now = new Date().toISOString();
      const date = now.split('T')[0];

      const content = `# 用户档案

姓名：${display_name}
创建时间：${now}

## 当前岗位
- ${role_slug}（${role_title}）— 主岗，创建于 ${date}

## 工作平台
${(platforms as string[]).map((p) => `- ${p}`).join('\n')}
`;

      writeProfile(username, content);

      return {
        success: true,
        data: { path: `~/.ani/users/${username}/profile.md` },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `保存用户档案失败: ${getErrorMessage(error)}`,
      };
    }
  },
};
