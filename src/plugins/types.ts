// Plugin API Types

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  activationEvents?: string[];
  contributes?: PluginContributions;
}

export interface PluginContributions {
  commands?: PluginCommand[];
  menus?: PluginMenu[];
  keybindings?: PluginKeybinding[];
  configuration?: PluginConfiguration[];
  languages?: PluginLanguage[];
  themes?: PluginTheme[];
}

export interface PluginCommand {
  command: string;
  title: string;
  category?: string;
  icon?: string;
}

export interface PluginMenu {
  command: string;
  group?: string;
  when?: string;
}

export interface PluginKeybinding {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

export interface PluginConfiguration {
  title: string;
  properties: Record<string, {
    type: string;
    default?: any;
    description?: string;
  }>;
}

export interface PluginLanguage {
  id: string;
  extensions: string[];
  aliases?: string[];
}

export interface PluginTheme {
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black';
  path: string;
}

// Plugin API exposed to plugins
export interface PluginAPI {
  // Workspace
  workspace: {
    rootPath: string | null;
    openFile: (path: string) => Promise<void>;
    saveFile: (path: string) => Promise<void>;
    getOpenFiles: () => string[];
    onDidOpenFile: (callback: (path: string) => void) => () => void;
    onDidSaveFile: (callback: (path: string) => void) => () => void;
  };
  
  // Editor
  editor: {
    getActiveFile: () => { path: string; content: string } | null;
    setSelection: (start: Position, end: Position) => void;
    insertText: (text: string) => void;
    replaceSelection: (text: string) => void;
    showMessage: (message: string, type?: 'info' | 'warning' | 'error') => void;
  };
  
  // Commands
  commands: {
    register: (id: string, callback: (...args: any[]) => any) => () => void;
    execute: (id: string, ...args: any[]) => Promise<any>;
  };
  
  // UI
  ui: {
    showQuickPick: (items: QuickPickItem[], options?: QuickPickOptions) => Promise<QuickPickItem | undefined>;
    showInputBox: (options?: InputBoxOptions) => Promise<string | undefined>;
    showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void;
    createStatusBarItem: (alignment: 'left' | 'right', priority?: number) => StatusBarItem;
  };
  
  // Storage
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
}

export interface Position {
  line: number;
  column: number;
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  data?: any;
}

export interface QuickPickOptions {
  placeholder?: string;
  canSelectMany?: boolean;
}

export interface InputBoxOptions {
  placeholder?: string;
  value?: string;
  password?: boolean;
  validateInput?: (value: string) => string | undefined;
}

export interface StatusBarItem {
  text: string;
  tooltip?: string;
  command?: string;
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

export interface Plugin {
  id: string;
  manifest: PluginManifest;
  isActive: boolean;
  activate: (api: PluginAPI) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
}

export interface PluginContext {
  subscriptions: (() => void)[];
  workspaceState: Map<string, any>;
  globalState: Map<string, any>;
}
