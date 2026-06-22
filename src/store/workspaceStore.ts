import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  folders: string[];
  lastOpened: string;
}

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  recentWorkspaces: Workspace[];
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  addRecentWorkspace: (workspace: Workspace) => void;
  removeRecentWorkspace: (id: string) => void;
  loadRecentWorkspaces: () => void;
  openFolder: (folderPath: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      currentWorkspace: null,
      recentWorkspaces: [],

      setCurrentWorkspace: (workspace) => {
        set({ currentWorkspace: workspace });
        if (workspace) {
          get().addRecentWorkspace(workspace);
        }
      },

      addRecentWorkspace: (workspace) => {
        set((state) => {
          const filtered = state.recentWorkspaces.filter(
            (w) => w.rootPath !== workspace.rootPath
          );
          return {
            recentWorkspaces: [
              { ...workspace, lastOpened: new Date().toISOString() },
              ...filtered,
            ].slice(0, 10),
          };
        });
      },

      removeRecentWorkspace: (id) => {
        set((state) => ({
          recentWorkspaces: state.recentWorkspaces.filter((w) => w.id !== id),
        }));
      },

      loadRecentWorkspaces: () => {
        // Already handled by persist middleware
      },

      openFolder: async (folderPath: string) => {
        console.log('workspaceStore.openFolder called with:', folderPath);
        try {
          const { fs } = await import('../services/tauri');
          console.log('Checking if path exists...');
          const exists = await fs.pathExists(folderPath);
          console.log('Path exists:', exists);
          if (!exists) {
            console.error('Folder does not exist:', folderPath);
            return;
          }
          const name = folderPath.split('/').pop() || folderPath;
          const workspace: Workspace = {
            id: crypto.randomUUID(),
            name,
            rootPath: folderPath,
            folders: [folderPath],
            lastOpened: new Date().toISOString(),
          };
          console.log('Setting current workspace:', workspace);
          get().setCurrentWorkspace(workspace);
          console.log('Workspace set successfully');

          // Close any open files from the previous workspace
          try {
            const { useEditorStore } = await import('./editorStore');
            useEditorStore.getState().closeAllFiles();
            console.log('Closed open files from previous workspace');
          } catch (editorError) {
            console.log('Could not close open files:', editorError);
          }

          // Update window title with project name
          try {
            const { appWindow } = await import('../services/tauri');
            await appWindow.setTitle(name);
            console.log('Window title updated to:', name);
          } catch (titleError) {
            console.log('Could not update window title:', titleError);
          }

          // Switch to Explorer tab to show the files
          try {
            const { useLayoutStore } = await import('./layoutStore');
            useLayoutStore.getState().setActiveSideTab('explorer');
            console.log('Switched to Explorer tab');
          } catch (layoutError) {
            console.log('Could not switch to Explorer tab:', layoutError);
          }
          
          // Load AI chat history for this workspace
          try {
            const { useAIStore } = await import('./aiStore');
            await useAIStore.getState().loadWorkspaceHistory(folderPath);
            console.log('AI history loaded for workspace');
          } catch (aiError) {
            console.log('Could not load AI history:', aiError);
          }

          // Auto-detect git repository
          try {
            const { useGitStore } = await import('./gitStore');
            await useGitStore.getState().refreshStatus();
            console.log('Git status refreshed for workspace');
          } catch (gitError) {
            console.log('Could not refresh git status:', gitError);
          }

          // Detect project type for build/run support
          try {
            const { useProjectStore } = await import('./projectStore');
            await useProjectStore.getState().detectProject(folderPath);
            console.log('Project type detected for workspace');
          } catch (projectError) {
            console.log('Could not detect project type:', projectError);
          }

          // Auto-index workspace for semantic search (in background)
          (async () => {
            try {
              const { vectordb } = await import('../services/tauri');
              const status = await vectordb.getIndexStatus(folderPath);
              
              if (!status.is_indexed) {
                console.log('Starting vector index for workspace (background)...');
                const result = await vectordb.indexWorkspace(folderPath);
                console.log(`Vector index complete: ${result.file_count} files indexed`);
              } else {
                console.log('Workspace already indexed for semantic search');
              }
            } catch (indexError) {
              console.log('Vector indexing not available:', indexError);
            }
          })();
        } catch (error) {
          console.error('Failed to open folder:', error);
        }
      },
    }),
    {
      name: 'opencodebrew-workspace',
      partialize: (state) => ({
        recentWorkspaces: state.recentWorkspaces,
      }),
    }
  )
);
