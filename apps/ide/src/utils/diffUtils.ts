/**
 * Diff Utilities
 * 
 * Shared utilities for parsing, formatting, and processing git diffs.
 * Extracted from CodeReviewPanel for reuse in Dev Team PR Review workflow.
 */

import type { FileDiff } from '../services/tauri';

// ============================================================================
// Constants
// ============================================================================

export const MAX_TOTAL_CHARS = 60000;
export const MAX_FILE_DIFF_CHARS = 8000;

export const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'zip', 'tar', 'gz', '7z',
  'ico', 'icns', 'mp4', 'mov', 'mp3', 'wav', 'ttf', 'otf', 'woff', 'woff2',
]);

export const SENSITIVE_PATH_PATTERNS = [
  /\.env/i,
  /secret/i,
  /credential/i,
  /token/i,
  /api[-_]?key/i,
  /private/i,
];

// ============================================================================
// Types
// ============================================================================

export interface DiffChunk {
  filePath: string | null;
  content: string;
}

export interface GitRemoteInfo {
  host: string;
  slug: string;
}

export interface OwnerRepo {
  owner: string;
  repo: string;
}

export interface DiffBuildResult {
  prompt: string;
  truncated: boolean;
  skippedFiles: string[];
}

export interface DiffSectionTotals {
  totalChars: number;
  truncated: boolean;
  canContinue: boolean;
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Check if a file path matches sensitive patterns (env files, secrets, etc.)
 */
export function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if a file path has a binary file extension
 */
export function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

/**
 * Normalize line ending (remove trailing newline)
 */
export function normalizeLine(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

// ============================================================================
// Diff Formatting
// ============================================================================

/**
 * Wrap diff text in markers for AI processing
 */
export function wrapDiffBlock(diffText: string, filePath?: string | null): string {
  const normalized = diffText.endsWith('\n') ? diffText.slice(0, -1) : diffText;
  const label = filePath ? ` (${filePath})` : '';
  return `--- BEGIN DIFF${label} ---\n${normalized}\n--- END DIFF${label} ---`;
}

/**
 * Format a FileDiff object into a standard diff string
 */
export function formatFileDiff(diff: FileDiff): string {
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
}

/**
 * Extract individual file diff chunks from a combined diff string
 */
export function extractDiffChunks(diffText: string): DiffChunk[] {
  const lines = diffText.split('\n');
  const chunks: DiffChunk[] = [];
  let currentLines: string[] = [];
  let currentPath: string | null = null;

  const pushChunk = () => {
    if (currentLines.length === 0) return;
    chunks.push({ filePath: currentPath, content: currentLines.join('\n') });
  };

  lines.forEach((line) => {
    if (line.startsWith('diff --git ')) {
      pushChunk();
      currentLines = [line];
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = match ? match[2] : null;
      return;
    }
    currentLines.push(line);
  });

  pushChunk();

  if (chunks.length === 0 && diffText.trim()) {
    return [{ filePath: null, content: diffText }];
  }

  return chunks;
}

// ============================================================================
// Git Remote Parsing
// ============================================================================

/**
 * Parse a git remote URL into host and slug components
 */
export function parseGitRemoteInfo(url: string): GitRemoteInfo | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Handle HTTP/HTTPS URLs
  if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.host;
      let path = parsed.pathname.replace(/^\/+/, '').replace(/\.git\/?$/, '');
      const parts = path.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      return { host, slug: `${parts[0]}/${parts[1]}` };
    } catch {
      return null;
    }
  }

  // Handle SSH URLs (git@github.com:owner/repo.git)
  const scpMatch = trimmed.match(/^(?:.+@)?([^:]+):(.+)$/);
  if (!scpMatch) return null;
  const host = scpMatch[1];
  const path = scpMatch[2].replace(/^\/+/, '').replace(/\.git\/?$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { host, slug: `${parts[0]}/${parts[1]}` };
}

/**
 * Build GitHub API base URL from host
 */
export function buildGitHubApiBase(host: string): string {
  if (host === 'github.com' || host === 'api.github.com') {
    return 'https://api.github.com';
  }
  return `https://${host}/api/v3`;
}

/**
 * Build GitLab API base URL from host
 */
export function buildGitLabApiBase(host: string): string {
  return `https://${host}/api/v4`;
}

/**
 * Determine PR provider (GitHub vs GitLab) based on host
 */
export function resolvePrProvider(host: string, preferred: 'auto' | 'github' | 'gitlab'): 'github' | 'gitlab' {
  if (preferred !== 'auto') return preferred;
  const lowerHost = host.toLowerCase();
  return lowerHost.includes('github') ? 'github' : 'gitlab';
}

/**
 * Parse owner/repo slug into separate components
 */
export function parseOwnerRepo(slug: string): OwnerRepo | null {
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

// ============================================================================
// Diff Section Building
// ============================================================================

/**
 * Build diff section from FileDiff array (structured diff data)
 */
export function buildDiffSectionFromFiles(
  diffs: FileDiff[],
  skippedFiles: string[],
  onTruncate: () => void
): string {
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
      onTruncate();
    }
    parts.push(wrapDiffBlock(diffText, filePath));
  });
  return parts.join('\n\n');
}

/**
 * Build diff section from raw diff text
 */
export function buildDiffSectionFromText(
  diffText: string,
  skippedFiles: string[],
  onTruncate: () => void
): string {
  const parts: string[] = [];
  const chunks = extractDiffChunks(diffText);
  if (chunks.length === 0 && diffText.trim()) {
    chunks.push({ filePath: null, content: diffText });
  }
  chunks.forEach((chunk) => {
    const filePath = chunk.filePath || 'unknown';
    if (chunk.filePath && (isSensitivePath(filePath) || isBinaryPath(filePath))) {
      skippedFiles.push(filePath);
      return;
    }
    let chunkText = chunk.content;
    if (chunkText.length > MAX_FILE_DIFF_CHARS) {
      chunkText = `${chunkText.slice(0, MAX_FILE_DIFF_CHARS)}\n...[truncated]`;
      onTruncate();
    }
    parts.push(wrapDiffBlock(chunkText, chunk.filePath));
  });
  return parts.join('\n\n');
}

/**
 * Append a section to the sections array while tracking size limits
 */
export function appendSection(
  sections: string[],
  title: string,
  body: string,
  totals: DiffSectionTotals
): void {
  if (!body.trim() || !totals.canContinue) return;
  const section = `=== ${title} ===\n${body}`;
  if (totals.totalChars + section.length <= MAX_TOTAL_CHARS) {
    sections.push(section);
    totals.totalChars += section.length;
    return;
  }
  const remaining = MAX_TOTAL_CHARS - totals.totalChars;
  if (remaining > 0) {
    sections.push(`${section.slice(0, remaining)}\n...[truncated]`);
  }
  totals.truncated = true;
  totals.canContinue = false;
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build a review prompt from sections
 */
export function buildReviewPrompt(
  sections: string[],
  skippedFiles: string[],
  truncated: boolean
): string {
  const skippedSection = skippedFiles.length > 0
    ? `\n\nSkipped files:\n${skippedFiles.map((filePath) => `- ${filePath}`).join('\n')}`
    : '';
  const truncationNotice = truncated
    ? '\n\nNote: Some diffs or files were truncated to fit size limits.'
    : '';
  return [
    'Review the changes below.',
    'Respond in plain text. Do NOT use Markdown headings, tables, or fenced code blocks (no ```).',
    'Do NOT output tool tags like <read_file>, <search_files>, <search_web>, <fetch_url>, <create_file>, <edit_file>, <delete_file>.',
    'Use ONLY the provided diff/context. Do not ask to open files or fetch more data.',
    'Provide findings ordered by severity with file paths/line ranges when possible.',
    'If no issues, say so and mention test gaps.',
    'If fixes are needed, include a checklist titled "Review Fix Plan" using "- [ ]" items.',
    'Be ready to revise the checklist if the user asks to add/remove tasks.',
    '',
    sections.join('\n\n'),
    skippedSection + truncationNotice,
  ].join('\n');
}

/**
 * Build a structured review prompt for Dev Team mode (more detailed output)
 */
export function buildStructuredReviewPrompt(
  sections: string[],
  skippedFiles: string[],
  truncated: boolean,
  reviewType: 'code' | 'security' | 'performance' | 'combined'
): string {
  const skippedSection = skippedFiles.length > 0
    ? `\n\nSkipped files:\n${skippedFiles.map((filePath) => `- ${filePath}`).join('\n')}`
    : '';
  const truncationNotice = truncated
    ? '\n\nNote: Some diffs or files were truncated to fit size limits.'
    : '';
  
  const reviewInstructions = {
    code: `Focus on:
- Code quality and maintainability
- Error handling
- Performance anti-patterns
- Missing tests
- Code style consistency`,
    security: `Focus on:
- OWASP Top 10 vulnerabilities
- Hardcoded secrets
- SQL injection
- XSS vulnerabilities
- Authentication/authorization issues`,
    performance: `Focus on:
- Algorithmic complexity
- Bundle size impact
- Memory leaks
- Unnecessary re-renders
- Database query optimization`,
    combined: `Provide a comprehensive review covering:
1. Code Quality: Style, maintainability, error handling
2. Security: Vulnerabilities, secrets, injection risks
3. Performance: Complexity, memory, optimization opportunities`,
  };

  return [
    `You are reviewing code changes. ${reviewInstructions[reviewType]}`,
    '',
    'Output your findings in this structured format:',
    '',
    '## Summary',
    '[One paragraph overview of the changes]',
    '',
    '## Findings',
    '',
    'For each finding:',
    '### [SEVERITY] Title',
    '**File:** path/to/file.ts:line',
    '**Issue:** Description of the problem',
    '**Fix:** How to resolve it',
    '',
    'Severity levels: CRITICAL, HIGH, MEDIUM, LOW, INFO',
    '',
    '## Verdict',
    '[APPROVE | WARNING | BLOCK] - Brief justification',
    '',
    '## Fix Checklist',
    '- [ ] Fix item 1',
    '- [ ] Fix item 2',
    '',
    '---',
    '',
    sections.join('\n\n'),
    skippedSection + truncationNotice,
  ].join('\n');
}
