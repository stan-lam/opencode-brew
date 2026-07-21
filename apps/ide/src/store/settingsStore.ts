import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Settings {
  // General
  autoSave: boolean;
  autoSaveDelay: number;
  // Appearance
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  // Layout
  aiPanelMaxPercent: number;
  aiPanelMaxPercentSolo: number;
  editorPanelMinPercent: number;
  // Editor
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  // Keybindings
  keymap: 'default' | 'vim' | 'intellij' | 'vscode';
  // AI
  aiEnabled: boolean;
  inlineCompletions: boolean;
  aiAutoApplyFileOps: boolean;
  // Git
  autoFetch: boolean;
  confirmSync: boolean;
  githubToken: string;
  githubApiBase: string;
  // Plugins
  autoUpdatePlugins: boolean;
  // Security / Snyk
  snykEnabled: boolean;
  snykCliPath: string;
  snykAuthToken: string;
}

interface SettingsState extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  resetFontSize: () => void;
}

const defaultSettings: Settings = {
  autoSave: true,
  autoSaveDelay: 1000,
  theme: 'dark',
  fontSize: 14,
  aiPanelMaxPercent: 70,
  aiPanelMaxPercentSolo: 85,
  editorPanelMinPercent: 20,
  tabSize: 2,
  wordWrap: true,
  minimap: true,
  lineNumbers: true,
  keymap: 'default',
  aiEnabled: true,
  inlineCompletions: true,
  aiAutoApplyFileOps: false,
  autoFetch: true,
  confirmSync: true,
  githubToken: '',
  githubApiBase: '',
  autoUpdatePlugins: true,
  snykEnabled: false,
  snykCliPath: 'snyk',
  snykAuthToken: '',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      updateSetting: (key, value) => {
        set({ [key]: value });
      },

      resetSettings: () => {
        set(defaultSettings);
      },

      increaseFontSize: () => {
        const currentSize = get().fontSize;
        const newSize = Math.min(currentSize + 1, 32); // Max font size 32
        set({ fontSize: newSize });
      },

      decreaseFontSize: () => {
        const currentSize = get().fontSize;
        const newSize = Math.max(currentSize - 1, 8); // Min font size 8
        set({ fontSize: newSize });
      },

      resetFontSize: () => {
        set({ fontSize: defaultSettings.fontSize });
      },
    }),
    {
      name: 'opencodebrew-settings',
      version: 1,
    }
  )
);
