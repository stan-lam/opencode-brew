import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Terminal theme preset definition
export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
}

export interface CustomTerminalTheme extends TerminalThemeColors {
  id: string;
  name: string;
}

// Built-in terminal theme presets
export const TERMINAL_THEME_PRESETS: Record<string, TerminalThemeColors & { name: string }> = {
  'default-dark': {
    name: 'Default Dark',
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#aeafad',
    selectionBackground: '#264f78',
    black: '#1e1e1e',
    red: '#f14c4c',
    green: '#4ec9b0',
    yellow: '#dcdcaa',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#4ec9b0',
    white: '#cccccc',
  },
  'default-light': {
    name: 'Default Light',
    background: '#ffffff',
    foreground: '#1e1e1e',
    cursor: '#1e1e1e',
    selectionBackground: '#add6ff',
    black: '#1e1e1e',
    red: '#cd3131',
    green: '#107c41',
    yellow: '#795e26',
    blue: '#0066bf',
    magenta: '#af00db',
    cyan: '#107c41',
    white: '#cccccc',
  },
  'monokai': {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
  },
  'dracula': {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
  },
  'nord': {
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
  },
  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selectionBackground: '#504945',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
  },
  'one-dark': {
    name: 'One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
  },
};

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
  // Terminal
  terminalThemePreset: string; // 'default-dark', 'monokai', 'custom', etc.
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalCursorStyle: 'block' | 'bar' | 'underline';
  terminalCursorBlink: boolean;
  terminalLineHeight: number;
  terminalScrollback: number;
  // Custom terminal colors (used when preset is 'custom')
  terminalBackground: string;
  terminalForeground: string;
  terminalCursor: string;
  terminalSelectionBackground: string;
  terminalBlack: string;
  terminalRed: string;
  terminalGreen: string;
  terminalYellow: string;
  terminalBlue: string;
  terminalMagenta: string;
  terminalCyan: string;
  terminalWhite: string;
  // Saved custom themes
  customTerminalThemes: CustomTerminalTheme[];
}

interface SettingsState extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  resetFontSize: () => void;
  // Terminal theme helpers
  applyTerminalPreset: (presetId: string) => void;
  saveCustomTerminalTheme: (name: string) => void;
  deleteCustomTerminalTheme: (id: string) => void;
  getActiveTerminalTheme: () => TerminalThemeColors;
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
  // Terminal defaults
  terminalThemePreset: 'default-dark',
  terminalFontSize: 13,
  terminalFontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
  terminalCursorStyle: 'bar',
  terminalCursorBlink: true,
  terminalLineHeight: 1.2,
  terminalScrollback: 10000,
  // Custom terminal colors (defaults from default-dark preset)
  terminalBackground: '#1e1e1e',
  terminalForeground: '#cccccc',
  terminalCursor: '#aeafad',
  terminalSelectionBackground: '#264f78',
  terminalBlack: '#1e1e1e',
  terminalRed: '#f14c4c',
  terminalGreen: '#4ec9b0',
  terminalYellow: '#dcdcaa',
  terminalBlue: '#569cd6',
  terminalMagenta: '#c586c0',
  terminalCyan: '#4ec9b0',
  terminalWhite: '#cccccc',
  // Saved custom themes
  customTerminalThemes: [],
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

      applyTerminalPreset: (presetId: string) => {
        const preset = TERMINAL_THEME_PRESETS[presetId];
        if (preset) {
          set({
            terminalThemePreset: presetId,
            terminalBackground: preset.background,
            terminalForeground: preset.foreground,
            terminalCursor: preset.cursor,
            terminalSelectionBackground: preset.selectionBackground,
            terminalBlack: preset.black,
            terminalRed: preset.red,
            terminalGreen: preset.green,
            terminalYellow: preset.yellow,
            terminalBlue: preset.blue,
            terminalMagenta: preset.magenta,
            terminalCyan: preset.cyan,
            terminalWhite: preset.white,
          });
        } else {
          // Check custom themes
          const customTheme = get().customTerminalThemes.find(t => t.id === presetId);
          if (customTheme) {
            set({
              terminalThemePreset: presetId,
              terminalBackground: customTheme.background,
              terminalForeground: customTheme.foreground,
              terminalCursor: customTheme.cursor,
              terminalSelectionBackground: customTheme.selectionBackground,
              terminalBlack: customTheme.black,
              terminalRed: customTheme.red,
              terminalGreen: customTheme.green,
              terminalYellow: customTheme.yellow,
              terminalBlue: customTheme.blue,
              terminalMagenta: customTheme.magenta,
              terminalCyan: customTheme.cyan,
              terminalWhite: customTheme.white,
            });
          }
        }
      },

      saveCustomTerminalTheme: (name: string) => {
        const state = get();
        const newTheme: CustomTerminalTheme = {
          id: `custom-${Date.now()}`,
          name,
          background: state.terminalBackground,
          foreground: state.terminalForeground,
          cursor: state.terminalCursor,
          selectionBackground: state.terminalSelectionBackground,
          black: state.terminalBlack,
          red: state.terminalRed,
          green: state.terminalGreen,
          yellow: state.terminalYellow,
          blue: state.terminalBlue,
          magenta: state.terminalMagenta,
          cyan: state.terminalCyan,
          white: state.terminalWhite,
        };
        set({
          customTerminalThemes: [...state.customTerminalThemes, newTheme],
          terminalThemePreset: newTheme.id,
        });
      },

      deleteCustomTerminalTheme: (id: string) => {
        const state = get();
        set({
          customTerminalThemes: state.customTerminalThemes.filter(t => t.id !== id),
          // If deleting the active theme, switch to default
          terminalThemePreset: state.terminalThemePreset === id ? 'default-dark' : state.terminalThemePreset,
        });
      },

      getActiveTerminalTheme: () => {
        const state = get();
        return {
          background: state.terminalBackground,
          foreground: state.terminalForeground,
          cursor: state.terminalCursor,
          selectionBackground: state.terminalSelectionBackground,
          black: state.terminalBlack,
          red: state.terminalRed,
          green: state.terminalGreen,
          yellow: state.terminalYellow,
          blue: state.terminalBlue,
          magenta: state.terminalMagenta,
          cyan: state.terminalCyan,
          white: state.terminalWhite,
        };
      },
    }),
    {
      name: 'opencodebrew-settings',
      version: 2,
    }
  )
);
