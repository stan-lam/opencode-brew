import React, { useState, useEffect, useCallback, ReactNode } from 'react';
import type { ModelSettings } from '../types/ModelSettings';
import { DEFAULT_MODEL_SETTINGS } from '../types/ModelSettings';
import { resolveModelSettings } from '../utils/modelSettingsResolver';

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

export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const [globalSettings, setGlobalSettings] = useState<ModelSettings>(() => {
    // Try to load from tauri store if available
    try {
      const stored = localStorage.getItem('global_model_settings');
      if (stored) {
        return { ...DEFAULT_MODEL_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_MODEL_SETTINGS;
  });

  const updateGlobalSettings = useCallback((updates: Partial<ModelSettings>) => {
    setGlobalSettings((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('global_model_settings', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

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
