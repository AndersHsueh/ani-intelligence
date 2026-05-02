import { BaseProvider, type ProviderConfig } from './base.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';

export type ProviderConstructor = new (config: ProviderConfig, systemPrompt: string) => BaseProvider;

class ProviderRegistry {
  private providers: Map<string, ProviderConstructor> = new Map();

  register(name: string, providerClass: ProviderConstructor): void {
    this.providers.set(name, providerClass);
  }

  registerAll(providers: Record<string, ProviderConstructor>): void {
    for (const [name, cls] of Object.entries(providers)) {
      this.register(name, cls);
    }
  }

  create(providerType: string, config: ProviderConfig, systemPrompt: string): BaseProvider {
    const ProviderClass = this.providers.get(providerType);
    if (!ProviderClass) {
      throw new Error(`Unsupported provider: ${providerType}. Available: ${this.list().join(', ')}`);
    }
    return new ProviderClass(config, systemPrompt);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const providerRegistry = new ProviderRegistry();

providerRegistry.registerAll({
  'lmstudio': OpenAICompatibleProvider,
  'ollama': OpenAICompatibleProvider,
  'openai': OpenAICompatibleProvider,
  'azure': OpenAICompatibleProvider,
  'custom': OpenAICompatibleProvider,
  'xai': OpenAICompatibleProvider,
  'grok': OpenAICompatibleProvider,
  'anthropic': AnthropicProvider,
  'claude': AnthropicProvider,
});

export class ProviderFactory {
  static create(providerType: string, config: ProviderConfig, systemPrompt: string): BaseProvider {
    return providerRegistry.create(providerType, config, systemPrompt);
  }
}

export { BaseProvider } from './base.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
export { AnthropicProvider } from './anthropic.js';
