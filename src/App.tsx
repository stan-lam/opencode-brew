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

// Helper to run commands - dispatches event for TerminalPanel to handle
const runCommand = (command: string, args: string[], cwd: string, label: string) => {
  const { setActiveBottomTab } = useLayoutStore.getState();
  const { setIsRunning } = useProjectStore.getState();
  
  const terminalId = `${label.toLowerCase()}-${Date.now()}`;
  const cmd = `${command} ${args.join(' ')}`;
  
  // Show terminal panel (setActiveBottomTab also sets showBottomPanel: true)
  setActiveBottomTab('terminal');
  setIsRunning(true, terminalId);

  // Dispatch event for TerminalPanel to create and run the terminal
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

  // Apply theme and font size settings
  useEffect(() => {
    const root = document.documentElement;
    
    // Apply theme
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
    
    // Apply font size
    root.style.setProperty('--font-size-base', `${fontSize}px`);
  }, [theme, fontSize]);

  // Run project handler
  const handleRunProject = useCallback(async () => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { activeConfiguration, projectInfo } = useProjectStore.getState();
    
    console.log('handleRunProject called', { currentWorkspace, activeConfiguration, projectInfo });
    
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

  // Build project handler
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

  // Install dependencies handler
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

  // Clean project handler
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

  // Rebuild project handler (clean + build)
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
    
    // Combine clean and build commands if clean is available
    const command = projectInfo.clean_command 
      ? `${projectInfo.clean_command} && ${projectInfo.build_command}`
      : projectInfo.build_command;
    
    runCommand('sh', ['-c', command], currentWorkspace.rootPath, 'Rebuild');
  }, []);

  // Run current file handler
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

  // Edit run configurations handler
  const handleEditRunConfigs = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-run-config-editor'));
  }, []);

  // Listen for menu events at app level
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const windowLabel = currentWindow.label;
    console.log(`========================================`);
    console.log(`App: Setting up Tauri event listeners`);
    console.log(`App: Window label = "${windowLabel}"`);
    console.log(`========================================`);
    
    // Helper to check if event is targeted at this window
    const isTargetedAtThisWindow = (payload: unknown): boolean => {
      console.log('>>> Checking payload:', payload, 'windowLabel:', windowLabel);
      if (payload && typeof payload === 'object' && 'target_window' in payload) {
        const targetWindow = (payload as { target_window: string }).target_window;
        const isTarget = targetWindow === windowLabel;
        console.log('>>> target_window:', targetWindow, 'isTarget:', isTarget);
        return isTarget;
      }
      console.log('>>> No target_window in payload, returning true');
      return true; // If no target specified, handle it
    };
    
    // Debug: listen for all events
    const unlistenAll = listen('build-project', (event) => {
      console.log('>>> DIRECT build-project listener fired!', event);
      console.log('>>> Payload:', JSON.stringify(event.payload));
    });
    
    // Also listen for run-project to debug
    const unlistenRunDebug = listen('run-project', (event) => {
      console.log('>>> DIRECT run-project listener fired!', event);
      console.log('>>> Payload:', JSON.stringify(event.payload));
    });
    
    const unlistenFindInFiles = listen('open-find-in-files', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      console.log('>>> open-find-in-files received');
      setActiveSideTab('search');
      window.dispatchEvent(new CustomEvent('search-panel-find'));
    });

    const unlistenReplaceInFiles = listen('open-replace-in-files', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      console.log('>>> open-replace-in-files received');
      setActiveSideTab('search');
      window.dispatchEvent(new CustomEvent('search-panel-replace'));
    });

    const unlistenSettings = listen('open-settings', (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      console.log('>>> open-settings received');
      setActiveSideTab('settings');
    });

    const unlistenCheckUpdates = listen('check-updates', async (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      console.log('>>> check-updates received');
      window.dispatchEvent(new CustomEvent('check-for-updates'));
    });

    const unlistenOpenFolder = listen('open-folder', async (event) => {
      if (!isTargetedAtThisWindow(event.payload)) return;
      console.log('>>> open-folder received');
      try {
        const folderPath = await dialog.openDirectory();
        if (folderPath) {
          await openFolder(folderPath);
        }
      } catch (error) {
        console.error('Error opening folder:', error);
      }
    });

    // Run menu events - temporarily disabled filtering for debugging
    const unlistenRunProject = listen('run-project', (event) => {
      console.log(`>>> [${windowLabel}] run-project event received, payload:`, event.payload);
      const shouldHandle = isTargetedAtThisWindow(event.payload);
      console.log(`>>> [${windowLabel}] shouldHandle:`, shouldHandle);
      if (!shouldHandle) {
        console.log(`>>> [${windowLabel}] Skipping because not targeted at this window`);
        return;
      }
      console.log(`>>> [${windowLabel}] Calling handleRunProject()`);
      handleRunProject();
    });
    const unlistenRunFile = listen('run-file', (event) => {
      console.log('>>> run-file event received, payload:', event.payload);
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleRunFile();
    });
    const unlistenEditRunConfigs = listen('edit-run-configs', (event) => {
      console.log('>>> edit-run-configs event received, payload:', event.payload);
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleEditRunConfigs();
    });
    const unlistenBuildProject = listen('build-project', (event) => {
      console.log('>>> build-project event received, payload:', event.payload);
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleBuildProject();
    });
    const unlistenRebuildProject = listen('rebuild-project', (event) => {
      console.log('>>> rebuild-project event received, payload:', event.payload);
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleRebuildProject();
    });
    const unlistenCleanProject = listen('clean-project', (event) => {
      console.log('>>> clean-project event received, payload:', event.payload);
      if (!isTargetedAtThisWindow(event.payload)) return;
      handleCleanProject();
    });
    const unlistenInstallDeps = listen('install-deps', (event) => {
      console.log('>>> install-deps event received, payload:', event.payload);
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

    // View menu events - setActiveBottomTab already sets showBottomPanel: true
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

    // Keyboard shortcuts
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
      unlistenAll.then(fn => fn());
      unlistenRunDebug.then(fn => fn());
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
