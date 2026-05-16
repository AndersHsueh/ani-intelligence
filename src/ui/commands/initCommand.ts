/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { getCurrentGeminiMdFilename } from '@qwen-code/qwen-code-core';
import { CommandKind } from './types.js';
import { Text } from 'ink';
import React from 'react';
import { t } from '../../i18n/index.js';

export const initCommand: SlashCommand = {
  name: 'init',
  get description() {
    return t('Analyzes the project and creates a tailored agent.md file.');
  },
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Configuration not available.'),
      };
    }
    const targetDir = context.services.config.getTargetDir();
    const contextFileName = getCurrentGeminiMdFilename();
    const contextFilePath = path.join(targetDir, contextFileName);

    try {
      if (fs.existsSync(contextFilePath)) {
        try {
          const existing = fs.readFileSync(contextFilePath, 'utf8');
          if (existing.trim()) {
            if (!context.overwriteConfirmed) {
              return {
                type: 'confirm_action',
                prompt: React.createElement(
                  Text,
                  null,
                  `A ${contextFileName} file already exists in this directory. Do you want to regenerate it?`,
                ),
                originalInvocation: {
                  raw: context.invocation?.raw || '/init',
                },
              };
            }
          }
        } catch {
          // If we fail to read, conservatively proceed to (re)create the file
        }
      }

      try {
        fs.writeFileSync(contextFilePath, '', 'utf8');
        context.ui.addItem(
          {
            type: 'info',
            text: `Empty ${contextFileName} created. Now analyzing the project to populate it.`,
          },
          Date.now(),
        );
      } catch (err) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to create ${contextFileName}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unexpected error preparing ${contextFileName}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      type: 'submit_prompt',
      content: `
Analyze this codebase and create a ${contextFileName} file, which will be given to future instances of this AI assistant to operate in this repository.

**Analysis Process:**

1. **Initial Exploration:**
   - List files and directories to get a high-level overview
   - Read README if it exists

2. **Iterative Deep Dive (up to 10 files):**
   - Based on findings, select and read the most important files
   - Refine understanding as you learn more

3. **Identify Project Type:**
   - **Code Project:** Look for \`package.json\`, \`requirements.txt\`, \`go.mod\`, \`Cargo.toml\`, etc.
   - **Non-Code Project:** Documentation, research, notes, etc.

**${contextFileName} Content Generation:**

**For a Code Project:**

- **Project Overview:** Clear summary of purpose, main technologies, and architecture
- **Building and Running:** Key commands for build, run, test (infer from \`package.json\` scripts, \`Makefile\`, etc.)
- **Development Conventions:** Coding styles, testing practices, contribution guidelines

**For a Non-Code Project:**

- **Directory Overview:** Purpose and contents
- **Key Files:** Most important files and their contents
- **Usage:** How contents are intended to be used

**Important Guidelines:**

- Only include what this AI would get wrong without it
- Do not repeat obvious information from manifest files
- Do not make up sections like "Common Development Tasks" or "Tips"
- Include only information expressly found in files you read
- Keep it concise — every line must pass: "Would removing this cause mistakes?"

**Final Output:**

Write the complete content to \`${contextFileName}\`. The output must be well-formatted Markdown.
`,
    };
  },
};