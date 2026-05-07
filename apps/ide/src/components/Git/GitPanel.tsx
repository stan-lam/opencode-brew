import { useState, useEffect, useRef } from 'react';
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
  Trash2,
  RotateCcw,
  History,
  Archive,
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
    commitHistory,
    stashes,
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
    checkout,
    createBranch,
    deleteBranch,
    discardChanges,
    fetchCommitHistory,
    stash,
    stashPop,
    fetchStashes,
    pull,
    push,
  } = useGitStore();

  const [commitMessage, setCommitMessage] = useState('');
  const [showStaged, setShowStaged] = useState(true);
  const [showUnstaged, setShowUnstaged] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showStashes, setShowStashes] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentWorkspace?.rootPath) {
      refreshStatus();
      fetchCommitHistory(20);
      fetchStashes();
    }
  }, [currentWorkspace?.rootPath, refreshStatus, fetchCommitHistory, fetchStashes]);

  // Auto-refresh git status periodically, on window focus, and on file save
  useEffect(() => {
    if (!currentWorkspace?.rootPath) return;

    // Refresh when window gains focus (user switches back to app)
    const handleFocus = () => {
      refreshStatus();
    };
    window.addEventListener('focus', handleFocus);

    // Refresh when a file is saved
    const handleFileSaved = () => {
      // Debounce - wait a bit for any pending saves
      setTimeout(() => {
        const { isLoading, isPushing, isPulling } = useGitStore.getState();
        if (!isLoading && !isPushing && !isPulling) {
          refreshStatus();
        }
      }, 500);
    };
    window.addEventListener('file-saved', handleFileSaved);

    // Periodic refresh every 30 seconds as fallback
    const intervalId = setInterval(() => {
      const { isLoading, isPushing, isPulling } = useGitStore.getState();
      if (!isLoading && !isPushing && !isPulling) {
        refreshStatus();
      }
    }, 30000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('file-saved', handleFileSaved);
      clearInterval(intervalId);
    };
  }, [currentWorkspace?.rootPath, refreshStatus]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const handleCheckout = async (branch: string) => {
    try {
      await checkout(branch);
      setShowBranchDropdown(false);
      setStatusMessage(`Switched to ${branch}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Checkout failed: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      await createBranch(newBranchName.trim(), true);
      setNewBranchName('');
      setShowNewBranchInput(false);
      setShowBranchDropdown(false);
      setStatusMessage(`Created and switched to ${newBranchName}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Failed to create branch: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleDeleteBranch = async (branch: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (branch === currentBranch) return;
    if (!confirm(`Delete branch "${branch}"?`)) return;
    try {
      await deleteBranch(branch);
      setStatusMessage(`Deleted branch ${branch}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Failed to delete: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleDiscardChanges = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Discard all changes to "${filePath}"?`)) return;
    try {
      await discardChanges(filePath);
      setStatusMessage('Changes discarded');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Failed to discard: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleStash = async () => {
    try {
      await stash();
      setStatusMessage('Changes stashed');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Stash failed: ${error}`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleStashPop = async (index: number) => {
    try {
      await stashPop(index);
      setStatusMessage('Stash applied');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage(`Failed to apply stash: ${error}`);
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
        <div className={styles.branchSelectorWrapper} ref={branchDropdownRef}>
          <button 
            className={styles.branchSelector}
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
          >
            <GitBranch size={14} />
            <span>{currentBranch || 'main'}</span>
            <ChevronDown size={14} />
          </button>
          {showBranchDropdown && (
            <div className={styles.branchDropdown}>
              <div className={styles.branchDropdownHeader}>
                <span>Branches</span>
                <button 
                  className={styles.newBranchBtn}
                  onClick={() => setShowNewBranchInput(!showNewBranchInput)}
                  title="New Branch"
                >
                  <Plus size={14} />
                </button>
              </div>
              {showNewBranchInput && (
                <div className={styles.newBranchInput}>
                  <input
                    type="text"
                    placeholder="Branch name..."
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
                    autoFocus
                  />
                  <button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
                    <Check size={14} />
                  </button>
                </div>
              )}
              <div className={styles.branchList}>
                {branches.map((branch) => (
                  <div
                    key={branch}
                    className={`${styles.branchItem} ${branch === currentBranch ? styles.activeBranch : ''}`}
                    onClick={() => branch !== currentBranch && handleCheckout(branch)}
                  >
                    <span>{branch}</span>
                    {branch === currentBranch && <Check size={12} />}
                    {branch !== currentBranch && (
                      <button 
                        className={styles.deleteBranchBtn}
                        onClick={(e) => handleDeleteBranch(branch, e)}
                        title="Delete branch"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.actionBtn} 
            onClick={handleStash}
            disabled={isLoading || (stagedFiles.length === 0 && unstagedFiles.length === 0)}
            title="Stash Changes"
          >
            <Archive size={16} />
          </button>
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
                    onDiscard={(e) => handleDiscardChanges(file.path, e)}
                    actionIcon={<Plus size={12} />}
                    actionTitle="Stage"
                    showDiscard
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Stashes Section */}
        {stashes.length > 0 && (
          <div className={styles.section}>
            <div
              className={styles.sectionHeader}
              onClick={() => setShowStashes(!showStashes)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setShowStashes(!showStashes)}
            >
              {showStashes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Archive size={14} />
              <span>Stashes</span>
              <span className={styles.count}>{stashes.length}</span>
            </div>
            {showStashes && (
              <div className={styles.stashList}>
                {stashes.map((stash) => (
                  <div key={stash.index} className={styles.stashItem}>
                    <span className={styles.stashMessage}>{stash.message}</span>
                    <button
                      className={styles.stashAction}
                      onClick={() => handleStashPop(stash.index)}
                      title="Apply stash"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Commit History Section */}
        <div className={styles.section}>
          <div
            className={styles.sectionHeader}
            onClick={() => setShowHistory(!showHistory)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setShowHistory(!showHistory)}
          >
            {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <History size={14} />
            <span>Commit History</span>
          </div>
          {showHistory && (
            <div className={styles.historyList}>
              {commitHistory.length === 0 ? (
                <p className={styles.emptyText}>No commits yet</p>
              ) : (
                commitHistory.map((commit) => (
                  <div key={commit.id} className={styles.historyItem}>
                    <div className={styles.commitHeader}>
                      <span className={styles.commitId}>{commit.id.slice(0, 7)}</span>
                      <span className={styles.commitDate}>
                        {new Date(commit.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={styles.commitMessage}>{commit.message.split('\n')[0]}</div>
                    <div className={styles.commitAuthor}>{commit.author}</div>
                  </div>
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
  onDiscard?: (e: React.MouseEvent) => void;
  actionIcon: React.ReactNode;
  actionTitle: string;
  showDiscard?: boolean;
}

function FileItem({ file, onAction, onViewDiff, onDiscard, actionIcon, actionTitle, showDiscard }: FileItemProps) {
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
      <div className={styles.fileActions}>
        {showDiscard && onDiscard && (
          <button
            className={styles.fileAction}
            onClick={onDiscard}
            title="Discard Changes"
          >
            <RotateCcw size={12} />
          </button>
        )}
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
    </div>
  );
}
