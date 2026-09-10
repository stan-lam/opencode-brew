import { useEffect, useMemo, useState } from 'react';
import {
  GitPullRequest,
  GitCommit,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useGitStore } from '../../store/gitStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useAIStore } from '../../store/aiStore';
import type { AIProvider } from '../../store/aiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { git, github, gitlab, GitHubPullRequest } from '../../services/tauri';
import type { FileDiff } from '../../services/tauri';
import {
  MAX_TOTAL_CHARS,
  parseGitRemoteInfo,
  buildGitHubApiBase,
  buildGitLabApiBase,
  resolvePrProvider,
  parseOwnerRepo,
  buildDiffSectionFromFiles,
  buildDiffSectionFromText,
  appendSection,
  buildReviewPrompt,
  type DiffSectionTotals,
} from '../../utils/diffUtils';
import styles from './CodeReviewPanel.module.css';

const COPILOT_MODEL_LABELS: Record<string, string> = {
  auto: 'Auto (Variable)',
  'claude-haiku-4.5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4.5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6 - Medium - 264K',
  'gpt-5-mini': 'GPT-5 mini - Medium - 192K',
  'gpt-5.3-codex': 'GPT-5.3-Codex - Medium - 400K',
};

const formatModelLabel = (provider: AIProvider, model: string) => {
  if (provider === 'copilot') {
    return COPILOT_MODEL_LABELS[model] ?? model;
  }
  return model;
};

export function CodeReviewPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const { isRepo, refreshStatus, commitHistory, fetchCommitHistory } = useGitStore();
  const { setShowAIPanel } = useLayoutStore();
  const {
    config: aiConfig,
    availableModels,
    sendMessage,
    queuePrompt,
    isStreaming,
    agentMode,
    setAgentMode,
    createConversation,
  } = useAIStore();
  const { githubToken, githubApiBase } = useSettingsStore();

  const [reviewMode, setReviewMode] = useState<'pr' | 'commit'>('pr');
  const [repoSlug, setRepoSlug] = useState('');
  const [repoHost, setRepoHost] = useState('');
  const [prProvider, setPrProvider] = useState<'auto' | 'github' | 'gitlab'>('auto');
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);

  const [commitHash, setCommitHash] = useState('');
  const [selectedCommitId, setSelectedCommitId] = useState('');
  const [commitMode, setCommitMode] = useState<'single' | 'range'>('single');
  const [commitError, setCommitError] = useState<string | null>(null);

  const [reviewProvider, setReviewProvider] = useState<AIProvider>(aiConfig.provider);
  const [reviewModel, setReviewModel] = useState(aiConfig.model);
  const [reviewUsePlanMode, setReviewUsePlanMode] = useState(true);
  const [isReviewing, setIsReviewing] = useState(false);

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
    if (!currentWorkspace?.rootPath) return;
    refreshStatus();
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
      } catch (error) {
        console.warn('Failed to load git remotes:', error);
        setRepoSlug('');
        setRepoHost('');
      }
    };
    loadRepoSlug();
  }, [currentWorkspace?.rootPath, refreshStatus]);

  useEffect(() => {
    if (!currentWorkspace?.rootPath || !isRepo) return;
    if (commitHistory.length === 0) {
      fetchCommitHistory(30);
    }
  }, [currentWorkspace?.rootPath, isRepo, commitHistory.length, fetchCommitHistory]);

  useEffect(() => {
    setPullRequests([]);
    setSelectedPrNumber(null);
  }, [repoSlug]);

  const showNotification = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    window.dispatchEvent(new CustomEvent('show-notification', { detail: { message, type } }));
  };

  const buildPullRequestPrompt = (
    pr: GitHubPullRequest,
    diffText: string
  ): { prompt: string; truncated: boolean } | null => {
    const sections: string[] = [];
    const skippedFiles: string[] = [];
    const totals: DiffSectionTotals = { totalChars: 0, truncated: false, canContinue: true };
    const repoDisplay = repoSlug || 'unknown';
    const prInfo = [
      `Repository: ${repoDisplay}`,
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

    if (sections.length === 0) return null;
    return { prompt: buildReviewPrompt(sections, skippedFiles, totals.truncated), truncated: totals.truncated };
  };

  const buildCommitPrompt = (
    title: string,
    details: string,
    diffs: FileDiff[]
  ): { prompt: string; truncated: boolean } | null => {
    const sections: string[] = [];
    const skippedFiles: string[] = [];
    const totals: DiffSectionTotals = { totalChars: 0, truncated: false, canContinue: true };

    appendSection(sections, title, details, totals);
    const diffSection = buildDiffSectionFromFiles(diffs, skippedFiles, () => {
      totals.truncated = true;
    });
    appendSection(sections, 'Changes', diffSection, totals);

    if (sections.length === 0) return null;
    return { prompt: buildReviewPrompt(sections, skippedFiles, totals.truncated), truncated: totals.truncated };
  };

  const resolveGitHubApiBase = () => {
    const override = githubApiBase.trim();
    return override ? override.replace(/\/+$/, '') : buildGitHubApiBase(repoHost);
  };

  const handleLoadPullRequests = async () => {
    setPrError(null);
    const token = githubToken.trim();
    if (!token) {
      setPrError('Set a GitHub token in Settings > Git to load pull requests.');
      return;
    }
    if (!repoSlug.trim() || !repoHost.trim()) {
      setPrError('No Git remote found for this repository.');
      return;
    }
    const parsed = parseOwnerRepo(repoSlug.trim());
    if (!parsed) {
      setPrError('Remote must be in owner/repo format.');
      return;
    }
    setPrLoading(true);
    try {
      const provider = resolvePrProvider(repoHost, prProvider);
      const apiBase = provider === 'github'
        ? resolveGitHubApiBase()
        : buildGitLabApiBase(repoHost);
      const prs = provider === 'github'
        ? await github.listPullRequests(parsed.owner, parsed.repo, token, apiBase)
        : await gitlab.listMergeRequests(parsed.owner, parsed.repo, token, apiBase);
      setPullRequests(prs);
      setSelectedPrNumber(prs[0]?.number ?? null);
      if (prs.length === 0) {
        showNotification('No open pull requests found', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPrError(message);
    } finally {
      setPrLoading(false);
    }
  };

  const handleReviewPrompt = async (result: { prompt: string; truncated: boolean }) => {
    if (reviewUsePlanMode && agentMode !== 'plan') {
      setAgentMode('plan');
    }
    createConversation();
    setShowAIPanel(true);
    if (result.truncated) {
      showNotification('Review diff truncated to fit size limits', 'info');
    }
    if (isStreaming) {
      queuePrompt(result.prompt, undefined, { model: reviewModel, provider: reviewProvider });
      showNotification('Review queued in AI panel', 'info');
    } else {
      await sendMessage(result.prompt, undefined, { model: reviewModel, provider: reviewProvider });
    }
  };

  const handleReviewPullRequest = async () => {
    setPrError(null);
    if (!currentWorkspace?.rootPath) return;
    if (!repoSlug.trim() || !repoHost.trim()) {
      setPrError('No Git remote found for this repository.');
      return;
    }
    const token = githubToken.trim();
    if (!token) {
      setPrError('Set a GitHub token in Settings > Git to review pull requests.');
      return;
    }
    const parsed = parseOwnerRepo(repoSlug.trim());
    if (!parsed) {
      setPrError('Remote must be in owner/repo format.');
      return;
    }
    const pr = pullRequests.find((entry) => entry.number === selectedPrNumber);
    if (!pr) {
      setPrError('Select a pull request to review.');
      return;
    }
    if (reviewModelOptions.length === 0 || !reviewModel) {
      showNotification('Select a model before reviewing', 'info');
      return;
    }

    setIsReviewing(true);
    try {
      const provider = resolvePrProvider(repoHost, prProvider);
      const apiBase = provider === 'github'
        ? resolveGitHubApiBase()
        : buildGitLabApiBase(repoHost);
      const diffText = provider === 'github'
        ? await github.pullRequestDiff(parsed.owner, parsed.repo, pr.number, token, apiBase)
        : await gitlab.mergeRequestDiff(parsed.owner, parsed.repo, pr.number, token, apiBase);
      const result = buildPullRequestPrompt(pr, diffText);
      if (!result) {
        showNotification('No reviewable changes found', 'info');
        return;
      }
      await handleReviewPrompt(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPrError(message);
      showNotification('Failed to prepare PR review', 'error');
    } finally {
      setIsReviewing(false);
    }
  };

  const handleReviewCommit = async () => {
    setCommitError(null);
    if (!currentWorkspace?.rootPath) return;
    if (!commitHash.trim()) {
      setCommitError('Enter a commit hash.');
      return;
    }
    if (reviewModelOptions.length === 0 || !reviewModel) {
      showNotification('Select a model before reviewing', 'info');
      return;
    }
    setIsReviewing(true);
    try {
      if (commitMode === 'single') {
        const commit = await git.showCommit(currentWorkspace.rootPath, commitHash.trim());
        const details = [
          `Commit: ${commit.commit_id}`,
          `Author: ${commit.author} <${commit.email}>`,
          `Date: ${commit.timestamp}`,
          `Message: ${commit.message}`,
        ].join('\n');
        const result = buildCommitPrompt('Commit', details, commit.files);
        if (!result) {
          showNotification('No reviewable changes found', 'info');
          return;
        }
        await handleReviewPrompt(result);
      } else {
        const diffResult = await git.diffSince(currentWorkspace.rootPath, commitHash.trim());
        const details = [
          `From: ${diffResult.from_commit}`,
          `To: ${diffResult.to_commit}`,
          `Commits: ${diffResult.commit_count}`,
        ].join('\n');
        const result = buildCommitPrompt('Commit Range', details, diffResult.files);
        if (!result) {
          showNotification('No reviewable changes found', 'info');
          return;
        }
        await handleReviewPrompt(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCommitError(message);
      showNotification('Failed to prepare commit review', 'error');
    } finally {
      setIsReviewing(false);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className={styles.empty}>
        <GitPullRequest size={32} />
        <p>Open a folder to review code</p>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className={styles.empty}>
        <GitPullRequest size={32} />
        <p>This folder is not a Git repository</p>
      </div>
    );
  }

  const selectedPr = pullRequests.find((entry) => entry.number === selectedPrNumber);
  const canReview = !isReviewing && reviewModelOptions.length > 0 && reviewModel;
  const commitItems = commitHistory.map((commit) => ({
    ...commit,
    shortId: commit.id.slice(0, 7),
    messageLine: commit.message.split('\n')[0] || 'No message',
  }));
  const resolvedProvider = repoHost ? resolvePrProvider(repoHost, prProvider) : prProvider;
  const showGithub404Hint = resolvedProvider === 'github' && prError?.includes('404');

  return (
    <div className={styles.codeReviewPanel}>
      <div className={styles.header}>
        <div className={styles.segmented}>
          <button
            className={`${styles.segmentButton} ${reviewMode === 'pr' ? styles.segmentButtonActive : ''}`}
            onClick={() => setReviewMode('pr')}
          >
            Pull Requests
          </button>
          <button
            className={`${styles.segmentButton} ${reviewMode === 'commit' ? styles.segmentButtonActive : ''}`}
            onClick={() => setReviewMode('commit')}
          >
            Commit Review
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {reviewMode === 'pr' ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Pull Requests</div>
            <label className={styles.label}>Repository</label>
            <div className={styles.readOnlyField}>
              {repoSlug && repoHost ? `${repoHost}/${repoSlug}` : 'No Git remote detected'}
            </div>
            <label className={styles.label}>Provider</label>
            <select
              className={styles.select}
              value={prProvider}
              onChange={(e) => setPrProvider(e.target.value as 'auto' | 'github' | 'gitlab')}
            >
              <option value="auto">Auto-detect</option>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
            <div className={styles.row}>
              <select
                className={styles.select}
                value={selectedPrNumber ?? ''}
                onChange={(e) => setSelectedPrNumber(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select a pull request</option>
                {pullRequests.map((pr) => (
                  <option key={pr.number} value={pr.number}>
                    #{pr.number} {pr.title}
                  </option>
                ))}
              </select>
              <button
                className={styles.secondaryButton}
                onClick={handleLoadPullRequests}
                disabled={prLoading}
                title={prLoading ? 'Loading pull requests…' : 'Refresh pull requests'}
                aria-label={prLoading ? 'Loading pull requests' : 'Refresh pull requests'}
              >
                {prLoading ? <Loader2 size={14} className={styles.spinning} /> : <RefreshCw size={14} />}
              </button>
            </div>
            {selectedPr && (
              <div className={styles.prMeta}>
                <span>#{selectedPr.number} · {selectedPr.head_ref} → {selectedPr.base_ref}</span>
                {selectedPr.draft && <span> · Draft</span>}
              </div>
            )}
            {prError && <div className={styles.error}>{prError}</div>}
            {showGithub404Hint && (
              <div className={styles.warning}>
                Check GitHub Enterprise API base and SSO/PAT access (404 often means no access).
              </div>
            )}
            {!githubToken.trim() && (
              <div className={styles.warning}>Add a GitHub/GitLab token in Settings &gt; Git to load PRs.</div>
            )}
          </div>
        ) : (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Commit Review</div>
            <label className={styles.label}>Commit Hash (optional)</label>
            <input
              className={styles.input}
              value={commitHash}
              onChange={(e) => {
                setCommitHash(e.target.value);
                setSelectedCommitId('');
              }}
              placeholder="e.g. a1b2c3d"
            />
            <label className={styles.label}>Commit History</label>
            {commitItems.length === 0 ? (
              <div className={styles.warning}>No commit history loaded yet.</div>
            ) : (
              <div className={styles.commitList}>
                {commitItems.map((commit) => (
                  <button
                    key={commit.id}
                    className={`${styles.commitItem} ${
                      selectedCommitId === commit.id ? styles.commitItemActive : ''
                    }`}
                    onClick={() => {
                      setSelectedCommitId(commit.id);
                      setCommitHash(commit.id);
                    }}
                    type="button"
                  >
                    <div className={styles.commitHeader}>
                      <span className={styles.commitId}>{commit.shortId}</span>
                      <span className={styles.commitDate}>
                        {new Date(commit.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={styles.commitMessage}>{commit.messageLine}</div>
                    <div className={styles.commitAuthor}>{commit.author}</div>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.row}>
              <select
                className={styles.select}
                value={commitMode}
                onChange={(e) => setCommitMode(e.target.value as 'single' | 'range')}
              >
                <option value="single">Single commit</option>
                <option value="range">Commit to HEAD</option>
              </select>
              <div className={styles.commitHint}>
                <GitCommit size={14} />
                <span>{commitMode === 'single' ? 'Review one commit' : 'Review range to HEAD'}</span>
              </div>
            </div>
            {commitError && <div className={styles.error}>{commitError}</div>}
          </div>
        )}
      </div>

      <div className={styles.reviewBox}>
        <div className={styles.reviewHeader}>Review Settings</div>
        <div className={styles.reviewControls}>
          <div className={styles.reviewRow}>
            <select
              className={styles.reviewSelect}
              value={reviewProvider}
              onChange={(e) => setReviewProvider(e.target.value as AIProvider)}
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="copilot">GitHub Copilot</option>
              <option value="custom">Custom Endpoint</option>
            </select>
            <select
              className={styles.reviewSelect}
              value={reviewModel}
              onChange={(e) => setReviewModel(e.target.value)}
              disabled={reviewModelOptions.length === 0}
            >
              {reviewModelOptions.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                reviewModelOptions.map((model) => (
                  <option key={model} value={model}>
                    {formatModelLabel(reviewProvider, model)}
                  </option>
                ))
              )}
            </select>
            <button
              className={styles.reviewBtn}
              onClick={reviewMode === 'pr' ? handleReviewPullRequest : handleReviewCommit}
              disabled={!canReview}
            >
              {isReviewing ? 'Reviewing...' : 'Review'}
            </button>
          </div>
          <label className={styles.reviewToggle}>
            <input
              type="checkbox"
              checked={reviewUsePlanMode}
              onChange={(e) => setReviewUsePlanMode(e.target.checked)}
            />
            Use plan mode for review
          </label>
        </div>
      </div>
    </div>
  );
}
