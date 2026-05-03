/**
 * Onboarding 入口逻辑
 */

import { hasUserProfile } from './profileManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type AniMode = 'onboarding' | 'normal';

/**
 * 检测当前应进入哪个模式
 */
export function detectStartupMode(): AniMode {
  return hasUserProfile() ? 'normal' : 'onboarding';
}

/**
 * 根据模式返回对应的 system prompt 文件路径
 */
export function getSystemPromptPath(mode: AniMode): string {
  const promptDir = path.join(__dirname, '..', '..', 'prompt');
  return mode === 'onboarding'
    ? path.join(promptDir, 'onboarding.md')
    : path.join(promptDir, 'default.md');
}
