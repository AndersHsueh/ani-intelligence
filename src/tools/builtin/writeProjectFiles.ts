/**
 * Onboarding 工具：保存项目信息
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { writeProjectFiles } from '../../onboarding/profileManager.js';
import { getErrorMessage } from '../../utils/error.js';

export const writeProjectFilesTool: AniTool = {
  name: 'write_project_files',
  label: '保存项目信息',
  description: '为用户新增的项目创建目录和初始文件。每个项目调用一次。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: '用户名' },
      project_name: {
        type: 'string',
        description: '项目名称（中文或英文均可）',
      },
      project_slug: {
        type: 'string',
        description: '项目目录名（英文或拼音，无空格，如 proj-crm、erp-2025）',
      },
      client: { type: 'string', description: '客户名称' },
      background: { type: 'string', description: '项目背景简述' },
      current_phase: { type: 'string', description: '当前所处阶段（如售前、执行、收尾）' },
      current_status: { type: 'string', description: '当前状态详述' },
      planned_phases: { type: 'string', description: '计划中的项目阶段列表' },
      urgent_items: { type: 'string', description: '最近最紧急的事项' },
    },
    required: ['username', 'project_name', 'project_slug', 'current_phase', 'current_status', 'urgent_items'],
  },

  async execute(toolCallId: string, params: any, signal: AbortSignal, context?: any): Promise<ToolResult> {
    try {
      const {
        username, project_name, project_slug, client, background,
        current_phase, current_status, planned_phases, urgent_items,
      } = params;
      const now = new Date().toISOString();
      const date = now.split('T')[0];

      const info = `# ${project_name} — 项目信息

*创建时间：${now}*

- 项目名称：${project_name}
- 客户：${client ?? '（待补充）'}
- 当前阶段：${current_phase}

## 背景
${background ?? '（待补充）'}

## 计划阶段
${planned_phases ?? '（待补充）'}
`;

      const status = `# ${project_name} — 项目状态

*更新时间：${now}*

## 当前阶段
${current_phase}

## 当前状态
${current_status}
`;

      const flow = `# ${project_name} — 项目流程

*初次建立：${date}，来源：用户自述*

（待补充）
`;

      const nextStep = `# 下一步行动

更新时间：${now}
*（由 Onboarding 初始生成，基于用户自述）*

## 当前最紧急
项目「${project_name}」当前处于「${current_phase}」阶段：
${urgent_items}

## 备注
后续每次对话结束后，Ani 会根据最新情况更新此文件。
`;

      writeProjectFiles(username, project_slug, { info, status, flow, nextStep });

      return {
        success: true,
        data: { path: `~/.ani/users/${username}/projects/${project_slug}/` },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `保存项目信息失败: ${getErrorMessage(error)}`,
      };
    }
  },
};
