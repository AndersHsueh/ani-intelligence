/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initCommand } from './initCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { type CommandContext } from './types.js';
import { getCurrentGeminiMdFilename } from '@qwen-code/qwen-code-core';

// Mock the 'fs' module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn();
  const writeFileSync = vi.fn();
  const readFileSync = vi.fn();
  return {
    ...actual,
    existsSync,
    writeFileSync,
    readFileSync,
    default: {
      ...(actual as unknown as Record<string, unknown>),
      existsSync,
      writeFileSync,
      readFileSync,
    },
  } as unknown as typeof import('fs');
});

describe('initCommand', () => {
  let mockContext: CommandContext;
  const targetDir = '/test/dir';
  const contextFileName = getCurrentGeminiMdFilename();
  const contextFilePath = path.join(targetDir, contextFileName);

  beforeEach(() => {
    mockContext = createMockCommandContext({
      services: {
        config: {
          getTargetDir: () => targetDir,
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(`should ask for confirmation if ${contextFileName} already exists and is non-empty`, async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('# Existing content');

    const result = await initCommand.action!(mockContext, '');

    expect(result).toEqual(
      expect.objectContaining({
        type: 'confirm_action',
        prompt: expect.anything(),
        originalInvocation: expect.anything(),
      }),
    );
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it(`should create ${contextFileName} and submit a prompt if it does not exist`, async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await initCommand.action!(mockContext, '');

    expect(fs.writeFileSync).toHaveBeenCalledWith(contextFilePath, '', 'utf8');
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: 'info',
        text: `Empty ${contextFileName} created. Now analyzing the project to populate it.`,
      },
      expect.any(Number),
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: 'submit_prompt',
        content: expect.stringContaining('Analyze this codebase'),
      }),
    );
  });

  it(`should proceed to initialize when ${contextFileName} exists but is empty`, async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('   \n  ');

    const result = await initCommand.action!(mockContext, '');

    expect(fs.writeFileSync).toHaveBeenCalledWith(contextFilePath, '', 'utf8');
    expect(result).toEqual(
      expect.objectContaining({
        type: 'submit_prompt',
      }),
    );
  });

  it(`should regenerate ${contextFileName} when overwrite is confirmed`, async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('# Existing content');
    mockContext.overwriteConfirmed = true;

    const result = await initCommand.action!(mockContext, '');

    expect(fs.writeFileSync).toHaveBeenCalledWith(contextFilePath, '', 'utf8');
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: 'info',
        text: `Empty ${contextFileName} created. Now analyzing the project to populate it.`,
      },
      expect.any(Number),
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: 'submit_prompt',
        content: expect.stringContaining('Analyze this codebase'),
      }),
    );
  });

  it('should return an error if config is not available', async () => {
    const noConfigContext = createMockCommandContext();
    if (noConfigContext.services) {
      noConfigContext.services.config = null;
    }

    const result = await initCommand.action!(noConfigContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available.',
    });
  });
});