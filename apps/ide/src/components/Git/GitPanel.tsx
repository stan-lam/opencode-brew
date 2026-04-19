import { useState, useEffect } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Plus,
  Minus,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Upload,
  Download,
} from 'lucide-react';
import { useGitStore, GitFile } from '../../store/gitStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useEditorStore } from '../../store/editorStore';
import styles from './GitPanel.module.css';

export function GitPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const { openDiff } = useEditorStore();
  const {
    isRepo,
    currentBranch,
    branches,
    stagedFiles,
    unstagedFiles,
    isLoading,
    isPushing,
    isPulling,
    error,
    refreshStatus,
    initializeRepo,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    pull,
    push,
  } = useGitStore();

  const [commitMessage, setCommitMessage] = useState('');
  const [showStaged, setShowStaged] = useState(true);
  const [showUnstaged, setShowUnstaged] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (currentWorkspace?.rootPath) {
      refreshStatus();
    }
  }, [currentWorkspace?.rootPath, refreshStatus]);

  const handleInitRepo = async () => {
    setIsInitializing(true);
    try {
      await initializeRepo();
    } finally {
      setIsInitializing(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    await commit(commitMessage);
    setCommitMessage('');
  };

  const handlePull = async () => {
    try {
      const result = await pull();
      setStatusMessage(result);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Pull failed: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handlePush = async () => {
    try {
      const result = await push();
      setStatusMessage(result);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Push failed: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className={styles.empty}>
        <GitBranch size={32} />
        <p>Open a folder to use Git features</p>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className={styles.empty}>
        <GitBranch size={32} />
        <p>This folder is not a Git repository</p>
        <button 
          className={styles.initBtn}
          onClick={handleInitRepo}
          disabled={isInitializing || isLoading}
        >
          {isInitializing ? (
            <>
              <RefreshCw size={14} className={styles.spinner} />
              Initializing...
            </>
          ) : (
            <>
              <Plus size={14} />
              Initialize Repository
            </>
          )}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  const handleViewDiff = (filePath: string, staged: boolean) => {
    if (currentWorkspace?.rootPath) {
      openDiff(currentWorkspace.rootPath, filePath, staged);
    }
  };

  return (
    <div className={styles.gitPanel}>
      <div className={styles.header}>
        <div className={styles.branchSelector}>
          <GitBranch size={14} />
          <span>{currentBranch || 'main'}</span>
          <ChevronDown size={14} />
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.actionBtn} 
            onClick={handlePull}
            disabled={isPulling || isPushing}
            title="Pull"
          >
            {isPulling ? <RefreshCw size={16} className={styles.spinner} /> : <Download size={16} />}
          </button>
          <button 
            className={styles.actionBtn} 
            onClick={handlePush}
            disabled={isPulling || isPushing}
            title="Push"
          >
            {isPushing ? <RefreshCw size={16} className={styles.spinner} /> : <Upload size={16} />}
          </button>
          <button
            className={styles.actionBtn}
            onClick={refreshStatus}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw size={16} className={isLoading ? styles.spinner : ''} />
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className={styles.statusMessage}>{statusMessage}</div>
      )}

      {error && (
        <div className={styles.errorMessage}>{error}</div>
      )}

      <div className={styles.commitBox}>
        <textarea
          className={styles.commitInput}
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          rows={3}
        />
        <button
          className={styles.commitBtn}
          onClick={handleCommit}
          disabled={!commitMessage.trim() || stagedFiles.length === 0}
        >
          <Check size={14} />
          Commit
        </button>
      </div>

      <div className={styles.changes}>
        <div className={styles.section}>
          <div
            className={styles.sectionHeader}
            onClick={() => setShowStaged(!showStaged)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setShowStaged(!showStaged)}
          >
            {showStaged ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Staged Changes</span>
            <span className={styles.count}>{stagedFiles.length}</span>
            {stagedFiles.length > 0 && (
              <button
                className={styles.sectionAction}
                onClick={(e) => {
                  e.stopPropagation();
                  unstageAll();
                }}
                title="Unstage All"
              >
                <Minus size={12} />
              </button>
            )}
          </div>
          {showStaged && (
            <div className={styles.fileList}>
              {stagedFiles.length === 0 ? (
                <p className={styles.emptyText}>No staged changes</p>
              ) : (
                stagedFiles.map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    onAction={() => unstageFile(file.path)}
                    onViewDiff={() => handleViewDiff(file.path, true)}
                    actionIcon={<Minus size={12} />}
                    actionTitle="Unstage"
                  />
                ))
              )}
            </div>
          )}
        </div>

        <div className={styles.section}>
          <div
            className={styles.sectionHeader}
            onClick={() => setShowUnstaged(!showUnstaged)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setShowUnstaged(!showUnstaged)}
          >
            {showUnstaged ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Changes</span>
            <span className={styles.count}>{unstagedFiles.length}</span>
            {unstagedFiles.length > 0 && (
              <button
                className={styles.sectionAction}
                onClick={(e) => {
                  e.stopPropagation();
                  stageAll();
                }}
                title="Stage All"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          {showUnstaged && (
            <div className={styles.fileList}>
              {unstagedFiles.length === 0 ? (
                <p className={styles.emptyText}>No changes</p>
              ) : (
                unstagedFiles.map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    onAction={() => stageFile(file.path)}
                    onViewDiff={() => handleViewDiff(file.path, false)}
                    actionIcon={<Plus size={12} />}
                    actionTitle="Stage"
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileItemProps {
  file: GitFile;
  onAction: () => void;
  onViewDiff: () => void;
  actionIcon: React.ReactNode;
  actionTitle: string;
}

function FileItem({ file, onAction, onViewDiff, actionIcon, actionTitle }: FileItemProps) {
  const statusColors: Record<string, string> = {
    modified: 'var(--accent-yellow)',
    added: 'var(--accent-green)',
    deleted: 'var(--accent-red)',
    untracked: 'var(--accent-green)',
    renamed: 'var(--accent-purple)',
  };

  const statusLabels: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    untracked: 'U',
    renamed: 'R',
  };

  return (
    <div className={styles.fileItem} onClick={onViewDiff}>
      <span
        className={styles.fileStatus}
        style={{ color: statusColors[file.status] }}
      >
        {statusLabels[file.status]}
      </span>
      <span className={styles.fileName}>{file.path.split('/').pop()}</span>
      <span className={styles.filePath}>{file.path}</span>
      <button
        className={styles.fileAction}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        title={actionTitle}
      >
        {actionIcon}
      </button>
    </div>
  );
}
