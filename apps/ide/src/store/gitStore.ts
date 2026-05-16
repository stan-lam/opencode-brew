import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from './workspaceStore';
import { useSettingsStore } from './settingsStore';

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

interface GitStatusResponse {
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

export interface StashEntry {
  index: number;
  message: string;
}

interface GitState {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  stagedFiles: GitFile[];
  unstagedFiles: GitFile[];
  commitHistory: GitCommitInfo[];
  stashes: StashEntry[];
  isLoading: boolean;
  isPushing: boolean;
  isPulling: boolean;
  error: string | null;
  autoFetchInterval: ReturnType<typeof setInterval> | null;
  
  checkIsRepo: (path: string) => Promise<boolean>;
  initializeRepo: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  checkout: (branch: string) => Promise<void>;
  fetchBranches: () => Promise<void>;
refreshAll: () => Promise<void>;
  fetch: (remoteName?: string) => Promise<void>;
  pull: (remoteName?: string) => Promise<string>;
  push: (remoteName?: string, force?: boolean) => Promise<string>;
  createBranch: (branchName: string, checkout?: boolean) => Promise<void>;
  deleteBranch: (branchName: string, force?: boolean) => Promise<void>;
  discardChanges: (filePath: string) => Promise<void>;
  fetchCommitHistory: (limit?: number) => Promise<void>;
  stash: (message?: string) => Promise<void>;
  stashPop: (index?: number) => Promise<void>;
  fetchStashes: () => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  startAutoFetch: () => void;
  stopAutoFetch: () => void;
  reset: () => void;
}

const getWorkspacePath = (): string | null => {
  return useWorkspaceStore.getState().currentWorkspace?.rootPath || null;
};

export const useGitStore = create<GitState>((set, get) => ({
  isRepo: false,
  currentBranch: null,
  branches: [],
  stagedFiles: [],
  unstagedFiles: [],
  commitHistory: [],
  stashes: [],
  isLoading: false,
  isPushing: false,
  isPulling: false,
  error: null,
  autoFetchInterval: null,

  checkIsRepo: async (path: string) => {
    try {
      const isRepo = await invoke<boolean>('is_git_repo', { path });
      set({ isRepo });
      return isRepo;
    } catch (error) {
      console.error('Failed to check git repo:', error);
      set({ isRepo: false });
      return false;
    }
  },

  initializeRepo: async () => {
    const path = getWorkspacePath();
    if (!path) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_init', { path });
      set({ isRepo: true });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to initialize repo:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  refreshStatus: async () => {
    const path = getWorkspacePath();
    if (!path) return;

    set({ isLoading: true, error: null });
    try {
      const isRepo = await invoke<boolean>('is_git_repo', { path });
      
      if (!isRepo) {
        set({
          isRepo: false,
          currentBranch: null,
          branches: [],
          stagedFiles: [],
          unstagedFiles: [],
          isLoading: false
        });
        return;
      }

      // Clear existing data first to ensure fresh state
      set({ stagedFiles: [], unstagedFiles: [] });

      console.log('[Git] Refreshing status for:', path);
      const status = await invoke<GitStatusResponse>('git_status', { path });
      console.log('[Git] Status result:', { 
        staged: status.staged.length, 
        unstaged: status.unstaged.length, 
        untracked: status.untracked.length 
      });
      
      const stagedFiles: GitFile[] = status.staged.map(f => ({
        path: f.path,
        status: f.status as GitFile['status'],
        staged: true,
      }));

      const unstagedFiles: GitFile[] = [
        ...status.unstaged.map(f => ({
          path: f.path,
          status: f.status as GitFile['status'],
          staged: false,
        })),
        ...status.untracked.map(f => ({
          path: f.path,
          status: 'untracked' as const,
          staged: false,
        })),
      ];

      set({
        isRepo: true,
        currentBranch: status.branch,
        stagedFiles,
        unstagedFiles,
      });

      await get().fetchBranches();
      await get().fetchCommitHistory();
      
      // Start auto-fetch if enabled
      get().startAutoFetch();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg, isRepo: false });
      console.error('Failed to refresh git status:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  stageFile: async (filePath: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      await invoke('git_stage', { repoPath, filePath });
      await get().refreshStatus();
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  },

  unstageFile: async (filePath: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      await invoke('git_unstage', { repoPath, filePath });
      await get().refreshStatus();
    } catch (error) {
      console.error('Failed to unstage file:', error);
    }
  },

  stageAll: async () => {
    const { unstagedFiles } = get();
    for (const file of unstagedFiles) {
      await get().stageFile(file.path);
    }
  },

  unstageAll: async () => {
    const { stagedFiles } = get();
    for (const file of stagedFiles) {
      await get().unstageFile(file.path);
    }
  },

  commit: async (message: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_commit', { repoPath, message });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to commit:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  checkout: async (branchName: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_checkout', { repoPath, branchName });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to checkout:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchBranches: async () => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      const branches = await invoke<string[]>('git_branches', { repoPath });
      set({ branches });
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    }
  },

  fetch: async (remoteName?: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_fetch', { repoPath, remoteName });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to fetch:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  pull: async (remoteName?: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return '';

    set({ isPulling: true, error: null });
    try {
      const result = await invoke<string>('git_pull', { repoPath, remoteName });
      await get().refreshStatus();
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to pull:', error);
      throw error;
    } finally {
      set({ isPulling: false });
    }
  },

  push: async (remoteName?: string, force?: boolean) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return '';

    set({ isPushing: true, error: null });
    try {
      const result = await invoke<string>('git_push', { repoPath, remoteName, force });
      await get().refreshStatus();
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to push:', error);
      throw error;
    } finally {
      set({ isPushing: false });
    }
  },

  createBranch: async (branchName: string, checkout?: boolean) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_create_branch', { repoPath, branchName, checkout });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to create branch:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  deleteBranch: async (branchName: string, force?: boolean) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_delete_branch', { repoPath, branchName, force });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to delete branch:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  discardChanges: async (filePath: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      await invoke('git_discard_changes', { repoPath, filePath });
      await get().refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to discard changes:', error);
      throw error;
    }
  },

  fetchCommitHistory: async (limit?: number) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      const commits = await invoke<GitCommitInfo[]>('git_log', { repoPath, limit: limit || 50 });
      set({ commitHistory: commits });
    } catch (error) {
      console.error('Failed to fetch commit history:', error);
    }
  },

  stash: async (message?: string) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_stash', { repoPath, message });
      await get().refreshStatus();
      await get().fetchStashes();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to stash:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  stashPop: async (index?: number) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    set({ isLoading: true, error: null });
    try {
      await invoke('git_stash_pop', { repoPath, index: index || 0 });
      await get().refreshStatus();
      await get().fetchStashes();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to pop stash:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchStashes: async () => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      const stashes = await invoke<StashEntry[]>('git_stash_list', { repoPath });
      set({ stashes });
    } catch (error) {
      console.error('Failed to fetch stashes:', error);
    }
  },

  stashDrop: async (index: number) => {
    const repoPath = getWorkspacePath();
    if (!repoPath) return;

    try {
      await invoke('git_stash_drop', { repoPath, index });
      await get().fetchStashes();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      set({ error: errorMsg });
      console.error('Failed to drop stash:', error);
      throw error;
    }
  },

  startAutoFetch: () => {
    const { autoFetchInterval, isRepo } = get();
    const { autoFetch } = useSettingsStore.getState();
    
    // Clear existing interval
    if (autoFetchInterval) {
      clearInterval(autoFetchInterval);
    }
    
    if (!autoFetch || !isRepo) {
      set({ autoFetchInterval: null });
      return;
    }
    
    // Fetch every 5 minutes
    const interval = setInterval(async () => {
      const { isRepo, isPushing, isPulling, isLoading } = get();
      const { autoFetch } = useSettingsStore.getState();
      
      if (isRepo && autoFetch && !isPushing && !isPulling && !isLoading) {
        try {
          await get().fetch();
          console.log('Auto-fetch completed');
        } catch (error) {
          console.error('Auto-fetch failed:', error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    set({ autoFetchInterval: interval });
  },

  stopAutoFetch: () => {
    const { autoFetchInterval } = get();
    if (autoFetchInterval) {
      clearInterval(autoFetchInterval);
      set({ autoFetchInterval: null });
    }
  },

  reset: () => {
    const { autoFetchInterval } = get();
    if (autoFetchInterval) {
      clearInterval(autoFetchInterval);
    }
    set({
      isRepo: false,
      currentBranch: null,
      branches: [],
      stagedFiles: [],
      unstagedFiles: [],
      commitHistory: [],
      stashes: [],
      isLoading: false,
      isPushing: false,
      isPulling: false,
      error: null,
      autoFetchInterval: null,
    });
  },
}));

// Start auto-fetch when settings change
useSettingsStore.subscribe((state) => {
  const { isRepo, startAutoFetch, stopAutoFetch } = useGitStore.getState();
  
  if (state.autoFetch && isRepo) {
    startAutoFetch();
  } else {
    stopAutoFetch();
  }
});
