import { useState, useEffect, useRef, useMemo } from 'react';
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
import { useLayoutStore } from '../../store/layoutStore';
import { useAIStore } from '../../store/aiStore';
import type { AIProvider } from '../../store/aiStore';
import { git, fs, FileDiff } from '../../services/tauri';
import styles from './GitPanel.module.css';

const PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'copilot', label: 'GitHub Copilot' },
  { value: 'custom', label: 'Custom Endpoint' },
];

const MAX_TOTAL_CHARS = 60000;
const MAX_FILE_DIFF_CHARS = 8000;
const MAX_UNTRACKED_FILE_CHARS = 6000;
const MAX_UNTRACKED_FILE_BYTES = 200 * 1024;
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'zip', 'tar', 'gz', '7z',
  'ico', 'icns', 'mp4', 'mov', 'mp3', 'wav', 'ttf', 'otf', 'woff', 'woff2',
]);
const SENSITIVE_PATH_PATTERNS = [
  /\.env/i,
  /secret/i,
  /credential/i,
  /token/i,
  /api[-_]?key/i,
  /private/i,
];

const isSensitivePath = (filePath: string): boolean => {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
};

const isBinaryPath = (filePath: string): boolean => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
};

const normalizeLine = (content: string): string => {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
};

const formatFileDiff = (diff: FileDiff): string => {
  const filePath = diff.new_path || diff.old_path || 'unknown';
  const oldPath = diff.old_path || filePath;
  const newPath = diff.new_path || filePath;
  const header = `diff --git a/${oldPath} b/${newPath}\n--- a/${oldPath}\n+++ b/${newPath}\n`;
  const hunks = diff.hunks.map((hunk) => {
    const lines = hunk.lines.map((line) => {
      const prefix = line.line_type === 'addition'
        ? '+'
        : line.line_type === 'deletion'
        ? '-'
        : ' ';
      return `${prefix}${normalizeLine(line.content)}`;
    });
    return [hunk.header, ...lines].join('\n');
  }).join('\n');
  return `${header}${hunks}`;
};

export function GitPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const { openDiff } = useEditorStore();
  const { setActiveSideTab } = useLayoutStore();
  const { config: aiConfig, availableModels, sendMessage, queuePrompt, isStreaming, agentMode, setAgentMode, createConversation } = useAIStore();
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
    aheadCount,
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
  const [reviewProvider, setReviewProvider] = useState<AIProvider>(aiConfig.provider);
  const [reviewModel, setReviewModel] = useState(aiConfig.model);
  const [reviewUsePlanMode, setReviewUsePlanMode] = useState(true);
  const [isReviewing, setIsReviewing] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  const reviewModelOptions = useMemo(() => {
    const models = availableModels[reviewProvider] || [];
    const fallback = reviewProvider === aiConfig.provider && aiConfig.model ? [aiConfig.model] : [];
    return Array.from(new Set(models.length > 0 ? models : fallback));
  }, [availableModels, aiConfig.model, aiConfig.provider, reviewProvider]);

  useEffect(() => {
    if (reviewModelOptions.length === 0) {
      setReviewModel('');
      return;
    }
    if (reviewModelOptions.length > 0 && !reviewModelOptions.includes(reviewModel)) {
      setReviewModel(reviewModelOptions[0]);
    }
  }, [reviewModel, reviewModelOptions]);

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

  const showNotification = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    window.dispatchEvent(new CustomEvent('show-notification', { detail: { message, type } }));
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

  const handleViewDiff = (file: GitFile) => {
    if (currentWorkspace?.rootPath) {
      openDiff(currentWorkspace.rootPath, file.path, file.staged, file.status);
    }
  };

  const buildReviewPrompt = async (): Promise<{ prompt: string; truncated: boolean } | null> => {
    if (!currentWorkspace?.rootPath) return null;
    const repoPath = currentWorkspace.rootPath;
    const [stagedDiffs, unstagedDiffs] = await Promise.all([
      git.diffAll(repoPath, true),
      git.diffAll(repoPath, false),
    ]);
    const untrackedFiles = unstagedFiles.filter((file) => file.status === 'untracked');
    const skippedFiles: string[] = [];
    let truncated = false;
    let totalChars = 0;
    let canContinue = true;
    const sections: string[] = [];

    const appendSection = (title: string, body: string) => {
      if (!body.trim() || !canContinue) return;
      const section = `## ${title}\n${body}`;
      if (totalChars + section.length <= MAX_TOTAL_CHARS) {
        sections.push(section);
        totalChars += section.length;
        return;
      }
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining > 0) {
        sections.push(`${section.slice(0, remaining)}\n...[truncated]`);
      }
      truncated = true;
      canContinue = false;
    };

    const buildDiffSection = (diffs: FileDiff[]) => {
      const parts: string[] = [];
      diffs.forEach((diff) => {
        const filePath = diff.new_path || diff.old_path || 'unknown';
        if (isSensitivePath(filePath) || isBinaryPath(filePath)) {
          skippedFiles.push(filePath);
          return;
        }
        let diffText = formatFileDiff(diff);
        if (diffText.length > MAX_FILE_DIFF_CHARS) {
          diffText = `${diffText.slice(0, MAX_FILE_DIFF_CHARS)}\n...[truncated]`;
          truncated = true;
        }
        parts.push(diffText);
      });
      return parts.join('\n\n');
    };

    const stagedSection = buildDiffSection(stagedDiffs);
    appendSection('Staged Changes', stagedSection);

    const unstagedSection = buildDiffSection(unstagedDiffs);
    appendSection('Unstaged Changes', unstagedSection);

    if (canContinue && untrackedFiles.length > 0) {
      const fileEntries: string[] = [];
      const headerOverhead = '## Untracked Files\n'.length;
      let sectionChars = 0;
      const remaining = MAX_TOTAL_CHARS - totalChars - headerOverhead;
      if (remaining <= 0) {
        truncated = true;
        canContinue = false;
      }
      for (const file of untrackedFiles) {
        if (!canContinue) break;
        if (isSensitivePath(file.path) || isBinaryPath(file.path)) {
          skippedFiles.push(file.path);
          continue;
        }
        const fullPath = `${repoPath}/${file.path}`;
        try {
          const info = await fs.getFileInfo(fullPath);
          if (info.size > MAX_UNTRACKED_FILE_BYTES) {
            skippedFiles.push(file.path);
            truncated = true;
            continue;
          }
          const content = await fs.readFile(fullPath);
          if (content.includes('\u0000')) {
            skippedFiles.push(file.path);
            continue;
          }
          let safeContent = content;
          if (safeContent.length > MAX_UNTRACKED_FILE_CHARS) {
            safeContent = `${safeContent.slice(0, MAX_UNTRACKED_FILE_CHARS)}\n...[truncated]`;
            truncated = true;
          }
          const entry = `### ${file.path}\n\`\`\`\n${safeContent}\n\`\`\``;
          if (sectionChars + entry.length > remaining) {
            truncated = true;
            canContinue = false;
            break;
          }
          sectionChars += entry.length;
          fileEntries.push(entry);
        } catch (error) {
          console.error('Failed to read untracked file:', error);
          skippedFiles.push(file.path);
        }
      }
      appendSection('Untracked Files', fileEntries.join('\n\n'));
    }

    if (sections.length === 0) {
      return null;
    }

    const skippedSection = skippedFiles.length > 0
      ? `\n\nSkipped files:\n${skippedFiles.map((filePath) => `- ${filePath}`).join('\n')}`
      : '';
    const truncationNotice = truncated
      ? '\n\nNote: Some diffs or files were truncated to fit size limits.'
      : '';

    const prompt = [
      'Review the changes below.',
      'Provide findings ordered by severity with file paths.',
      'If no issues, say so and mention test gaps.',
      'If fixes are needed, include a checklist titled "Review Fix Plan" with actionable tasks.',
      'Be ready to revise the checklist if the user asks to add/remove tasks.',
      '',
      sections.join('\n\n'),
      skippedSection + truncationNotice,
    ].join('\n');

    return { prompt, truncated };
  };

  const handleReviewChanges = async () => {
    if (!currentWorkspace?.rootPath) return;
    if (stagedFiles.length + unstagedFiles.length === 0) {
      showNotification('No changes to review yet', 'info');
      return;
    }
    if (reviewModelOptions.length === 0 || !reviewModel) {
      showNotification('Select a model before reviewing', 'info');
      return;
    }
    setIsReviewing(true);
    try {
      const result = await buildReviewPrompt();
      if (!result) {
        showNotification('No reviewable changes found', 'info');
        return;
      }
      if (reviewUsePlanMode && agentMode !== 'plan') {
        setAgentMode('plan');
      }
      createConversation();
      setActiveSideTab('ai');
      if (result.truncated) {
        showNotification('Review diff truncated to fit size limits', 'info');
      }
      if (isStreaming) {
        queuePrompt(result.prompt, undefined, { model: reviewModel, provider: reviewProvider });
        showNotification('Review queued in AI panel', 'info');
      } else {
        await sendMessage(result.prompt, undefined, { model: reviewModel, provider: reviewProvider });
      }
    } catch (error) {
      console.error('Failed to prepare review:', error);
      showNotification('Failed to prepare code review', 'error');
    } finally {
      setIsReviewing(false);
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
            disabled={isPulling || isPushing || aheadCount === 0}
            title={aheadCount > 0 ? `Push (${aheadCount} commit${aheadCount > 1 ? 's' : ''} ahead)` : "Push (nothing to push)"}
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
        <div className={styles.reviewBox}>
          <div className={styles.reviewHeader}>Review Changes</div>
          <div className={styles.reviewControls}>
            <div className={styles.reviewRow}>
              <select
                className={styles.reviewSelect}
                value={reviewProvider}
                onChange={(e) => setReviewProvider(e.target.value as AIProvider)}
              >
                {PROVIDER_OPTIONS.map((provider) => (
                  <option key={provider.value} value={provider.value}>{provider.label}</option>
                ))}
              </select>
            </div>
            <label className={styles.reviewToggle}>
              <input
                type="checkbox"
                checked={reviewUsePlanMode}
                onChange={(e) => setReviewUsePlanMode(e.target.checked)}
              />
              <span>Plan mode output</span>
            </label>
            <div className={styles.reviewRow}>
              <select
                className={styles.reviewSelect}
                value={reviewModel}
                onChange={(e) => setReviewModel(e.target.value)}
                disabled={reviewModelOptions.length === 0}
              >
                {reviewModelOptions.length === 0 && (
                  <option value="">No models available</option>
                )}
                {reviewModelOptions.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <button
                className={styles.reviewBtn}
                onClick={handleReviewChanges}
                disabled={isReviewing || stagedFiles.length + unstagedFiles.length === 0 || !reviewModel}
              >
                {isReviewing ? 'Reviewing...' : 'Review'}
              </button>
            </div>
          </div>
        </div>
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
                    onViewDiff={() => handleViewDiff(file)}
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
                    onViewDiff={() => handleViewDiff(file)}
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
