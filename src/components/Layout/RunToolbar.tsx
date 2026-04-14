import { Play, Square, ChevronDown, Settings } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { terminal } from '../../services/tauri';
import { useState, useRef, useEffect } from 'react';
import styles from './RunToolbar.module.css';

export function RunToolbar() {
  const { currentWorkspace } = useWorkspaceStore();
  const { 
    projectInfo, 
    runConfigurations, 
    activeConfiguration, 
    setActiveConfiguration,
    isRunning,
    setIsRunning,
    runningProcessId,
  } = useProjectStore();
  const { setShowBottomPanel, setActiveBottomTab } = useLayoutStore();
  
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!currentWorkspace || !projectInfo || projectInfo.project_type === 'unknown') {
    return null;
  }

  const showNotification = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    window.dispatchEvent(new CustomEvent('show-notification', { detail: { message, type } }));
  };

  const handleRun = async () => {
    if (!activeConfiguration || !currentWorkspace) {
      showNotification('No run configuration selected', 'error');
      return;
    }

    try {
      const terminalId = `run-${Date.now()}`;
      setIsRunning(true, terminalId);
      
      // Show terminal panel
      setShowBottomPanel(true);
      setActiveBottomTab('terminal');

      // Build the command
      const cmd = `${activeConfiguration.command} ${activeConfiguration.args.join(' ')}`;
      
      showNotification(`Running: ${activeConfiguration.name}`, 'success');

      // Wait for panel to render before dispatching event
      setTimeout(() => {
        // Emit event for terminal panel to create and run
        window.dispatchEvent(new CustomEvent('run-command', { 
          detail: { 
            terminalId, 
            command: cmd,
            cwd: currentWorkspace.rootPath,
            label: `Run: ${activeConfiguration.name}`
          } 
        }));
      }, 150);

    } catch (error) {
      console.error('Failed to run:', error);
      showNotification('Failed to run: ' + String(error), 'error');
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    if (runningProcessId) {
      try {
        await terminal.close(runningProcessId);
      } catch (error) {
        console.error('Failed to stop:', error);
      }
    }
    setIsRunning(false);
    window.dispatchEvent(new CustomEvent('run-stopped'));
  };

  const handleBuild = async () => {
    if (!projectInfo?.build_command || !currentWorkspace) {
      showNotification('No build command available for this project', 'error');
      return;
    }

    const terminalId = `build-${Date.now()}`;
    
    setShowBottomPanel(true);
    setActiveBottomTab('terminal');

    showNotification(`Building: ${projectInfo.build_command}`, 'success');

    // Wait for panel to render before dispatching event
    setTimeout(() => {
      // Emit event for terminal panel to create and run
      window.dispatchEvent(new CustomEvent('run-command', { 
        detail: { 
          terminalId, 
          command: projectInfo.build_command,
          cwd: currentWorkspace.rootPath,
          label: 'Build'
        } 
      }));
    }, 150);
  };

  const handleInstallDeps = async () => {
    if (!projectInfo?.install_command || !currentWorkspace) {
      showNotification('No install command available for this project', 'error');
      return;
    }

    const terminalId = `install-${Date.now()}`;
    
    setShowBottomPanel(true);
    setActiveBottomTab('terminal');

    showNotification(`Installing dependencies: ${projectInfo.install_command}`, 'success');

    // Wait for panel to render before dispatching event
    setTimeout(() => {
      // Emit event for terminal panel to create and run
      window.dispatchEvent(new CustomEvent('run-command', { 
        detail: { 
          terminalId, 
          command: projectInfo.install_command,
          cwd: currentWorkspace.rootPath,
          label: 'Install'
        } 
      }));
    }, 150);
  };

  const getProjectIcon = () => {
    switch (projectInfo.project_type) {
      case 'npm': return '📦';
      case 'cargo': return '🦀';
      case 'python': return '🐍';
      case 'go': return '🐹';
      case 'maven':
      case 'gradle': return '☕';
      case 'make':
      case 'cmake': return '⚙️';
      default: return '📁';
    }
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.projectBadge}>
        <span className={styles.projectIcon}>{getProjectIcon()}</span>
        <span className={styles.projectType}>{projectInfo.project_type}</span>
      </div>

      <div className={styles.configSelector} ref={dropdownRef}>
        <button 
          className={styles.configButton}
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <span className={styles.configName}>
            {activeConfiguration?.name || 'Select Configuration'}
          </span>
          <ChevronDown size={14} />
        </button>

        {showDropdown && (
          <div className={styles.dropdown}>
            {runConfigurations.map(config => (
              <button
                key={config.id}
                className={`${styles.dropdownItem} ${config.id === activeConfiguration?.id ? styles.active : ''}`}
                onClick={() => {
                  setActiveConfiguration(config);
                  setShowDropdown(false);
                }}
              >
                {config.name}
              </button>
            ))}
            {runConfigurations.length > 0 && <div className={styles.dropdownDivider} />}
            <button 
              className={styles.dropdownItem}
              onClick={() => {
                setShowDropdown(false);
                window.dispatchEvent(new CustomEvent('edit-run-configs'));
              }}
            >
              <Settings size={14} />
              Edit Configurations...
            </button>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {isRunning ? (
          <button 
            className={`${styles.actionButton} ${styles.stop}`}
            onClick={handleStop}
            title="Stop (Shift+F5)"
          >
            <Square size={16} />
          </button>
        ) : (
          <button 
            className={`${styles.actionButton} ${styles.run}`}
            onClick={handleRun}
            disabled={!activeConfiguration}
            title="Run (F5)"
          >
            <Play size={16} />
          </button>
        )}
      </div>

      {!projectInfo.dependencies_installed && projectInfo.install_command && (
        <button 
          className={styles.installButton}
          onClick={handleInstallDeps}
          title="Dependencies not installed"
        >
          Install Dependencies
        </button>
      )}
    </div>
  );
}
