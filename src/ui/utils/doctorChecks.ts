/**
 * /doctor 环境自检（W2，融合自 qwen-code doctorChecks.ts 裁剪版）
 *
 * 四项检查：Node 版本、Git、Ripgrep、MCP 配置。
 * 复用 alice 已有能力：
 * - systemInfo.getNpmVersion（探测外部命令可执行性的同款 execSync 通道）
 * - shim 的 canUseRipgrep / getMCPServerStatus
 */

import process from 'node:process';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { DoctorCheckResult } from '../types.js';
import { canUseRipgrep, getMCPServerStatus, MCPServerStatus } from '../../shim/qwen-code-core.js';

const MIN_NODE_MAJOR = 20;

function checkNodeVersion(): DoctorCheckResult {
  const version = process.version;
  const major = parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return {
      category: 'System',
      name: 'Node.js version',
      status: 'fail',
      message: version,
      detail: `Node.js v${MIN_NODE_MAJOR}+ is required. Current: ${version}`,
    };
  }
  return {
    category: 'System',
    name: 'Node.js version',
    status: 'pass',
    message: version,
  };
}

function checkPlatform(): DoctorCheckResult {
  return {
    category: 'System',
    name: 'Platform',
    status: 'pass',
    message: `${process.platform}/${process.arch} (${os.release()})`,
  };
}

/** 直接探测 git 二进制，返回版本字符串；不可用返回 'unknown'。 */
async function getGitVersion(): Promise<string> {
  try {
    return execSync('git --version', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function checkGit(): Promise<DoctorCheckResult> {
  try {
    const version = await getGitVersion();
    if (version === 'unknown') {
      return {
        category: 'Git',
        name: 'Git',
        status: 'warn',
        message: 'not available',
        detail: 'Git features will be limited.',
      };
    }
    return {
      category: 'Git',
      name: 'Git',
      status: 'pass',
      message: version,
    };
  } catch (error: unknown) {
    return {
      category: 'Git',
      name: 'Git',
      status: 'warn',
      message: 'check failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRipgrep(): Promise<DoctorCheckResult> {
  try {
    const result = await canUseRipgrep();
    if (result) {
      return {
        category: 'Tools',
        name: 'Ripgrep',
        status: 'pass',
        message: 'available',
      };
    }
    return {
      category: 'Tools',
      name: 'Ripgrep',
      status: 'warn',
      message: 'not available',
      detail: 'Install ripgrep for faster file search: https://github.com/BurntSushi/ripgrep',
    };
  } catch {
    return {
      category: 'Tools',
      name: 'Ripgrep',
      status: 'warn',
      message: 'check failed',
    };
  }
}

/**
 * MCP 检查：alice 的 MCP 配置经 daemon 注入（无直接配置对象可读），
 * 探测 shim 注册状态：任一 server CONNECTED 即 pass，无注册时提示未配置。
 */
function checkMcpServers(): DoctorCheckResult {
  // alice 目前通过 daemon 管理全部 MCP 连接，CLI 侧仅能看到状态枚举。
  // 无已注册 server 名单可枚举，按 shim 状态给出诊断提示。
  const status = getMCPServerStatus();
  if (status === MCPServerStatus.CONNECTED) {
    return {
      category: 'MCP Servers',
      name: 'MCP servers',
      status: 'pass',
      message: 'connected',
    };
  }
  if (status === MCPServerStatus.CONNECTING) {
    return {
      category: 'MCP Servers',
      name: 'MCP servers',
      status: 'warn',
      message: 'connecting',
      detail: 'Server is still starting up.',
    };
  }
  return {
    category: 'MCP Servers',
    name: 'MCP servers',
    status: 'pass',
    message: 'none configured',
  };
}

/**
 * Run all doctor diagnostic checks (node / git / ripgrep / MCP)。
 */
export async function runDoctorChecks(): Promise<DoctorCheckResult[]> {
  const [gitResult, ripgrepResult] = await Promise.all([checkGit(), checkRipgrep()]);

  return [
    // System
    checkNodeVersion(),
    checkPlatform(),
    // MCP
    checkMcpServers(),
    // Tools
    ripgrepResult,
    // Git
    gitResult,
  ];
}
