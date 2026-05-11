/**
 * loadSkill 工具
 * LLM 按需加载技能的完整内容（三阶段加载的 Instruction 阶段）
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { skillManager } from '../../core/skillManager.js';

export const loadSkillTool: AniTool = {
  name: 'loadSkill',
  label: '加载技能',
  description: 'Load the full instructions of a skill by name. Use this when a user request matches one of the available skills listed in your system prompt. Returns the complete SKILL.md content with detailed instructions.',
  parameters: {
    type: 'object',
    properties: {
      skillName: {
        type: 'string',
        description: 'The name of the skill to load (as listed in Available Skills)'
      }
    },
    required: ['skillName']
  },

  async execute(toolCallId, params, signal): Promise<ToolResult> {
    const { skillName } = params;
    const content = await skillManager.loadSkill(skillName);

    if (!content) {
      const available = skillManager.getSkills().map(s => s.name).join(', ');
      return { success: false, error: `技能 "${skillName}" 未找到。可用技能: ${available || '无'}` };
    }

    return { success: true, data: content };
  }
};
