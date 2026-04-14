// Lazy-loaded Tauri API wrapper to avoid CSP issues during module initialization

let invokeFunc: typeof import('@tauri-apps/api/core').invoke | null = null;
let listenFunc: typeof import('@tauri-apps/api/event').listen | null = null;
let dialogModule: typeof import('@tauri-apps/plugin-dialog') | null = null;

async function getInvoke() {
  if (!invokeFunc) {
    const { invoke } = await import('@tauri-apps/api/core');
    invokeFunc = invoke;
  }
  return invokeFunc;
}

async function getListen() {
  if (!listenFunc) {
    const { listen } = await import('@tauri-apps/api/event');
    listenFunc = listen;
  }
  return listenFunc;
}

async function getDialog() {
  if (!dialogModule) {
    dialogModule = await import('@tauri-apps/plugin-dialog');
  }
  return dialogModule;
}

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_file: boolean;
  size?: number;
  modified?: string;
}

export interface FileInfo {
  is_directory: boolean;
  is_file: boolean;
  size: number;
  modified: string;
  created: string;
}

export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  branch: string | null;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export interface GitCommitInfo {
  id: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  path?: string;
  data?: string; // base64 for images
  mimeType?: string;
  size?: number;
}

export interface ChatMessage {
  role: string;
  content: string;
  attachments?: MessageAttachment[];
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface HistoryEntry {
  id: number;
  file_path: string;
  content_hash: string;
  timestamp: string;
  size: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface TerminalOutput {
  terminal_id: string;
  data: string;
  target_window?: string;
}

// File System operations
export const fs = {
  readDirectory: async (path: string): Promise<FileEntry[]> => {
    const invoke = await getInvoke();
    return invoke('read_directory', { path });
  },
  
  readFile: async (path: string): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('read_file', { path });
  },
  
  writeFile: async (path: string, content: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('write_file', { path, content });
  },
  
  createFile: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('create_file', { path });
  },
  
  createDirectory: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('create_directory', { path });
  },
  
  deletePath: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('delete_path', { path });
  },
  
  renamePath: async (oldPath: string, newPath: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('rename_path', { oldPath, newPath });
  },
  
  getFileInfo: async (path: string): Promise<FileInfo> => {
    const invoke = await getInvoke();
    return invoke('get_file_info', { path });
  },
  
  pathExists: async (path: string): Promise<boolean> => {
    console.log('fs.pathExists: checking path:', path);
    const invoke = await getInvoke();
    const result = await invoke<boolean>('path_exists', { path });
    console.log('fs.pathExists: result =', result);
    return result;
  },
  
  watchDirectory: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('watch_directory', { path });
  },
  
  unwatchDirectory: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('unwatch_directory', { path });
  },
};

export interface FileChangeEvent {
  kind: 'create' | 'modify' | 'remove' | 'access' | 'any' | 'other';
  paths: string[];
  target_window?: string;
}

// Dialog operations
export const dialog = {
  openDirectory: async (): Promise<string | null> => {
    console.log('dialog.openDirectory: getting dialog module...');
    const dialogMod = await getDialog();
    console.log('dialog.openDirectory: got dialog module, calling open...');
    const result = await dialogMod.open({
      directory: true,
      multiple: false,
    });
    console.log('dialog.openDirectory: result =', result);
    return result as string | null;
  },
  
  openFile: async (): Promise<string | null> => {
    const { open } = await getDialog();
    const result = await open({
      directory: false,
      multiple: false,
    });
    return result as string | null;
  },
  
  saveFile: async (defaultPath?: string): Promise<string | null> => {
    const { save } = await getDialog();
    const result = await save({
      defaultPath,
    });
    return result;
  },
};

// Git operations
export const git = {
  isGitRepo: async (path: string): Promise<boolean> => {
    const invoke = await getInvoke();
    return invoke('is_git_repo', { path });
  },
  
  init: async (path: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_init', { path });
  },
  
  status: async (path: string): Promise<GitStatus> => {
    const invoke = await getInvoke();
    return invoke('git_status', { path });
  },
  
  stage: async (repoPath: string, filePath: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_stage', { repoPath, filePath });
  },
  
  unstage: async (repoPath: string, filePath: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_unstage', { repoPath, filePath });
  },
  
  commit: async (repoPath: string, message: string): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('git_commit', { repoPath, message });
  },
  
  branches: async (repoPath: string): Promise<string[]> => {
    const invoke = await getInvoke();
    return invoke('git_branches', { repoPath });
  },
  
  checkout: async (repoPath: string, branchName: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_checkout', { repoPath, branchName });
  },
  
  log: async (repoPath: string, limit?: number): Promise<GitCommitInfo[]> => {
    const invoke = await getInvoke();
    return invoke('git_log', { repoPath, limit });
  },
  
  fetch: async (repoPath: string, remoteName?: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_fetch', { repoPath, remoteName });
  },
  
  pull: async (repoPath: string, remoteName?: string): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('git_pull', { repoPath, remoteName });
  },
  
  push: async (repoPath: string, remoteName?: string, force?: boolean): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('git_push', { repoPath, remoteName, force });
  },
  
  createBranch: async (repoPath: string, branchName: string, checkout?: boolean): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('git_create_branch', { repoPath, branchName, checkout });
  },
  
  remotes: async (repoPath: string): Promise<{ name: string; url: string | null }[]> => {
    const invoke = await getInvoke();
    return invoke('git_remotes', { repoPath });
  },
};

// AI operations
export const ai = {
  checkOllamaStatus: async (baseUrl?: string): Promise<boolean> => {
    const invoke = await getInvoke();
    return invoke('check_ollama_status', { baseUrl });
  },
  
  listOllamaModels: async (baseUrl?: string): Promise<OllamaModel[]> => {
    const invoke = await getInvoke();
    return invoke('list_ollama_models', { baseUrl });
  },
  
  chatOllama: async (
    baseUrl: string | undefined,
    model: string,
    messages: ChatMessage[],
    temperature: number | undefined,
    maxTokens: number | undefined,
    conversationId: string
  ): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('chat_ollama', {
      baseUrl,
      model,
      messages,
      temperature,
      maxTokens,
      conversationId,
    });
  },
  
  chatOpenAI: async (
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    temperature: number | undefined,
    maxTokens: number | undefined,
    conversationId: string
  ): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('chat_openai_compatible', {
      baseUrl,
      apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      conversationId,
    });
  },
  
  onStreamChunk: async (
    conversationId: string,
    callback: (chunk: StreamChunk) => void
  ) => {
    const listenFn = await getListen();
    return listenFn<StreamChunk>(`ai-stream-${conversationId}`, (event) => {
      callback(event.payload);
    });
  },
  
  stopStream: async (): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('stop_ai_stream');
  },
};

// Terminal operations
export const terminal = {
  create: async (terminalId: string, cwd?: string, rows = 24, cols = 80): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('create_terminal', { terminalId, cwd, rows, cols });
  },
  
  write: async (terminalId: string, data: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('write_terminal', { terminalId, data });
  },
  
  resize: async (terminalId: string, rows: number, cols: number): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('resize_terminal', { terminalId, rows, cols });
  },
  
  close: async (terminalId: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('close_terminal', { terminalId });
  },
  
  onOutput: async (
    terminalId: string,
    callback: (output: TerminalOutput) => void
  ) => {
    const listenFn = await getListen();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const windowLabel = getCurrentWindow().label;
    
    return listenFn<TerminalOutput>(`terminal-output-${terminalId}`, (event) => {
      // Only process output meant for this window
      if (event.payload.target_window && event.payload.target_window !== windowLabel) {
        return;
      }
      callback(event.payload);
    });
  },
};

// History operations
export const history = {
  init: async (): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('init_history_db');
  },
  
  save: async (filePath: string, content: string): Promise<number> => {
    const invoke = await getInvoke();
    return invoke('save_history_entry', { filePath, content });
  },
  
  getFileHistory: async (filePath: string, limit?: number): Promise<HistoryEntry[]> => {
    const invoke = await getInvoke();
    return invoke('get_file_history', { filePath, limit });
  },
  
  getContent: async (id: number): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('get_history_content', { id });
  },
};

// Project operations
export interface ProjectInfo {
  project_type: string;
  name: string;
  build_command: string | null;
  run_command: string | null;
  install_command: string | null;
  clean_command: string | null;
  scripts: Record<string, string>;
  has_dependencies: boolean;
  dependencies_installed: boolean;
}

export const project = {
  detect: async (path: string): Promise<ProjectInfo> => {
    const invoke = await getInvoke();
    return invoke('detect_project', { path });
  },
  
  getNpmScripts: async (path: string): Promise<Record<string, string>> => {
    const invoke = await getInvoke();
    return invoke('get_npm_scripts', { path });
  },
};

// Window operations
export const appWindow = {
  setTitle: async (title: string): Promise<void> => {
    try {
      console.log('Setting window title to:', title);
      const invoke = await getInvoke();
      await invoke('set_window_title', { title });
      console.log('Window title set successfully');
    } catch (error) {
      console.error('Failed to set window title:', error);
    }
  },
};
