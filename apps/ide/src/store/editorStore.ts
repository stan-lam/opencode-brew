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
  type?: 'file' | 'diff' | 'history-diff' | 'ai-diff';
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
  aiDiffInfo?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    operationType: 'create' | 'edit' | 'delete';
    requiresOverwrite?: boolean;
    isApplied?: boolean;
  };
  pendingAIEdit?: {
    oldContent: string;
    newContent: string;
    operationType: 'create' | 'edit' | 'delete';
    insertLine?: number;
  };
}

type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

interface EditorState {
  openFiles: OpenFile[];
  activeFile: OpenFile | null;
  openFile: (path: string) => Promise<void>;
  openDiff: (repoPath: string, filePath: string, staged: boolean, status?: DiffFileStatus) => void;
  openHistoryDiff: (filePath: string, fileName: string, historyId: number, timestamp: string, oldContent: string, newContent: string) => void;
  openAIDiff: (
    filePath: string,
    oldContent: string,
    newContent: string,
    operationType: 'create' | 'edit' | 'delete',
    requiresOverwrite?: boolean,
    isApplied?: boolean
  ) => void;
  openFileWithAIEdit: (filePath: string, oldContent: string, newContent: string, operationType: 'create' | 'edit' | 'delete', insertLine?: number) => Promise<void>;
  clearAIEdit: (path: string) => void;
  applyAIEdit: (path: string) => void;
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
    properties: 'ini',
    gradle: 'groovy',
    groovy: 'groovy',
    kts: 'kotlin',
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

  openAIDiff: (
    filePath: string,
    oldContent: string,
    newContent: string,
    operationType: 'create' | 'edit' | 'delete',
    requiresOverwrite?: boolean,
    isApplied?: boolean
  ) => {
    const { openFiles } = get();
    const diffId = `ai:${Date.now()}:${filePath}`;
    const existingDiff = openFiles.find((f) => f.path === diffId);

    if (existingDiff) {
      set({ activeFile: existingDiff });
      return;
    }

    const fileName = filePath.split('/').pop() || filePath;
    const opLabel = operationType === 'create' ? 'New' : operationType === 'edit' ? 'Edit' : 'Delete';
    const newDiff: OpenFile = {
      path: diffId,
      name: `${fileName} (AI ${opLabel})`,
      content: '',
      language: getLanguageFromPath(filePath),
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      type: 'ai-diff',
      aiDiffInfo: {
        filePath,
        oldContent,
        newContent,
        operationType,
        requiresOverwrite,
        isApplied,
      },
    };

    set((state) => ({
      openFiles: [...state.openFiles, newDiff],
      activeFile: newDiff,
    }));
  },

  openFileWithAIEdit: async (filePath: string, oldContent: string, newContent: string, operationType: 'create' | 'edit' | 'delete', insertLine?: number) => {
    const { openFiles, openFile, openAIDiff } = get();
    
    // For create operations, use the AI diff view since file doesn't exist
    if (operationType === 'create') {
      openAIDiff(filePath, oldContent, newContent, operationType);
      return;
    }
    
    // Check if file is already open
    let existingFile = openFiles.find((f) => f.path === filePath && f.type !== 'diff' && f.type !== 'ai-diff');
    
    if (!existingFile) {
      // Try to open the file
      try {
        await openFile(filePath);
        existingFile = get().openFiles.find((f) => f.path === filePath && f.type !== 'diff' && f.type !== 'ai-diff');
      } catch (error) {
        // If file doesn't exist, fall back to AI diff view
        console.warn('Could not open file, using diff view:', error);
        openAIDiff(filePath, oldContent, newContent, operationType);
        return;
      }
    }
    
    if (existingFile) {
      // Add pending AI edit info to the file
      set((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.path === filePath && f.type !== 'diff' && f.type !== 'ai-diff'
            ? { ...f, pendingAIEdit: { oldContent, newContent, operationType, insertLine } }
            : f
        ),
        activeFile: state.activeFile?.path === filePath
          ? { ...state.activeFile, pendingAIEdit: { oldContent, newContent, operationType, insertLine } }
          : state.activeFile,
      }));
      
      // Set as active
      get().setActiveFile(filePath);
    }
  },

  clearAIEdit: (path: string) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, pendingAIEdit: undefined } : f
      ),
      activeFile: state.activeFile?.path === path
        ? { ...state.activeFile, pendingAIEdit: undefined }
        : state.activeFile,
    }));
  },

  applyAIEdit: (path: string) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (!file || !file.pendingAIEdit) return;
    
    const { oldContent, newContent, operationType, insertLine } = file.pendingAIEdit;
    let updatedContent = file.content;
    
    if (operationType === 'create') {
      // For create, newContent is the entire file
      updatedContent = newContent;
    } else if (operationType === 'edit') {
      // Handle insert mode - insert at specific line
      if (insertLine !== undefined && !oldContent) {
        const lines = file.content.split('\n');
        const insertIdx = Math.max(0, Math.min(insertLine - 1, lines.length));
        lines.splice(insertIdx, 0, newContent.trim());
        updatedContent = lines.join('\n');
      } else {
        // For replace mode, replace oldContent with newContent in the file
        const oldTrimmed = oldContent.trim();
        const newTrimmed = newContent.trim();
        
        if (oldTrimmed && file.content.includes(oldTrimmed)) {
          updatedContent = file.content.replace(oldTrimmed, newTrimmed);
        } else {
          // Try with normalized line endings
          const normalizedContent = file.content.replace(/\r\n/g, '\n');
          const normalizedOld = oldTrimmed.replace(/\r\n/g, '\n');
          const normalizedNew = newTrimmed.replace(/\r\n/g, '\n');
          
          if (normalizedContent.includes(normalizedOld)) {
            updatedContent = normalizedContent.replace(normalizedOld, normalizedNew);
          } else {
            console.warn('Could not find oldContent in file, appending newContent instead');
            updatedContent = file.content + '\n' + newTrimmed;
          }
        }
      }
    }
    
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, content: updatedContent, isDirty: true, pendingAIEdit: undefined }
          : f
      ),
      activeFile: state.activeFile?.path === path
        ? { ...state.activeFile, content: updatedContent, isDirty: true, pendingAIEdit: undefined }
        : state.activeFile,
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
    if (!file) {
      console.error('[editorStore] saveFile: file not found in openFiles:', path);
      console.log('[editorStore] openFiles paths:', get().openFiles.map(f => f.path));
      return;
    }

    try {
      console.log('[editorStore] saveFile: writing to', path, 'content length:', file.content?.length);
      await fs.writeFile(path, file.content);
      console.log('[editorStore] saveFile: write successful');
      
      // Save to local history
      await history.save(path, file.content).catch((e) => console.error('[editorStore] history save error:', e));
      
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
      console.log('[editorStore] saveFile: completed successfully');
    } catch (error) {
      console.error('[editorStore] Failed to save file:', error);
      throw error; // Re-throw so caller knows it failed
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
