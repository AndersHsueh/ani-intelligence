/**
 * Onboarding 工具：保存岗位工作循环
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { writeJobFlow } from '../../onboarding/profileManager.js';
import { getErrorMessage } from '../../utils/error.js';

export const writeJobFlowTool: AniTool = {
  name: 'write_job_flow',
  label: '保存岗位工作循环',
  description: '当已收集到用户的岗位工作节奏和项目生命周期描述后，调用此工具保存到 flow.md。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: '用户名' },
      role_slug: { type: 'string', description: '岗位缩写' },
      role_title: { type: 'string', description: '岗位名称' },
      daily_rhythm: {
        type: 'string',
        description: '日常节奏描述，用用户自己的话整理后的 markdown 内容',
      },
      monthly_rhythm: {
        type: 'string',
        description: '月度节奏描述',
      },
      project_lifecycle: {
        type: 'string',
        description: '项目生命周期描述（从开始到结束的阶段）',
      },
      pain_points: {
        type: 'string',
        description: '用户提到的最费时间或最容易出问题的事（可选）',
      },
    },
    required: ['username', 'role_slug', 'role_title', 'daily_rhythm', 'monthly_rhythm', 'project_lifecycle'],
  },

  async execute(toolCallId: string, params: any, signal: AbortSignal, context?: any): Promise<ToolResult> {
    try {
      const { username, role_slug, role_title, daily_rhythm, monthly_rhythm, project_lifecycle, pain_points } = params;
      const date = new Date().toISOString().split('T')[0];

      const content = `# ${role_title} — 工作循环

*初次建立：${date}，来源：用户自述*

## 日常节奏
${daily_rhythm}

## 月度节奏
${monthly_rhythm}

## 项目生命周期
${project_lifecycle}

## 痛点与注意事项
${pain_points ?? '（待补充）'}
`;

      writeJobFlow(username, role_slug, content);

      return {
        success: true,
        data: { path: `~/.ani/users/${username}/jd/${role_slug}/flow.md` },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `保存岗位工作循环失败: ${getErrorMessage(error)}`,
      };
    }
  },
};
