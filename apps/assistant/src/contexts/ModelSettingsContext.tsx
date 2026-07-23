import React, { useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import type { ModelSettings } from '../types/ModelSettings';
import { DEFAULT_MODEL_SETTINGS } from '../types/ModelSettings';
import { resolveModelSettings } from '../utils/modelSettingsResolver';

type AISettingsPayload = {
  aiProvider: string;
  model: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  copilotClientId?: string;
  copilotClientSecret?: string;
  copilotAuthHost?: string;
  copilotAuthMode?: string;
  copilotEnterpriseType?: string;
  customBaseUrl: string;
  customApiKey: string;
  temperature: number;
  maxTokens: number;
};

interface ModelSettingsContextValue {
  /** Global model settings (from Launcher) */
  globalSettings: ModelSettings;

  /** Update global settings */
  updateGlobalSettings: (settings: Partial<ModelSettings>) => void;

  /** Resolve settings with override (global -> action -> task) */
  resolveSettings: (
    actionSettings?: Partial<ModelSettings>,
    taskSettings?: Partial<ModelSettings>,
  ) => ModelSettings;
}

const ModelSettingsContext = React.createContext<ModelSettingsContextValue>({
  globalSettings: DEFAULT_MODEL_SETTINGS,
  updateGlobalSettings: () => {},
  resolveSettings: () => DEFAULT_MODEL_SETTINGS,
});

async function getInvoke() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  } catch {
    return null;
  }
}

function mapAiSettingsToModelSettings(ai: AISettingsPayload): ModelSettings {
  return {
    ...DEFAULT_MODEL_SETTINGS,
    provider: (ai.aiProvider as ModelSettings['provider']) || DEFAULT_MODEL_SETTINGS.provider,
    model: ai.model ?? DEFAULT_MODEL_SETTINGS.model,
    temperature: typeof ai.temperature === 'number' ? ai.temperature : DEFAULT_MODEL_SETTINGS.temperature,
    maxTokens: typeof ai.maxTokens === 'number' ? ai.maxTokens : DEFAULT_MODEL_SETTINGS.maxTokens,
    ollamaUrl: ai.ollamaUrl,
    openaiKey: ai.openaiKey,
    anthropicKey: ai.anthropicKey,
    customBaseUrl: ai.customBaseUrl,
    customApiKey: ai.customApiKey,
  };
}

function mergeModelSettingsIntoAiSettings(base: AISettingsPayload, model: ModelSettings): AISettingsPayload {
  return {
    ...base,
    aiProvider: model.provider,
    model: model.model,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    ollamaUrl: model.ollamaUrl ?? base.ollamaUrl,
    openaiKey: model.openaiKey ?? base.openaiKey,
    anthropicKey: model.anthropicKey ?? base.anthropicKey,
    customBaseUrl: model.customBaseUrl ?? base.customBaseUrl,
    customApiKey: model.customApiKey ?? base.customApiKey,
  };
}

export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const storedRaw = (() => {
    try {
      const stored = localStorage.getItem('global_model_settings');
      return stored;
    } catch {
      return null;
    }
  })();

  const hasStoredSettingsRef = useRef(Boolean(storedRaw));
  const backendSettingsRef = useRef<AISettingsPayload | null>(null);
  const latestSettingsRef = useRef<ModelSettings>(DEFAULT_MODEL_SETTINGS);

  const [globalSettings, setGlobalSettings] = useState<ModelSettings>(() => {
    if (!storedRaw) return DEFAULT_MODEL_SETTINGS;
    try {
      return { ...DEFAULT_MODEL_SETTINGS, ...JSON.parse(storedRaw) };
    } catch {
      return DEFAULT_MODEL_SETTINGS;
    }
  });

  useEffect(() => {
    latestSettingsRef.current = globalSettings;
  }, [globalSettings]);

  const persistToBackend = useCallback(async (next: ModelSettings) => {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      const base =
        backendSettingsRef.current ?? (await invoke<AISettingsPayload>('load_ai_settings', {}));
      const merged = mergeModelSettingsIntoAiSettings(base, next);
      backendSettingsRef.current = merged;
      await invoke('save_ai_settings', { settings: merged });
    } catch (e) {
      console.error('[ModelSettingsContext] Failed to persist AI settings:', e);
    }
  }, []);

  const updateGlobalSettings = useCallback((updates: Partial<ModelSettings>) => {
    setGlobalSettings((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('global_model_settings', JSON.stringify(next));
      } catch {
        // ignore
      }
      void persistToBackend(next);
      return next;
    });
  }, [persistToBackend]);

  // On startup, sync settings with the backend (ai-settings.json).
  // If the UI has stored settings already, prefer them and push to backend
  // so agent execution uses the same model/provider immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const invoke = await getInvoke();
      if (!invoke) return;
      try {
        const backend = await invoke<AISettingsPayload>('load_ai_settings', {});
        if (cancelled) return;
        backendSettingsRef.current = backend;

        if (hasStoredSettingsRef.current) {
          await persistToBackend(latestSettingsRef.current);
        } else {
          const mapped = mapAiSettingsToModelSettings(backend);
          setGlobalSettings(mapped);
          try {
            localStorage.setItem('global_model_settings', JSON.stringify(mapped));
          } catch {
            // ignore
          }
        }
      } catch (e) {
        console.error('[ModelSettingsContext] Failed to sync AI settings from backend:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [persistToBackend]);

  const resolveSettings = useCallback(
    (actionSettings?: Partial<ModelSettings>, taskSettings?: Partial<ModelSettings>) => {
      return resolveModelSettings(globalSettings, actionSettings, taskSettings);
    },
    [globalSettings],
  );

  return (
    <ModelSettingsContext.Provider value={{ globalSettings, updateGlobalSettings, resolveSettings }}>
      {children}
    </ModelSettingsContext.Provider>
  );
}

export { ModelSettingsContext };
export default ModelSettingsContext;
