/**
 * 系统工具：向用户提问
 * AI 可以通过此工具向用户提出问题并获取回答
 */

import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

// 全局回调队列 - 用于从 App.tsx 传递 showQuestionDialog 函数
let showQuestionDialogCallback: ((
  question: string, 
  choices: string[], 
  allowFreeform: boolean
) => Promise<string>) | null = null;

/**
 * 设置问题对话框的显示回调（由 App.tsx 调用）
 */
export function setQuestionDialogCallback(
  callback: (question: string, choices: string[], allowFreeform: boolean) => Promise<string>
) {
  showQuestionDialogCallback = callback;
}

export const askUserTool: AniTool = {
  name: 'ask_user',
  aliases: ['askuser'],
  label: '向用户提问',
  description: '当需要澄清问题、获取用户偏好或让用户做选择时，使用此工具向用户提问。支持多选项和自由输入。',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '要问用户的问题。应该清晰、具体，让用户容易理解。'
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: '供用户选择的选项列表。如果提供了选项，用户可以通过数字键或上下箭头快速选择。'
      },
      allow_freeform: {
        type: 'boolean',
        description: '是否允许用户输入自由文本而不是选择预设选项。默认为 true。'
      }
    },
    required: ['question']
  },

  async execute(toolCallId, params, signal): Promise<ToolResult> {
    try {
      const question = params.question as string;
      const choices = (params.choices as string[]) || [];
      const allowFreeform = params.allow_freeform !== false;

      if (!question || question.trim() === '') {
        return { success: false, error: '问题不能为空' };
      }

      if (!showQuestionDialogCallback) {
        return { success: false, error: 'Question dialog not initialized. This is an internal error.' };
      }

      const answer = await showQuestionDialogCallback(question, choices, allowFreeform);

      if (!answer || answer.trim() === '') {
        return { success: false, error: '用户取消了回答' };
      }

      return { success: true, data: { question, answer: answer.trim() } };
    } catch (error: unknown) {
      return { success: false, error: `提问失败: ${getErrorMessage(error)}` };
    }
  }
};
