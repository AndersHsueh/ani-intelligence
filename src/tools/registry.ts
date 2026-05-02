import type { AniTool, OpenAIFunction } from '../types/tool.js';

export class ToolRegistry {
  private tools: Map<string, AniTool> = new Map();
  private aliasMap: Map<string, AniTool> = new Map();

  register(tool: AniTool): void {
    this.tools.set(tool.name, tool);
    if (tool.aliases?.length) {
      for (const alias of tool.aliases) {
        if (this.tools.has(alias) || this.aliasMap.has(alias)) {
          throw new Error(`Tool alias conflict: ${alias}`);
        }
        this.aliasMap.set(alias, tool);
      }
    }
  }

  registerAll(tools: AniTool[]): void {
    tools.forEach(t => this.register(t));
  }

  get(name: string): AniTool | undefined {
    return this.tools.get(name) ?? this.aliasMap.get(name);
  }

  getAll(): AniTool[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.aliasMap.has(name);
  }

  toOpenAIFunctions(): OpenAIFunction[] {
    const canonical = this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
    const aliases = Array.from(this.aliasMap.entries()).map(([alias, tool]) => ({
      name: alias,
      description: tool.description,
      parameters: tool.parameters
    }));
    return [...canonical, ...aliases];
  }

  clear(): void {
    this.tools.clear();
    this.aliasMap.clear();
  }
}

export const toolRegistry = new ToolRegistry();
