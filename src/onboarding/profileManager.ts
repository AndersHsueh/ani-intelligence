/**
 * Onboarding — 用户档案文件读写
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const ANI_DIR = path.join(os.homedir(), '.ani');

/**
 * 简单 sanitize：去掉空格和特殊字符，只保留字母数字和中划线下划线
 */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '').replace(/\s+/g, '-');
}

/**
 * 获取当前系统用户名
 */
export function getSystemUsername(): string {
  return process.env.USER || os.userInfo().username || 'default';
}

/**
 * 获取用户目录路径
 */
export function getUserDir(username: string): string {
  return path.join(ANI_DIR, 'users', sanitize(username));
}

/**
 * 检测当前用户的 profile 是否存在
 */
export function hasUserProfile(): boolean {
  const userDir = getUserDir(getSystemUsername());
  const profilePath = path.join(userDir, 'profile.md');
  return fs.existsSync(profilePath);
}

/**
 * 写入 profile.md
 */
export function writeProfile(username: string, content: string): void {
  const userDir = getUserDir(username);
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'profile.md'), content, 'utf-8');
}

/**
 * 写入 jd/{roleSlug}/flow.md，同时创建空的 skills.md
 */
export function writeJobFlow(username: string, roleSlug: string, content: string): void {
  const jdDir = path.join(getUserDir(username), 'jd', sanitize(roleSlug));
  fs.mkdirSync(jdDir, { recursive: true });
  fs.writeFileSync(path.join(jdDir, 'flow.md'), content, 'utf-8');
  fs.writeFileSync(path.join(jdDir, 'skills.md'), '# 技能\n\n（待补充）\n', 'utf-8');
}

/**
 * 写入项目文件
 */
export function writeProjectFiles(
  username: string,
  projectSlug: string,
  files: {
    info: string;
    status: string;
    flow: string;
    nextStep: string;
  },
): void {
  const projDir = path.join(getUserDir(username), 'projects', sanitize(projectSlug));
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'project-info.md'), files.info, 'utf-8');
  fs.writeFileSync(path.join(projDir, 'project-status.md'), files.status, 'utf-8');
  fs.writeFileSync(path.join(projDir, 'project-flow.md'), files.flow, 'utf-8');
  fs.writeFileSync(path.join(projDir, 'next-step.md'), files.nextStep, 'utf-8');
}
