export interface ModelSettings {
  provider: 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  ollamaUrl?: string;
  openaiKey?: string;
  anthropicKey?: string;
  customBaseUrl?: string;
  customApiKey?: string;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: 'ollama',
  model: 'llama3',
  temperature: 0.7,
  maxTokens: 4096,
};

export const MODEL_SETTINGS_CONSTRAINTS = {
  temperature: { min: 0, max: 1 },
  topP: { min: 0, max: 1 },
  maxTokens: { min: 1, max: 128000 },
  frequencyPenalty: { min: -2, max: 2 },
  presencePenalty: { min: -2, max: 2 },
};
