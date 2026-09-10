/**
 * PRReviewInput Component
 * 
 * Allows users to select the source for PR review in Dev Team mode:
 * - Pull Request from GitHub/GitLab
 * - Single commit or commit range
 * - Local uncommitted changes
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest,
  GitCommit,
  FileDiff as FileDiffIcon,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useGitStore } from '../../store/gitStore';
import { useSettingsStore } from '../../store/settingsStore';
import { git, github, gitlab, GitHubPullRequest, FileDiff } from '../../services/tauri';
import {
  parseGitRemoteInfo,
  buildGitHubApiBase,
  buildGitLabApiBase,
  resolvePrProvider,
  parseOwnerRepo,
  buildDiffSectionFromFiles,
  buildDiffSectionFromText,
  appendSection,
  buildStructuredReviewPrompt,
  type DiffSectionTotals,
} from '../../utils/diffUtils';
import styles from './PRReviewInput.module.css';

export type ReviewSource = 'pr' | 'commit' | 'local';

export interface PRReviewData {
  source: ReviewSource;
  diffText: string;
  metadata: {
    // PR metadata
    prNumber?: number;
    prTitle?: string;
    prAuthor?: string;
    prBranch?: string;
    // Commit metadata
    commitHash?: string;
    commitMessage?: string;
    commitAuthor?: string;
    // Local metadata
    fileCount?: number;
  };
  prompt: string;
  truncated: boolean;
  skippedFiles: string[];
}

interface PRReviewInputProps {
  onDataReady: (data: PRReviewData) => void;
  disabled?: boolean;
}

export const PRReviewInput: React.FC<PRReviewInputProps> = ({
  onDataReady,
  disabled = false,
}) => {
  const { currentWorkspace } = useWorkspaceStore();
  const { isRepo, commitHistory, fetchCommitHistory } = useGitStore();
  const { githubToken, githubApiBase } = useSettingsStore();

  // UI State
  const [reviewSource, setReviewSource] = useState<ReviewSource>('local');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remote/PR State
  const [repoSlug, setRepoSlug] = useState('');
  const [repoHost, setRepoHost] = useState('');
  const [prProvider, setPrProvider] = useState<'auto' | 'github' | 'gitlab'>('auto');
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [prLoading, setPrLoading] = useState(false);

  // Commit State
  const [commitHash, setCommitHash] = useState('');
  const [commitMode, setCommitMode] = useState<'single' | 'range'>('single');
  const [selectedCommitId, setSelectedCommitId] = useState('');

  // Load git remote info
  useEffect(() => {
    if (!currentWorkspace?.rootPath) return;

    const loadRepoSlug = async () => {
      try {
        const remotes = await git.remotes(currentWorkspace.rootPath);
        const prioritized = [
          remotes.find((entry) => entry.name === 'origin'),
          ...remotes,
        ].filter((entry): entry is { name: string; url: string | null } => Boolean(entry));

        const parsedRemote = prioritized
          .map((entry) => (entry.url ? parseGitRemoteInfo(entry.url) : null))
          .find((entry) => entry);

        if (parsedRemote) {
          setRepoSlug(parsedRemote.slug);
          setRepoHost(parsedRemote.host);
        } else {
          setRepoSlug('');
          setRepoHost('');
        }
      } catch (err) {
        console.warn('Failed to load git remotes:', err);
        setRepoSlug('');
        setRepoHost('');
      }
    };

    loadRepoSlug();
  }, [currentWorkspace?.rootPath]);

  // Load commit history
  useEffect(() => {
    if (!currentWorkspace?.rootPath || !isRepo) return;
    if (commitHistory.length === 0) {
      fetchCommitHistory(30);
    }
  }, [currentWorkspace?.rootPath, isRepo, commitHistory.length, fetchCommitHistory]);

  // Clear PRs when repo changes
  useEffect(() => {
    setPullRequests([]);
    setSelectedPrNumber(null);
  }, [repoSlug]);

  const resolveApiBase = useCallback(() => {
    const override = githubApiBase.trim();
    return override ? override.replace(/\/+$/, '') : buildGitHubApiBase(repoHost);
  }, [githubApiBase, repoHost]);

  // Load pull requests
  const handleLoadPullRequests = useCallback(async () => {
    setError(null);
    const token = githubToken.trim();
    if (!token) {
      setError('Set a GitHub token in Settings > Git to load pull requests.');
      return;
    }
    if (!repoSlug.trim() || !repoHost.trim()) {
      setError('No Git remote found for this repository.');
      return;
    }
    const parsed = parseOwnerRepo(repoSlug.trim());
    if (!parsed) {
      setError('Remote must be in owner/repo format.');
      return;
    }

    setPrLoading(true);
    try {
      const provider = resolvePrProvider(repoHost, prProvider);
      const apiBase = provider === 'github'
        ? resolveApiBase()
        : buildGitLabApiBase(repoHost);
      const prs = provider === 'github'
        ? await github.listPullRequests(parsed.owner, parsed.repo, token, apiBase)
        : await gitlab.listMergeRequests(parsed.owner, parsed.repo, token, apiBase);
      setPullRequests(prs);
      setSelectedPrNumber(prs[0]?.number ?? null);
      if (prs.length === 0) {
        setError('No open pull requests found');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setPrLoading(false);
    }
  }, [githubToken, repoSlug, repoHost, prProvider, resolveApiBase]);

  // Build prompt from sections
  const buildPromptFromSections = useCallback((
    sections: string[],
    skippedFiles: string[],
    truncated: boolean
  ): string => {
    return buildStructuredReviewPrompt(sections, skippedFiles, truncated, 'combined');
  }, []);

  // Fetch and prepare PR data
  const handleFetchPR = useCallback(async () => {
    if (!currentWorkspace?.rootPath) return;
    
    const token = githubToken.trim();
    if (!token) {
      setError('Set a GitHub token in Settings > Git to review pull requests.');
      return;
    }

    const parsed = parseOwnerRepo(repoSlug.trim());
    if (!parsed) {
      setError('Remote must be in owner/repo format.');
      return;
    }

    const pr = pullRequests.find((entry) => entry.number === selectedPrNumber);
    if (!pr) {
      setError('Select a pull request to review.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const provider = resolvePrProvider(repoHost, prProvider);
      const apiBase = provider === 'github'
        ? resolveApiBase()
        : buildGitLabApiBase(repoHost);
      const diffText = provider === 'github'
        ? await github.pullRequestDiff(parsed.owner, parsed.repo, pr.number, token, apiBase)
        : await gitlab.mergeRequestDiff(parsed.owner, parsed.repo, pr.number, token, apiBase);

      // Build prompt
      const sections: string[] = [];
      const skippedFiles: string[] = [];
      const totals: DiffSectionTotals = { totalChars: 0, truncated: false, canContinue: true };

      const prInfo = [
        `Repository: ${repoSlug}`,
        `PR: #${pr.number} ${pr.title}`,
        `Author: ${pr.author}`,
        `Branch: ${pr.head_ref} → ${pr.base_ref}`,
        `Updated: ${pr.updated_at}`,
        pr.draft ? 'Draft: yes' : '',
      ].filter(Boolean).join('\n');

      appendSection(sections, 'Pull Request', prInfo, totals);
      const diffSection = buildDiffSectionFromText(diffText, skippedFiles, () => {
        totals.truncated = true;
      });
      appendSection(sections, 'Changes', diffSection, totals);

      if (sections.length === 0) {
        setError('No reviewable changes found');
        return;
      }

      const prompt = buildPromptFromSections(sections, skippedFiles, totals.truncated);

      onDataReady({
        source: 'pr',
        diffText,
        metadata: {
          prNumber: pr.number,
          prTitle: pr.title,
          prAuthor: pr.author,
          prBranch: `${pr.head_ref} → ${pr.base_ref}`,
        },
        prompt,
        truncated: totals.truncated,
        skippedFiles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace?.rootPath, githubToken, repoSlug, repoHost, prProvider, selectedPrNumber, pullRequests, resolveApiBase, buildPromptFromSections, onDataReady]);

  // Fetch and prepare commit data
  const handleFetchCommit = useCallback(async () => {
    if (!currentWorkspace?.rootPath) return;
    if (!commitHash.trim()) {
      setError('Enter a commit hash.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let diffText = '';
      let metadata: PRReviewData['metadata'] = {};
      const sections: string[] = [];
      const skippedFiles: string[] = [];
      const totals: DiffSectionTotals = { totalChars: 0, truncated: false, canContinue: true };

      if (commitMode === 'single') {
        const commit = await git.showCommit(currentWorkspace.rootPath, commitHash.trim());
        const details = [
          `Commit: ${commit.commit_id}`,
          `Author: ${commit.author} <${commit.email}>`,
          `Date: ${commit.timestamp}`,
          `Message: ${commit.message}`,
        ].join('\n');

        appendSection(sections, 'Commit', details, totals);
        const diffSection = buildDiffSectionFromFiles(commit.files, skippedFiles, () => {
          totals.truncated = true;
        });
        appendSection(sections, 'Changes', diffSection, totals);
        
        // Build diffText for storage
        diffText = commit.files.map(f => `${f.new_path || f.old_path}`).join('\n');
        metadata = {
          commitHash: commit.commit_id,
          commitMessage: commit.message,
          commitAuthor: commit.author,
        };
      } else {
        const diffResult = await git.diffSince(currentWorkspace.rootPath, commitHash.trim());
        const details = [
          `From: ${diffResult.from_commit}`,
          `To: ${diffResult.to_commit}`,
          `Commits: ${diffResult.commit_count}`,
        ].join('\n');

        appendSection(sections, 'Commit Range', details, totals);
        const diffSection = buildDiffSectionFromFiles(diffResult.files, skippedFiles, () => {
          totals.truncated = true;
        });
        appendSection(sections, 'Changes', diffSection, totals);

        diffText = diffResult.files.map(f => `${f.new_path || f.old_path}`).join('\n');
        metadata = {
          commitHash: `${diffResult.from_commit}..${diffResult.to_commit}`,
          fileCount: diffResult.files.length,
        };
      }

      if (sections.length === 0) {
        setError('No reviewable changes found');
        return;
      }

      const prompt = buildPromptFromSections(sections, skippedFiles, totals.truncated);

      onDataReady({
        source: 'commit',
        diffText,
        metadata,
        prompt,
        truncated: totals.truncated,
        skippedFiles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace?.rootPath, commitHash, commitMode, buildPromptFromSections, onDataReady]);

  // Fetch and prepare local changes
  const handleFetchLocal = useCallback(async () => {
    if (!currentWorkspace?.rootPath) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get uncommitted changes (staged + unstaged)
      const status = await git.status(currentWorkspace.rootPath);
      
      // Get all diffs (unstaged first, then staged)
      const unstagedDiffs = await git.diffAll(currentWorkspace.rootPath, false);
      const stagedDiffs = await git.diffAll(currentWorkspace.rootPath, true);
      const allDiffs = [...unstagedDiffs, ...stagedDiffs];
      
      if (allDiffs.length === 0) {
        setError('No uncommitted changes found');
        return;
      }

      const sections: string[] = [];
      const skippedFiles: string[] = [];
      const totals: DiffSectionTotals = { totalChars: 0, truncated: false, canContinue: true };

      const changesInfo = [
        `Workspace: ${currentWorkspace.name || currentWorkspace.rootPath}`,
        `Staged: ${status.staged.length} files`,
        `Unstaged: ${status.unstaged.length} files`,
        `Untracked: ${status.untracked.length} files`,
      ].join('\n');

      appendSection(sections, 'Local Changes', changesInfo, totals);
      const diffSection = buildDiffSectionFromFiles(allDiffs, skippedFiles, () => {
        totals.truncated = true;
      });
      appendSection(sections, 'Changes', diffSection, totals);

      if (sections.length === 0) {
        setError('No reviewable changes found');
        return;
      }

      const prompt = buildPromptFromSections(sections, skippedFiles, totals.truncated);

      // Build diffText for storage
      const diffText = allDiffs.map(d => d.new_path || d.old_path).join('\n');

      onDataReady({
        source: 'local',
        diffText,
        metadata: {
          fileCount: status.staged.length + status.unstaged.length,
        },
        prompt,
        truncated: totals.truncated,
        skippedFiles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace, buildPromptFromSections, onDataReady]);

  // Handle fetch based on source
  const handleFetch = useCallback(() => {
    switch (reviewSource) {
      case 'pr':
        handleFetchPR();
        break;
      case 'commit':
        handleFetchCommit();
        break;
      case 'local':
        handleFetchLocal();
        break;
    }
  }, [reviewSource, handleFetchPR, handleFetchCommit, handleFetchLocal]);

  const selectedPr = pullRequests.find((entry) => entry.number === selectedPrNumber);
  const commitItems = commitHistory.map((commit) => ({
    ...commit,
    shortId: commit.id.slice(0, 7),
    messageLine: commit.message.split('\n')[0] || 'No message',
  }));

  if (!currentWorkspace || !isRepo) {
    return (
      <div className={styles.prReviewInput}>
        <div className={styles.emptyState}>
          <GitPullRequest size={24} />
          <p>{!currentWorkspace ? 'Open a folder to review code' : 'This folder is not a Git repository'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.prReviewInput}>
      {/* Source Selector */}
      <div className={styles.sourceSelector}>
        <button
          className={`${styles.sourceButton} ${reviewSource === 'local' ? styles.sourceActive : ''}`}
          onClick={() => setReviewSource('local')}
          disabled={disabled}
        >
          <FileDiffIcon size={16} />
          Local Changes
        </button>
        <button
          className={`${styles.sourceButton} ${reviewSource === 'pr' ? styles.sourceActive : ''}`}
          onClick={() => setReviewSource('pr')}
          disabled={disabled}
        >
          <GitPullRequest size={16} />
          Pull Request
        </button>
        <button
          className={`${styles.sourceButton} ${reviewSource === 'commit' ? styles.sourceActive : ''}`}
          onClick={() => setReviewSource('commit')}
          disabled={disabled}
        >
          <GitCommit size={16} />
          Commit
        </button>
      </div>

      {/* Source-specific inputs */}
      <div className={styles.sourceContent}>
        {reviewSource === 'local' && (
          <div className={styles.localSection}>
            <p className={styles.sectionDescription}>
              Review your uncommitted changes (staged and unstaged).
            </p>
          </div>
        )}

        {reviewSource === 'pr' && (
          <div className={styles.prSection}>
            <div className={styles.repoInfo}>
              <span className={styles.label}>Repository:</span>
              <span className={styles.value}>
                {repoSlug && repoHost ? `${repoHost}/${repoSlug}` : 'No Git remote detected'}
              </span>
            </div>

            <div className={styles.providerRow}>
              <select
                className={styles.select}
                value={prProvider}
                onChange={(e) => setPrProvider(e.target.value as 'auto' | 'github' | 'gitlab')}
                disabled={disabled}
              >
                <option value="auto">Auto-detect</option>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </div>

            <div className={styles.prSelectRow}>
              <select
                className={styles.select}
                value={selectedPrNumber ?? ''}
                onChange={(e) => setSelectedPrNumber(e.target.value ? Number(e.target.value) : null)}
                disabled={disabled || pullRequests.length === 0}
              >
                <option value="">Select a pull request</option>
                {pullRequests.map((pr) => (
                  <option key={pr.number} value={pr.number}>
                    #{pr.number} {pr.title}
                  </option>
                ))}
              </select>
              <button
                className={styles.refreshButton}
                onClick={handleLoadPullRequests}
                disabled={disabled || prLoading}
                title="Load pull requests"
              >
                {prLoading ? <Loader2 size={14} className={styles.spinning} /> : <RefreshCw size={14} />}
              </button>
            </div>

            {selectedPr && (
              <div className={styles.prMeta}>
                <span>#{selectedPr.number} · {selectedPr.head_ref} → {selectedPr.base_ref}</span>
                {selectedPr.draft && <span className={styles.draftBadge}>Draft</span>}
              </div>
            )}

            {!githubToken.trim() && (
              <div className={styles.warning}>
                <AlertCircle size={14} />
                Add a GitHub/GitLab token in Settings &gt; Git to load PRs.
              </div>
            )}
          </div>
        )}

        {reviewSource === 'commit' && (
          <div className={styles.commitSection}>
            <div className={styles.inputRow}>
              <input
                className={styles.input}
                value={commitHash}
                onChange={(e) => {
                  setCommitHash(e.target.value);
                  setSelectedCommitId('');
                }}
                placeholder="Commit hash (e.g., a1b2c3d)"
                disabled={disabled}
              />
              <select
                className={styles.select}
                value={commitMode}
                onChange={(e) => setCommitMode(e.target.value as 'single' | 'range')}
                disabled={disabled}
              >
                <option value="single">Single commit</option>
                <option value="range">Commit to HEAD</option>
              </select>
            </div>

            {commitItems.length > 0 && (
              <div className={styles.commitList}>
                {commitItems.slice(0, 10).map((commit) => (
                  <button
                    key={commit.id}
                    className={`${styles.commitItem} ${selectedCommitId === commit.id ? styles.commitActive : ''}`}
                    onClick={() => {
                      setSelectedCommitId(commit.id);
                      setCommitHash(commit.id);
                    }}
                    disabled={disabled}
                  >
                    <div className={styles.commitHeader}>
                      <span className={styles.commitId}>{commit.shortId}</span>
                      <span className={styles.commitDate}>
                        {new Date(commit.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={styles.commitMessage}>{commit.messageLine}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className={styles.error}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Fetch button */}
      <button
        className={styles.fetchButton}
        onClick={handleFetch}
        disabled={disabled || isLoading || (reviewSource === 'pr' && !selectedPrNumber) || (reviewSource === 'commit' && !commitHash.trim())}
      >
        {isLoading ? (
          <>
            <Loader2 size={16} className={styles.spinning} />
            Fetching changes...
          </>
        ) : (
          <>
            <Check size={16} />
            Fetch & Prepare Review
          </>
        )}
      </button>
    </div>
  );
};

export default PRReviewInput;
