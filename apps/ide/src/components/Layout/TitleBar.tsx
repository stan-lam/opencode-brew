import { Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import styles from './TitleBar.module.css';

export function TitleBar() {
  const { currentWorkspace } = useWorkspaceStore();

  const workspaceName = currentWorkspace?.name || 'OpenCodeBrew';
  const workspacePath = currentWorkspace?.rootPath || '';

  const handleNewWindow = async () => {
    try {
      const label = `ide-${Date.now()}`;
      await invoke('open_tool_window', { tool: 'ide', label, title: 'OpenCodeBrew' });
    } catch (error) {
      console.error('Error opening new window:', error);
    }
  };

  return (
    <div className={styles.titleBar}>
      <div className={styles.trafficLightSpace} />
      <div className={styles.title}>
        <span className={styles.name}>{workspaceName}</span>
        {workspacePath && (
          <span className={styles.path}> — {workspacePath}</span>
        )}
      </div>
      <div className={styles.actions}>
        <button 
          className={styles.actionButton} 
          onClick={handleNewWindow}
          title="New Window (⌘⇧N)"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
