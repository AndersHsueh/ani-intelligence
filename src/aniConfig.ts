import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import type { Config, ModelConfig } from '../types/index.js';

const DEFAULT_CONFIG: Config = {
  default_model: 'ollama',
  models: [
    {
      name: 'ollama',
      provider: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3',
      apiKey: 'ollama',
      temperature: 0.7,
      maxTokens: 8192,
      last_update_datetime: null,
      speed: null,
    },
  ],
  workspace: process.cwd(),
  dangerous_cmd: true,
  maxIterations: 15,
};

export class ConfigManager {
  private configDir: string;
  private settingsPath: string;
  private config: Config | null = null;

  constructor() {
    this.configDir = path.join(os.homedir(), '.ani');
    this.settingsPath = path.join(this.configDir, 'settings.jsonc');
  }

  init(customConfigPath?: string): void {
    if (customConfigPath) {
      this.settingsPath = customConfigPath;
    } else {
      mkdirSync(this.configDir, { recursive: true });
      if (!existsSync(this.settingsPath)) {
        writeFileSync(this.settingsPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      }
    }
    this.load();
  }

  load(): Config {
    try {
      const raw = readFileSync(this.settingsPath, 'utf-8');
      this.config = JSON.parse(raw) as Config;
      return this.config;
    } catch {
      this.config = DEFAULT_CONFIG;
      return this.config;
    }
  }

  get(): Config {
    return this.config || DEFAULT_CONFIG;
  }

  getModel(modelName: string): ModelConfig | undefined {
    return this.config?.models.find(m => m.name === modelName);
  }

  getDefaultModel(): ModelConfig | undefined {
    const config = this.get();
    const byName = this.getModel(config.default_model);
    if (byName) return byName;
    if (config.models?.length) return config.models[0];
    return undefined;
  }

  getConfigDir(): string {
    return this.configDir;
  }
}

export const configManager = new ConfigManager();
