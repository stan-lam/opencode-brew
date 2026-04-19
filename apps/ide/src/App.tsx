import { useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IDELayout } from './components/Layout/IDELayout';
import { useWorkspaceStore } from './store/workspaceStore';
import { useLayoutStore } from './store/layoutStore';
import { useProjectStore } from './store/projectStore';
import { useSettingsStore } from './store/settingsStore';
import { useEditorStore } from './store/editorStore';
import { history, dialog } from './services/tauri';

const runCommand = (command: string, args: string[], cwd: string, label: string) => {
  const { setActiveBottomTab } = useLayoutStore.getState();
  const { setIsRunning } = useProjectStore.getState();
  
  const terminalId = `${label.toLowerCase()}-${Date.now()}`;
  const cmd = `${command} ${args.join(' ')}`;
  
  setActiveBottomTab('terminal');
  setIsRunning(true, terminalId);

  window.dispatchEvent(new CustomEvent('run-command', { 
    detail: { terminalId, command: cmd, cwd, label } 
  }));
  
  showNotification(`${label}: ${cmd}`, 'success');
};

const showNotification = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
  window.dispatchEvent(new CustomEvent('show-notification', { detail: { message, type } }));
};

function App() {
  const { loadRecentWorkspaces, openFolder } = useWorkspaceStore();
  const { setActiveSideTab } = useLayoutStore();
  const { theme, fontSize } = useSettingsStore();

  useEffect(() => {
    loadRecentWorkspaces();
    history.init().catch(console.error);
  }, [loadRecentWorkspaces]);

  useEffect(() => {
    const root = document.documentElement;
    
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
    
    root.style.setProperty('--font-size-base', `${fontSize}px`);
  }, [theme, fontSize]);

  const handleRunProject = useCallback(async () => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { activeConfiguration, projectInfo } = useProjectStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.');
      return;
    }
    
    if (!activeConfiguration) {
      if (!projectInfo || projectInfo.project_type === 'unknown') {
        showNotification('No run configuration available for this project type.');
      } else {
        showNotification('No run configuration selected.');
      }
      return;
    }
    
    await runCommand(
      activeConfiguration.command, 
      activeConfiguration.args, 
      currentWorkspace.rootPath,
      'Run'
    );
  }, []);

  const handleBuildProject = useCallback(() => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { projectInfo } = useProjectStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.', 'error');
      return;
    }
    
    if (!projectInfo?.build_command) {
      showNotification(`No build command available for project type: ${projectInfo?.project_type || 'unknown'}`, 'error');
      return;
    }
    
    runCommand('sh', ['-c', projectInfo.build_command], currentWorkspace.rootPath, 'Build');
  }, []);

  const handleInstallDeps = useCallback(async () => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { projectInfo } = useProjectStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.');
      return;
    }
    
    if (!projectInfo?.install_command) {
      showNotification('No install command available for this project type.');
      return;
    }
    
    runCommand('sh', ['-c', projectInfo.install_command], currentWorkspace.rootPath, 'Install');
  }, []);

  const handleCleanProject = useCallback(() => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { projectInfo } = useProjectStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.', 'error');
      return;
    }
    
    if (!projectInfo?.clean_command) {
      showNotification(`No clean command available for project type: ${projectInfo?.project_type || 'unknown'}`, 'error');
      return;
    }
    
    runCommand('sh', ['-c', projectInfo.clean_command], currentWorkspace.rootPath, 'Clean');
  }, []);

  const handleRebuildProject = useCallback(() => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { projectInfo } = useProjectStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.', 'error');
      return;
    }
    
    if (!projectInfo?.build_command) {
      showNotification(`No build command available for project type: ${projectInfo?.project_type || 'unknown'}`, 'error');
      return;
    }
    
    const command = projectInfo.clean_command 
      ? `${projectInfo.clean_command} && ${projectInfo.build_command}`
      : projectInfo.build_command;
    
    runCommand('sh', ['-c', command], currentWorkspace.rootPath, 'Rebuild');
  }, []);

  const handleRunFile = useCallback(() => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { activeFile } = useEditorStore.getState();
    
    if (!currentWorkspace) {
      showNotification('No workspace open. Open a folder first.', 'error');
      return;
    }
    
    if (!activeFile) {
      showNotification('No file is currently open.', 'error');
      return;
    }
    
    const filePath = activeFile.path;
    const fileName = activeFile.name;
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    let command: string;
    
    switch (ext) {
      case 'py':
        command = `python3 "${filePath}"`;
        break;
      case 'js':
        command = `node "${filePath}"`;
        break;
      case 'ts':
        command = `npx ts-node "${filePath}"`;
        break;
      case 'rb':
        command = `ruby "${filePath}"`;
        break;
      case 'go':
        command = `go run "${filePath}"`;
        break;
      case 'rs':
        command = `rustc "${filePath}" -o /tmp/rust_out && /tmp/rust_out`;
        break;
      case 'java':
        const className = fileName.replace('.java', '');
        command = `cd "${currentWorkspace.rootPath}" && javac "${filePath}" && java ${className}`;
        break;
      case 'sh':
      case 'bash':
        command = `bash "${filePath}"`;
        break;
      case 'php':
        command = `php "${filePath}"`;
        break;
      default:
        showNotification(`Cannot run .${ext} files directly. Use Run Project instead.`, 'error');
        return;
    }
    
    runCommand('sh', ['-c', command], currentWorkspace.rootPath, `Run ${fileName}`);
  }, []);

  const handleEditRunConfigs = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-run-config-editor'));
  }, []);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const windowLabel = currentWindow.label;
    
    const isTargetedAtThisWindow = (payload: unknown): boolean => {
      if (payload && typeof payload === 'object' && 'target_window' in payload) {
        const targetWindow = (payload as { target_window: string }).target_window;
        return targetWindow === windowLabel;
      }
      return true;
    };
    
    const unlistenFindInFiles = listen('open-find-in-files', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      setActiveSideTab('search');
      window.dispatchEvent(new CustomEvent('search-panel-find'));
    });

    const unlistenReplaceInFiles = listen('open-replace-in-files', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      setActiveSideTab('search');
      window.dispatchEvent(new CustomEvent('search-panel-replace'));
    });

    const unlistenSettings = listen('open-settings', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      setActiveSideTab('settings');
    });

    const unlistenCheckUpdates = listen('check-updates', async (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      window.dispatchEvent(new CustomEvent('check-for-updates'));
    });

    const unlistenOpenFolder = listen('open-folder', async (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      try {
        const folderPath = await dialog.openDirectory();
        if (folderPath) {
          await openFolder(folderPath);
        }
      } catch (error) {
        console.error('Error opening folder:', error);
      }
    });

    const unlistenRunProject = listen('run-project', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleRunProject();
    });
    
    const unlistenRunFile = listen('run-file', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleRunFile();
    });
    
    const unlistenEditRunConfigs = listen('edit-run-configs', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleEditRunConfigs();
    });
    
    const unlistenBuildProject = listen('build-project', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleBuildProject();
    });
    
    const unlistenRebuildProject = listen('rebuild-project', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleRebuildProject();
    });
    
    const unlistenCleanProject = listen('clean-project', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleCleanProject();
    });
    
    const unlistenInstallDeps = listen('install-deps', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleInstallDeps();
    });

    const unlistenStopRun = listen('stop-run', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      const { setIsRunning } = useProjectStore.getState();
      setIsRunning(false);
      showNotification('Run stopped', 'info');
      window.dispatchEvent(new CustomEvent('run-stopped'));
    });

    const unlistenToggleTerminal = listen('toggle-terminal', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      const { setActiveBottomTab } = useLayoutStore.getState();
      setActiveBottomTab('terminal');
    });

    const unlistenToggleProblems = listen('toggle-problems', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      const { setActiveBottomTab } = useLayoutStore.getState();
      setActiveBottomTab('problems');
    });

    const unlistenToggleOutput = listen('toggle-output', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      const { setActiveBottomTab } = useLayoutStore.getState();
      setActiveBottomTab('output');
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setActiveSideTab('search');
        window.dispatchEvent(new CustomEvent('search-panel-find'));
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'h') {
        e.preventDefault();
        setActiveSideTab('search');
        window.dispatchEvent(new CustomEvent('search-panel-replace'));
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        dialog.openDirectory().then(async (folderPath) => {
          if (folderPath) {
            await openFolder(folderPath);
          }
        }).catch(console.error);
      } else if (e.key === 'F5' && !e.shiftKey) {
        e.preventDefault();
        handleRunProject();
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        const { setIsRunning } = useProjectStore.getState();
        setIsRunning(false);
        window.dispatchEvent(new CustomEvent('run-stopped'));
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        handleBuildProject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenFindInFiles.then(fn => fn());
      unlistenReplaceInFiles.then(fn => fn());
      unlistenSettings.then(fn => fn());
      unlistenCheckUpdates.then(fn => fn());
      unlistenOpenFolder.then(fn => fn());
      unlistenRunProject.then(fn => fn());
      unlistenRunFile.then(fn => fn());
      unlistenEditRunConfigs.then(fn => fn());
      unlistenBuildProject.then(fn => fn());
      unlistenRebuildProject.then(fn => fn());
      unlistenCleanProject.then(fn => fn());
      unlistenInstallDeps.then(fn => fn());
      unlistenStopRun.then(fn => fn());
      unlistenToggleTerminal.then(fn => fn());
      unlistenToggleProblems.then(fn => fn());
      unlistenToggleOutput.then(fn => fn());
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setActiveSideTab, openFolder, handleRunProject, handleRunFile, handleEditRunConfigs, handleBuildProject, handleRebuildProject, handleCleanProject, handleInstallDeps]);

  return <IDELayout />;
}

export default App;
