/**
 * AI Model Settings Configuration
 * Used at multiple levels with override capability:
 * - Global level (Launcher settings)
 * - Action level (Assistant action individual overrides)
 */

export interface ModelSettings {
  /** Model identifier (e.g., "gpt-4o", "claude-sonnet") */
  model?: string;
  
  /** AI provider */
  provider?: AIProvider;
  
  /** API key for the provider */
  apiKey?: string;
  
  /** Temperature - randomness (0 - 2) */
  temperature?: number;
  
  /** Maximum response tokens */
  maxTokens?: number;
  
  /** Nucleus sampling (0 - 1.0) */
  topP?: number;
  
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  
  /** System prompt for the AI */
  systemPrompt?: string;
  
  /** Custom API endpoint */
  apiEndpoint?: string;
  
  /** Request timeout in milliseconds */
  timeout?: number;
  
  /** Enable streaming responses */
  stream?: boolean;
}

export type AIProvider = 
  | 'openai' 
  | 'anthropic' 
  | 'azure' 
  | 'ollama' 
  | 'google' 
  | 'custom';

/** Available models by provider */
export const PROVIDER_MODELS: Record<AIProvider, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini', 
    'gpt-4-turbo', 
    'gpt-4', 
    'gpt-3.5-turbo',
    'o1-preview', 
    'o1-mini'
  ],
  anthropic: [
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229', 
    'claude-3-sonnet-20240229', 
    'claude-3-haiku-20240307',
  ],
  azure: ['gpt-4', 'gpt-4o', 'gpt-4-turbo'],
  ollama: ['llama3', 'llama3:70b', 'codellama', 'mistral', 'mixtral'],
  google: ['gemini-pro', 'gemini-1.5-pro', 'gemini'],
  custom: [],
};

/** Default model settings */
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: 'openai',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
};

/** Constraints for model settings */
export const MODEL_SETTINGS_CONSTRAINTS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  frequencyPenalty: { min: -2, max: 2 },
  presencePenalty: { min: -2, max: 2 },
  maxTokens: { min: 1, max: 128000 },
  timeout: { min: 1000, max: 600000 },
} as const;
