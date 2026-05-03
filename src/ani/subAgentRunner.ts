/**
 * SubAgentRunner — 封装 claude-code / codebuddy / trae-cli 子进程调用
 *
 * 基于 src/utils/spawnWrapper.ts（即 spawn）实现。
 * 支持降级逻辑：default 工具失败后依次尝试 fallback。
 */

import { spawn } from 'node:child_process';
import path from 'path';
import os from 'os';
import type { AniSettings, SubAgentTool } from './settings.js';
import type { TaskError } from './taskManager.js';

// ── 类型定义 ──

export interface RunSubAgentParams {
  tool: SubAgentTool;
  prompt: string;
  workDir: string;
  sessionId?: string;
  timeoutMs?: number;          // 默认 5 分钟 (300000)
  settings?: AniSettings;
}

export interface SubAgentResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// ── 路径展开 ──

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// ── 命令行拼装 ──

function buildCommand(params: RunSubAgentParams): { command: string; args: string[] } {
  const toolSettings = params.settings?.subagent;

  switch (params.tool) {
    case 'claude-code': {
      const args = ['--print', '--output-format', 'text', '-y'];
      if (toolSettings?.['claude-code']?.settings) {
        args.push('--settings', expandHome(toolSettings['claude-code'].settings!));
      }
      if (toolSettings?.['claude-code']?.extraArgs) {
        args.push(...toolSettings['claude-code'].extraArgs!);
      }
      if (params.sessionId) {
        args.push('--session-id', params.sessionId);
      }
      args.push(params.prompt);
      return { command: 'claude', args };
    }
    case 'codebuddy': {
      const args = ['-p', '--output-format', 'text', '-y'];
      if (toolSettings?.codebuddy?.model) {
        args.push('--model', toolSettings.codebuddy.model);
      }
      if (toolSettings?.codebuddy?.extraArgs) {
        args.push(...toolSettings.codebuddy.extraArgs!);
      }
      if (params.sessionId) {
        args.push('--session-id', params.sessionId);
      }
      args.push(params.prompt);
      return { command: 'codebuddy', args };
    }
    case 'trae-cli': {
      const args = ['-p', '-y'];
      if (toolSettings?.['trae-cli']?.extraArgs) {
        args.push(...toolSettings['trae-cli'].extraArgs!);
      }
      if (params.sessionId) {
        args.push('--session-id', params.sessionId);
      }
      args.push(params.prompt);
      return { command: 'trae-cli', args };
    }
  }
}

// ── 错误分类 ──

const NON_RETRYABLE_PATTERNS = [
  /permission denied/i,
  /password required/i,
  /auth(entication)? failed/i,
  /access denied/i,
  /file not found/i,
  /command not found/i,
  /no such file/i,
];

export function classifyError(result: SubAgentResult): TaskError['type'] {
  if (NON_RETRYABLE_PATTERNS.some(p => p.test(result.stderr))) {
    return 'non-retryable';
  }
  if (result.exitCode === 124) return 'timeout';
  return 'retryable-logic';
}

// ── 核心执行函数 ──

export async function runSubAgent(params: RunSubAgentParams): Promise<SubAgentResult> {
  const { command, args } = buildCommand(params);
  const startTime = Date.now();
  const timeoutMs = params.timeoutMs ?? 300000;

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: params.workDir,
      env: process.env,  // 继承父进程环境变量（含 HTTP_PROXY）
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // 超时处理
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      // 给进程 5 秒优雅退出
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already exited */ }
      }, 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
        durationMs: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: 1,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

// ── 带降级的执行 ──

export async function runSubAgentWithFallback(
  params: Omit<RunSubAgentParams, 'tool'>,
  settings: AniSettings,
): Promise<SubAgentResult> {
  const tools = [settings.subagent.default, ...settings.subagent.fallback];
  let lastResult: SubAgentResult | null = null;

  for (const tool of tools) {
    const result = await runSubAgent({ ...params, tool, settings });
    if (result.success) return result;

    lastResult = result;
    const errorType = classifyError(result);
    if (errorType === 'non-retryable') break; // 不可重试，直接停止降级
    // retryable-logic 或 timeout，继续尝试下一个工具
  }

  return lastResult!;
}
