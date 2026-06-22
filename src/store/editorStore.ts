import { create } from 'zustand';
import { fs, history, appWindow } from '../services/tauri';

// Helper to update window title based on active file and workspace
const updateWindowTitle = async (fileName: string | null) => {
  try {
    const { useWorkspaceStore } = await import('./workspaceStore');
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    const repoName = workspace?.name || 'OpenCodeBrew';
    
    if (fileName) {
      await appWindow.setTitle(`${repoName} - ${fileName}`);
    } else {
      await appWindow.setTitle(repoName);
    }
  } catch (error) {
    console.error('Failed to update window title:', error);
  }
};

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  cursorPosition: { line: number; column: number };
  type?: 'file' | 'diff' | 'history-diff';
  diffInfo?: {
    repoPath: string;
    filePath: string;
    staged: boolean;
    status?: DiffFileStatus;
  };
  historyDiffInfo?: {
    filePath: string;
    fileName: string;
    historyId: number;
    historyTimestamp: string;
    oldContent: string;
    newContent: string;
  };
}

type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

interface EditorState {
  openFiles: OpenFile[];
  activeFile: OpenFile | null;
  openFile: (path: string) => Promise<void>;
  openDiff: (repoPath: string, filePath: string, staged: boolean, status?: DiffFileStatus) => void;
  openHistoryDiff: (filePath: string, fileName: string, historyId: number, timestamp: string, oldContent: string, newContent: string) => void;
  closeFile: (path: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  setCursorPosition: (path: string, line: number, column: number) => void;
}

const getLanguageFromPath = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    xml: 'xml',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    dockerfile: 'dockerfile',
  };
  return langMap[ext] || 'plaintext';
};

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFile: null,

  openFile: async (path: string) => {
    const { openFiles } = get();
    const existingFile = openFiles.find((f) => f.path === path && f.type !== 'diff');

    if (existingFile) {
      set({ activeFile: existingFile });
      updateWindowTitle(existingFile.name);
      return;
    }

    try {
      const content = await fs.readFile(path);
      const name = path.split('/').pop() || path;
      const newFile: OpenFile = {
        path,
        name,
        content,
        language: getLanguageFromPath(path),
        isDirty: false,
        cursorPosition: { line: 1, column: 1 },
        type: 'file',
      };

      set((state) => ({
        openFiles: [...state.openFiles, newFile],
        activeFile: newFile,
      }));
      
      // Update window title with filename
      updateWindowTitle(name);

      // Save initial content to history so we have a baseline to compare against
      history.save(path, content).then(() => {
        window.dispatchEvent(new CustomEvent('file-saved', { detail: { path } }));
      }).catch(console.error);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  },

  openDiff: (repoPath: string, filePath: string, staged: boolean, status?: DiffFileStatus) => {
    const { openFiles } = get();
    const diffPath = `diff:${staged ? 'staged' : 'unstaged'}:${filePath}`;
    const existingDiff = openFiles.find((f) => f.path === diffPath);

    if (existingDiff) {
      set({ activeFile: existingDiff });
      return;
    }

    const name = filePath.split('/').pop() || filePath;
    const newDiff: OpenFile = {
      path: diffPath,
      name: `${name} (${staged ? 'Staged' : 'Changes'})`,
      content: '',
      language: 'diff',
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      type: 'diff',
      diffInfo: {
        repoPath,
        filePath,
        staged,
        status,
      },
    };

    set((state) => ({
      openFiles: [...state.openFiles, newDiff],
      activeFile: newDiff,
    }));
  },

  openHistoryDiff: (filePath: string, fileName: string, historyId: number, timestamp: string, oldContent: string, newContent: string) => {
    const { openFiles } = get();
    const diffPath = `history:${historyId}:${filePath}`;
    const existingDiff = openFiles.find((f) => f.path === diffPath);

    if (existingDiff) {
      set({ activeFile: existingDiff });
      return;
    }

    const formattedTime = new Date(timestamp).toLocaleString();
    const newDiff: OpenFile = {
      path: diffPath,
      name: `${fileName} (${formattedTime})`,
      content: '',
      language: getLanguageFromPath(filePath),
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      type: 'history-diff',
      historyDiffInfo: {
        filePath,
        fileName,
        historyId,
        historyTimestamp: timestamp,
        oldContent,
        newContent,
      },
    };

    set((state) => ({
      openFiles: [...state.openFiles, newDiff],
      activeFile: newDiff,
    }));
  },

  closeFile: (path: string) => {
    const state = get();
    const newOpenFiles = state.openFiles.filter((f) => f.path !== path);
    let newActiveFile = state.activeFile;

    if (state.activeFile?.path === path) {
      const index = state.openFiles.findIndex((f) => f.path === path);
      newActiveFile = newOpenFiles[index] || newOpenFiles[index - 1] || null;
    }

    set({
      openFiles: newOpenFiles,
      activeFile: newActiveFile,
    });
    
    // Update window title
    updateWindowTitle(newActiveFile?.name || null);
  },

  closeAllFiles: () => {
    set({ openFiles: [], activeFile: null });
    updateWindowTitle(null);
  },

  setActiveFile: (path: string) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (file) {
      set({ activeFile: file });
      updateWindowTitle(file.name);
    }
  },

  updateFileContent: (path: string, content: string) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
      activeFile:
        state.activeFile?.path === path
          ? { ...state.activeFile, content, isDirty: true }
          : state.activeFile,
    }));
  },

  saveFile: async (path: string) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (!file) return;

    try {
      await fs.writeFile(path, file.content);
      // Save to local history
      await history.save(path, file.content).catch(console.error);
      
      set((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.path === path ? { ...f, isDirty: false } : f
        ),
        activeFile:
          state.activeFile?.path === path
            ? { ...state.activeFile, isDirty: false }
            : state.activeFile,
      }));

      // Emit event to notify history panel of the save
      window.dispatchEvent(new CustomEvent('file-saved', { detail: { path } }));
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  },

  saveAllFiles: async () => {
    const { openFiles, saveFile } = get();
    const dirtyFiles = openFiles.filter((f) => f.isDirty);
    await Promise.all(dirtyFiles.map((f) => saveFile(f.path)));
  },

  setCursorPosition: (path: string, line: number, column: number) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, cursorPosition: { line, column } } : f
      ),
      activeFile:
        state.activeFile?.path === path
          ? { ...state.activeFile, cursorPosition: { line, column } }
          : state.activeFile,
    }));
  },
}));
