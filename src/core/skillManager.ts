/**
 * Skills 技能管理器
 * 三阶段渐进式加载：Discovery → Instruction → Resource
 *
 * - Discovery: 启动时扫描 ~/.ani/skills/，只提取 YAML frontmatter (name+description)
 * - Instruction: LLM 通过 loadSkill 工具按需加载完整 SKILL.md
 * - Resource: 技能附带文件通过 readFile/executeCommand 访问
 *
 * 首次运行时，自动将项目内置的 ./skills/ 目录下的 skill 复制到 ~/.ani/skills/
 * （只复制不存在的，不覆盖用户已有的修改）
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_DIR = path.join(os.homedir(), '.ani', 'skills');
const BUNDLED_SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

export interface SkillMeta {
  name: string;
  description: string;
  dirName: string;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (m) {
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[m[1]] = value;
    }
  }
  return { name: result['name'], description: result['description'] };
}

export class SkillManager {
  private skills: Map<string, SkillMeta> = new Map();

  /**
   * 将项目内置 ./skills/ 中的 skill 复制到 ~/.ani/skills/（幂等，不覆盖已有）
   */
  ensureBundledSkills(): void {
    if (!existsSync(BUNDLED_SKILLS_DIR)) return;
    mkdirSync(SKILLS_DIR, { recursive: true });
    try {
      for (const name of readdirSync(BUNDLED_SKILLS_DIR)) {
        const src = path.join(BUNDLED_SKILLS_DIR, name, 'SKILL.md');
        const destDir = path.join(SKILLS_DIR, name);
        const dest = path.join(destDir, 'SKILL.md');
        if (existsSync(src) && !existsSync(dest)) {
          mkdirSync(destDir, { recursive: true });
          copyFileSync(src, dest);
        }
      }
    } catch {
      // 静默失败，不影响正常启动
    }
  }

  /**
   * Discovery 阶段：扫描 ~/.ani/skills/，只加载 frontmatter
   */
  async discover(): Promise<SkillMeta[]> {
    this.ensureBundledSkills();
    mkdirSync(SKILLS_DIR, { recursive: true });
    this.skills.clear();

    let entries: string[];
    try {
      entries = await fs.readdir(SKILLS_DIR);
    } catch {
      return [];
    }

    for (const dirName of entries) {
      if (dirName.startsWith('.')) continue;
      const skillMdPath = path.join(SKILLS_DIR, dirName, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const fm = parseFrontmatter(content);
        this.skills.set(dirName, {
          name: fm.name || dirName,
          description: fm.description || '',
          dirName,
        });
      } catch {
        // 跳过无效目录
      }
    }

    return Array.from(this.skills.values());
  }

  /**
   * Instruction 阶段：加载完整 SKILL.md 内容
   */
  async loadSkill(skillName: string): Promise<string | null> {
    let dirName = skillName;
    if (!this.skills.has(dirName)) {
      const found = Array.from(this.skills.values()).find(
        s => s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (found) dirName = found.dirName;
      else return null;
    }

    try {
      return await fs.readFile(path.join(SKILLS_DIR, dirName, 'SKILL.md'), 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 生成技能摘要，注入系统提示词
   */
  buildSkillsSummary(): string {
    if (this.skills.size === 0) return '';

    const lines = [
      '## Available Skills',
      '',
      "When a user request matches a skill's domain, use the `loadSkill` tool to load the full instructions before proceeding.",
      '',
    ];
    for (const meta of this.skills.values()) {
      lines.push(`- **${meta.name}**: ${meta.description}`);
    }
    return lines.join('\n');
  }

  getSkills(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  getSkillsDir(): string {
    return SKILLS_DIR;
  }
}

export const skillManager = new SkillManager();
