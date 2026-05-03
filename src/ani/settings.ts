/**
 * AniSettings — 读取 ~/.ani/settings.jsonc 的 subagent 配置
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse } from 'comment-json';

export type SubAgentTool = 'claude-code' | 'codebuddy' | 'trae-cli';

export interface AniSettings {
  subagent: {
    default: SubAgentTool;
    fallback: SubAgentTool[];
    'claude-code': {
      settings?: string;
      extraArgs?: string[];
    };
    codebuddy: {
      model?: string;
      extraArgs?: string[];
    };
    'trae-cli': {
      extraArgs?: string[];
    };
  };
}

const DEFAULT_SETTINGS: AniSettings = {
  subagent: {
    default: 'claude-code',
    fallback: ['codebuddy', 'trae-cli'],
    'claude-code': {},
    codebuddy: {},
    'trae-cli': {},
  },
};

let cachedSettings: AniSettings | null = null;

/**
 * 读取 ~/.ani/settings.jsonc 中的 subagent 配置。
 * 文件不存在或解析失败时返回默认值。
 * 带缓存，首次读取后不再重复读文件。
 */
export function loadAniSettings(): AniSettings {
  if (cachedSettings) return cachedSettings;

  const settingsPath = path.join(os.homedir(), '.ani', 'settings.jsonc');

  try {
    if (!fs.existsSync(settingsPath)) {
      cachedSettings = DEFAULT_SETTINGS;
      return cachedSettings;
    }

    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = parse(raw) as Record<string, unknown>;

    if (parsed.subagent && typeof parsed.subagent === 'object') {
      cachedSettings = {
        subagent: {
          default: (parsed.subagent as any).default ?? DEFAULT_SETTINGS.subagent.default,
          fallback: (parsed.subagent as any).fallback ?? DEFAULT_SETTINGS.subagent.fallback,
          'claude-code': (parsed.subagent as any)['claude-code'] ?? DEFAULT_SETTINGS.subagent['claude-code'],
          codebuddy: (parsed.subagent as any).codebuddy ?? DEFAULT_SETTINGS.subagent.codebuddy,
          'trae-cli': (parsed.subagent as any)['trae-cli'] ?? DEFAULT_SETTINGS.subagent['trae-cli'],
        },
      };
    } else {
      cachedSettings = DEFAULT_SETTINGS;
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
  }

  return cachedSettings;
}
