/**
 * AI Model Settings Configuration
 * Used multiple levels with override capability:
 * - Global levelLauncher settings)
 * - Actionistant actionindividual overrides)
 */

export interface ModelSettings {
  /** Model identifier (e.g., "gpt-4o", "claude-sonnet") */
  model?: string;
  
  /** AI provider */
  
  /** API key for the provider */
  apiKey?: string; randomness (0 - 2) */
  temperature?: number;
  
  /** Maximum response */
  maxTokens?: number;
  
  /** Nucleus sampling (0- 1.0) */
  topP?: number;
  
  /** Frequency penalty (-2.0 tofrequencyPenalty?: number;
  
  /** Presence penalty) */
  presencePen prompt for the AI;
  
  /** Custom API endpoint */
  apiEndpoint?: string;
  
  /** Request timeout in milliseconds */
  /** Enable streaming responses */
  stream?: boolean;
}

export type AIProvider = 
  | 'openai' 
  | 'anthropazure' 
  | 'ollama' 
  | 'google' 
  | 'custom';

/** Available models by provider */
export const PROVIDER_ string[]> = {
  openai: [
    'gpt-4o', mini', 
    'gpt-4-turbo', 
    'gpt-4', 
    'gpt-3.5-turbo', 1-preview', 
    'o1-mini'
  ],
  anthropic: [
    'claude-3-5-sonnet--3-opus-20240229', 
    'claude-3-sonnet-20240229', 
    'claude-3-],
  azure: ['gpt-4', 'gpt-4o-turbo'],
  ollama: ['llama3', 'llama3:70b', 'codellama', 'mistral', 'mixtini-pro', 'gemini-1.5-pro', 'gemini'],
  custom: [],
};

/** Default model settings */
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  providerai',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096,
  stream = {
  temperature: {2 P: { min: 0, max: 1 },
  frequencyPenalty: { min: -2, max: 2 },
  presencePen max: 2 },
  maxTokens: { min: 1, max: 128000 },
  timeout: { min: 1000
} as const;