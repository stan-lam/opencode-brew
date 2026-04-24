import type { ModelSettings } from '../types/ModelSettings';
import { DEFAULT_MODEL_SETTINGS, MODEL_SETTINGS_CONSTRAINTS } from '../types/ModelSettings';

export interface ValidationResult {
  errors: { field: string; message: string; value?: unknown }[];
  warnings: { field: string; message: string }[];
}

/**
 * Resolves model settings from multiple sources with priority.
 * Later sources override earlier ones (deep merge).
 *
 * Priority:
 * 1. Default settings
 * 2. Global/Launcher settings
 * 3. Action-level settings
 * 4. Task-level settings
 *
 * @param sources - Settings in priority order (lowest first)
 * @returns Merged ModelSettings
 */
export function resolveModelSettings(
  ...sources: (ModelSettings | undefined | null)[]
): ModelSettings {
  const result: ModelSettings = { ...DEFAULT_MODEL_SETTINGS };

  for (const source of sources) {
    if (!source) continue;

    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }

  return result;
}

/**
 * Validates model settings against constraints.
 */
export function validateModelSettings(settings: ModelSettings): ValidationResult {
  const errors: { field: string; message: string; value?: unknown }[] = [];
  const warnings: { field: string; message: string }[] = [];

  // Validate temperature
  if (settings.temperature !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.temperature;
    if (settings.temperature < min || settings.temperature > max) {
      errors.push({
        field: 'temperature',
        message: `Temperature must be between ${min} and ${max}`,
        value: settings.temperature,
      });
    }
  }

  // Validate topP
  if (settings.topP !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.topP;
    if (settings.topP < min || settings.topP > max) {
      errors.push({
        field: 'topP',
        message: `topP must be between ${min} and ${max}`,
        value: settings.topP,
      });
    }
  }

  // Validate maxTokens
  if (settings.maxTokens !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.maxTokens;
    if (settings.maxTokens < min || settings.maxTokens > max) {
      errors.push({
        field: 'maxTokens',
        message: `maxTokens must be between ${min} and ${max}`,
        value: settings.maxTokens,
      });
    }
  }

  // Validate frequencyPenalty
  if (settings.frequencyPenalty !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.frequencyPenalty;
    if (settings.frequencyPenalty < min || settings.frequencyPenalty > max) {
      errors.push({
        field: 'frequencyPenalty',
        message: `frequencyPenalty must be between ${min} and ${max}`,
        value: settings.frequencyPenalty,
      });
    }
  }

  // Validate presencePenalty
  if (settings.presencePenalty !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.presencePenalty;
    if (settings.presencePenalty < min || settings.presencePenalty > max) {
      errors.push({
        field: 'presencePenalty',
        message: `presencePenalty must be between ${min} and ${max}`,
        value: settings.presencePenalty,
      });
    }
  }

  // Warn if temperature and topP are set
  if (settings.temperature !== undefined && settings.topP !== undefined) {
    warnings.push({
      field: 'temperature/topP',
      message: 'Both temperature and topP are set. Most providers use only one.',
    });
  }

  return {
    error: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Creates a safe copy of settings with sensitive data redacted (for logging).
 */
export function redactModelSettings(settings: ModelSettings): ModelSettings {
  const redacted = { ...settings };
  if (redacted.openaiKey) {
    redacted.openaiKey = '***REDACTED***';
  }
  if (redacted.anthropicKey) {
    redacted.anthropicKey = '***REDACTED***';
  }
  if (redacted.customApiKey) {
    redacted.customApiKey = '***REDACTED***';
  }
  return redacted;
}

/**
 * Checks if settings have any custom (non-default) values.
 */
export function hasCustomSettings(settings: ModelSettings | null): boolean {
  if (!settings) return false;

  const keys = Object.keys(DEFAULT_MODEL_SETTINGS) as (keyof ModelSettings)[];
  for (const key of keys) {
    const value = settings[key];
    const defaultValue = DEFAULT_MODEL_SETTINGS[key];
    if (value !== undefined && value !== null && value !== defaultValue) {
      return true;
    }
  }

  return false;
}
