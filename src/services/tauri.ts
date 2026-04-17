// Lazy-loaded Tauri API wrapper to avoid CSP issues during module initialization

let invokeFunc: typeof import('@tauri-apps/api/core').invoke | null = null;
let listenFunc: typeof import('@tauri-apps/api/event').listen | null = null;
let dialogModule: typeof import('@tauri-apps/plugin-dialog') | null = null;
let shellModule: typeof import('@tauri-apps/plugin-shell') | null = null;

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

async function getShell() {
  if (!shellModule) {
    shellModule = await import('@tauri-apps/plugin-shell');
  }
  return shellModule;
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

export interface CopilotDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface CopilotLoginStatus {
  logged_in: boolean;
}

export interface CopilotBillingInfo {
  total: number;
  added_this_cycle: number;
  pending_cancellation: number;
  pending_invitation: number;
  active_this_cycle: number;
  inactive_this_cycle: number;
  seat_management_setting?: string;
  plan_type?: string;
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

  getAppDataDir: async (): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('get_app_data_dir');
  },
};

export interface FileChangeEvent {
  kind: 'create' | 'modify' | 'remove' | 'access' | 'any' | 'other';
  paths: string[];
  target_window?: string;
}

export interface FileDropPayload {
  paths: string[];
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

// Shell operations
export const shell = {
  openExternal: async (url: string): Promise<void> => {
    const { open } = await getShell();
    await open(url);
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

  copilotLoginStatus: async (): Promise<CopilotLoginStatus> => {
    const invoke = await getInvoke();
    return invoke('copilot_device_login_status');
  },

  copilotDeviceLoginStart: async (clientId?: string): Promise<CopilotDeviceCode> => {
    const invoke = await getInvoke();
    return invoke('copilot_device_login_start', { clientId });
  },

  copilotDeviceLoginPoll: async (
    deviceCode: string,
    interval?: number,
    expiresIn?: number,
    clientId?: string
  ): Promise<boolean> => {
    const invoke = await getInvoke();
    return invoke('copilot_device_login_poll', { deviceCode, interval, expiresIn, clientId });
  },

  copilotDeviceLogout: async (): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('copilot_device_logout');
  },

  listCopilotModels: async (): Promise<string[]> => {
    const invoke = await getInvoke();
    return invoke('list_copilot_models');
  },

  listCopilotVisionModels: async (): Promise<string[]> => {
    const invoke = await getInvoke();
    return invoke('list_copilot_vision_models');
  },

  copilotListOrgs: async (): Promise<string[]> => {
    const invoke = await getInvoke();
    return invoke('copilot_list_orgs');
  },

  copilotBillingInfo: async (org: string): Promise<CopilotBillingInfo> => {
    const invoke = await getInvoke();
    return invoke('copilot_billing_info', { org });
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

  chatCopilot: async (
    model: string,
    messages: ChatMessage[],
    temperature: number | undefined,
    maxTokens: number | undefined,
    conversationId: string
  ): Promise<string> => {
    const invoke = await getInvoke();
    return invoke('chat_copilot', {
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

// Tauri v2 drag-drop event payload - structure may vary
export interface DragDropPayload {
  type?: 'drop' | 'enter' | 'leave' | 'over';
  paths?: string[];
  position?: { x: number; y: number };
}

// App-level events - Tauri v2 window drag-drop events
// Use deduplication to prevent duplicate processing from multiple event sources
let lastDropTime = 0;
let lastDropPaths: string[] = [];

export const appEvents = {
  onFileDrop: async (callback: (paths: string[]) => void) => {
    const listenFn = await getListen();
    console.log('[tauri.ts] Registering drag-drop listeners');
    
    const processDropEvent = (paths: string[], source: string) => {
      const now = Date.now();
      const pathsKey = paths.sort().join('|');
      const lastPathsKey = lastDropPaths.sort().join('|');
      
      // Deduplicate: ignore if same paths within 500ms
      if (now - lastDropTime < 500 && pathsKey === lastPathsKey) {
        console.log(`[tauri.ts] Ignoring duplicate drop from ${source}`);
        return;
      }
      
      lastDropTime = now;
      lastDropPaths = [...paths];
      console.log(`[tauri.ts] Processing drop from ${source}:`, paths);
      callback(paths);
    };
    
    const unlisten1 = await listenFn('tauri://drag-drop', (event) => {
      console.log('[tauri.ts] tauri://drag-drop event:', JSON.stringify(event.payload));
      const payload = event.payload as DragDropPayload | string[];
      
      let paths: string[] | undefined;
      if (Array.isArray(payload)) {
        paths = payload;
      } else if (payload?.paths) {
        if (!payload.type || payload.type === 'drop') {
          paths = payload.paths;
        }
      }
      
      if (paths?.length) {
        processDropEvent(paths, 'drag-drop');
      }
    });
    
    const unlisten2 = await listenFn('tauri://file-drop', (event) => {
      console.log('[tauri.ts] tauri://file-drop event:', JSON.stringify(event.payload));
      const payload = event.payload as string[] | { paths: string[] };
      const paths = Array.isArray(payload) ? payload : payload?.paths;
      if (paths?.length) {
        processDropEvent(paths, 'file-drop');
      }
    });
    
    return () => {
      unlisten1();
      unlisten2();
    };
  },
  onFileDropHover: async (callback: (paths: string[]) => void) => {
    const listenFn = await getListen();
    
    const unlisten1 = await listenFn('tauri://drag-drop', (event) => {
      const payload = event.payload as DragDropPayload;
      if (payload?.type === 'enter' || payload?.type === 'over') {
        callback(payload?.paths || []);
      }
    });
    
    const unlisten2 = await listenFn('tauri://file-drop-hover', (event) => {
      const payload = event.payload as string[] | { paths: string[] };
      const paths = Array.isArray(payload) ? payload : payload?.paths;
      callback(paths || []);
    });
    
    return () => {
      unlisten1();
      unlisten2();
    };
  },
  onFileDropCancel: async (callback: () => void) => {
    const listenFn = await getListen();
    
    const unlisten1 = await listenFn('tauri://drag-drop', (event) => {
      const payload = event.payload as DragDropPayload;
      if (payload?.type === 'leave') {
        callback();
      }
    });
    
    const unlisten2 = await listenFn('tauri://file-drop-cancelled', () => {
      callback();
    });
    
    return () => {
      unlisten1();
      unlisten2();
    };
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

// Web operations (search and fetch)
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebContent {
  url: string;
  title: string;
  content: string;
  content_type: string;
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  market_cap?: string;
}

export interface MarketMovers {
  gainers: StockQuote[];
  losers: StockQuote[];
  most_active: StockQuote[];
}

export const web = {
  search: async (query: string, maxResults?: number): Promise<WebSearchResult[]> => {
    const invoke = await getInvoke();
    return invoke('search_web', { query, maxResults });
  },

  fetchUrl: async (url: string): Promise<WebContent> => {
    const invoke = await getInvoke();
    return invoke('fetch_url', { url });
  },

  getStockQuote: async (symbol: string): Promise<StockQuote> => {
    const invoke = await getInvoke();
    return invoke('get_stock_quote', { symbol });
  },

  getMarketMovers: async (): Promise<MarketMovers> => {
    const invoke = await getInvoke();
    return invoke('get_market_movers');
  },
};

// MCP (Model Context Protocol) types and operations
export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface MCPContent {
  type: string;
  text?: string;
}

export interface MCPToolResult {
  content: MCPContent[];
  is_error: boolean;
}

export const mcp = {
  startServer: async (config: MCPServerConfig): Promise<MCPTool[]> => {
    const invoke = await getInvoke();
    return invoke('mcp_start_server', { config });
  },

  stopServer: async (serverId: string): Promise<void> => {
    const invoke = await getInvoke();
    return invoke('mcp_stop_server', { serverId });
  },

  listTools: async (serverId: string): Promise<MCPTool[]> => {
    const invoke = await getInvoke();
    return invoke('mcp_list_tools', { serverId });
  },

  callTool: async (serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> => {
    const invoke = await getInvoke();
    return invoke('mcp_call_tool', { serverId, toolName, arguments: args });
  },

  getRunningServers: async (): Promise<string[]> => {
    const invoke = await getInvoke();
    return invoke('mcp_get_running_servers');
  },
};
