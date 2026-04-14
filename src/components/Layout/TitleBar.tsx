import { useWorkspaceStore } from '../../store/workspaceStore';
import styles from './TitleBar.module.css';

export function TitleBar() {
  const { currentWorkspace } = useWorkspaceStore();

  const workspaceName = currentWorkspace?.name || 'OpenCodeBrew';
  const workspacePath = currentWorkspace?.rootPath || '';

  return (
    <div className={styles.titleBar}>
      <div className={styles.trafficLightSpace} />
      <div className={styles.title}>
        <span className={styles.name}>{workspaceName}</span>
        {workspacePath && (
          <span className={styles.path}> — {workspacePath}</span>
        )}
      </div>
      <div className={styles.actions} />
    </div>
  );
}
