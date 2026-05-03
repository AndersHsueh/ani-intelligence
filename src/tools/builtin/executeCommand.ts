/**
 * 命令执行工具：执行 shell 命令
 */
import { spawn } from 'child_process';
import type { AniTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /del\s+\/[sf]/i,
  /format\s+[a-z]:/i,
  /dd\s+if=/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /:(){:|:&};:/,
  />\s*\/dev\/sd/i,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

export const executeCommandTool: AniTool = {
  name: 'executeCommand',
  label: '执行命令',
  description: '执行 shell 命令并返回输出',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      cwd: { type: 'string', description: '工作目录（默认为当前目录）' },
      timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）' }
    },
    required: ['command']
  },

  async execute(toolCallId, params, signal, context): Promise<ToolResult> {
    const { command, timeout = 30000 } = params;
    const cwd = params.cwd ?? process.cwd();

    try {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['-Command', command] : ['-c', command];

      return new Promise((resolve) => {
        const proc = spawn(shell, shellArgs, {
          cwd, env: process.env, timeout, windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('error', (error: unknown) => {
          resolve({ success: false, error: `Command failed: ${getErrorMessage(error)}` });
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({
              success: true,
              data: { command, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }
            });
          } else {
            resolve({
              success: false,
              error: `Command failed (exit ${code})`,
              data: { command, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }
            });
          }
        });

        signal.addEventListener('abort', () => {
          proc.kill();
          resolve({ success: false, error: 'Command cancelled' });
        });
      });
    } catch (error: unknown) {
      return { success: false, error: `Command error: ${getErrorMessage(error)}` };
    }
  }
};
