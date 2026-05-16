/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type { CommandContext } from '../ui/commands/types.js';

/**
 * Creates a mock CommandContext for testing slash commands.
 */
export function createMockCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    executionMode: 'interactive',
    invocation: {
      raw: '/test',
      name: 'test',
      args: '',
    },
    services: {
      config: null,
      settings: {
        workspace: process.cwd(),
      } as any,
      git: undefined,
      logger: null,
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleVimEnabled: vi.fn().mockResolvedValue(false),
      setGeminiMdFileCount: vi.fn(),
      reloadCommands: vi.fn(),
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: vi.fn(),
      addConfirmUpdateExtensionRequest: vi.fn(),
    },
    session: {
      stats: {
        totalRequests: 0,
        totalTokens: 0,
        lastRequestTime: null,
      },
      sessionShellAllowlist: new Set(),
    },
    abortSignal: undefined,
    ...overrides,
  };
}

export interface MockConfigOptions {
  targetDir?: string;
  workingDir?: string;
  model?: string;
}

export function makeFakeConfig(_overrides: MockConfigOptions = {}): {
  getTargetDir: () => string;
  getWorkingDir: () => string;
  getModel: () => string;
} {
  return {
    getTargetDir: () => _overrides.targetDir || process.cwd(),
    getWorkingDir: () => _overrides.workingDir || process.cwd(),
    getModel: () => _overrides.model || 'test-model',
  };
}