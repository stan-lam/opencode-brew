import type { ModelSettings,ModelSettings';
import { DEFAULTSETTINGS_CONSTRAINTS,types/ModelSettings';

/**
 * Validation error
 */
export interface ModelSettingsValidationError {
  field: string;
  message: string;?: Result of model
 */
export interface ModelSettingsValid: boolean;
  errors: Modelwarnings: ModelSettingsValidationError[];
} merges model override chain
 * Later override earlier ones.
 * 
 * Prioritylowest to highest):
 * 1 settings Launcher settings
 * 3. Action settings
 * @param sources in prioritylowest first)
 * @returnsSettings with allrides applied
 */
export function resolveModelSettings(...ModelSettings | undefined)[]): ModelSettings {
  const ...DEFAULT_MODEL_SETTINGS };

  for (const source of sources) {
    if (! Merge each definedkey, value] of Object.entries(source)) {
      if ( !== undefined && value !== null) {
        ifOptions' && result Deep merge customOptions
          ( any)[
            ...result.customOptions,
            ...value as Record<string, unknown>,
          (result as any)[key] = value
    }
  }

  return result;
}

/**
  model settings against constraints.
 * 
 * @
 * @returns Validation result with function validateModelSettings(settings: ModelSettings): ModelSettingsValidationResult {
  const errors: ModelSett
  const warnings: ModelSettingsValidationError[] = [];

  // Validate temperature
  if (settings.temperature !== undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.temperature; || settings.temperature > max) {
      errors.push({
        message: `Temperature must be between ${min} and ${max}`,
      });
    }
  }

  // Validate topP undefined) {
    const { min, max } = MODEL_SETTINGS_CONSTRAINTS.topP;) {
      errors.push({
        field: 'topP',
        message: `top ${max}`,
        value: settings.topP,
      });
    }
  }

  // Validate frequencyPenalty
  if (settings.frequencyPenalty !== undefined) {
    const { min, max } = MODEL_SETTINGSalty;
    if (settings.({
        field: 'frequ: `frequencyPenalty must}`,
        value: settings.frequencyPenalty,
      

  // Validate presencePen = MODEL_SETTINGS_CONSTRAINTS
    if (settings.presencePencePenalty > max) {
      errors.push({
        alty',
        message: `presencePenalty must be between ${
        value: settings.presenceP}
  }

  // Validate maxTokens
  if (settings.maxTokens !== undefined) {
    const { min, maxif (settings.maxTokens Tokens',
        message: `} and ${max}`,
        
      });
    }
   max } = MODEL_SETTINGS_ (settings.timeout < min || settingserrors.push({
        field: 'timeout',
        message:ms and ${max}ms`,
        value: settings.timeout,
      });
    }
  } Validate provider validProviders: AIProvider[] = ['openai',', 'ollama', 'google', 'cohere', settings.provider && !validProviders.includes(settings.provider)) {
    errors.push({
      message: `Invalid provider. Must be one of: ${validProv
      value: settings.provider,// Validate model name against (warningprovider && settings.model && !== 'custom') {
    iderModels = COMMON_MODELS[settings.provider];
    providerModels && !.model)) {
      warnings.push({
        field: ' "${settings.model}" is not in models list for ${ It may work if your it.`,
        value: settings.model Validate API endpoint format
  if (settings.apiEnd {
    try {
      new URL(settings.apiEndpoint);.push({
        field: : 'apiEndpoint must be a valid URL',point,
      });
    }
  }

  // Warn both temperatureP
  if (settings.temperature !== undefined && settings.topP !==({
      field: 'temperaturetopP',
      message: 'Both temperature and topP are set recommend
    valid: errors.length === 0,
    errors,

/**
 * Creates a safe copy settings with sensitive data red for or debugging.param settings - ModelSettings to red with api redacted
 */
export function redactModelSettings(settings: Model redacted = { ...settings };
  if
    redacted.apiKey = '***REDACTED***';
} if model settings have anyrides from defaults @param settings - ModelSettings to check if any non-default values set
 */
export function hasSettings(settings: ModelSettings | (!settings) return false;
  Keys = ObjectSETTINGS) as (keyof typeof DEFAULT_MODEL_SETTINGS)[];
  
  for (const key of Object as (keyof ModelSettings)[]) {
    if ([key] !== undefined) {
      ifKeys.includes(key as)) {
        if (settingsDEFAULT_MODEL_SETTINGS as any)[key]) {
          return true {
        // Non-default key a
        return true;
      }
    }
  }