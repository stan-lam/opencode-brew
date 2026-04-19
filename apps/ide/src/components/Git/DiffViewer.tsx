import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react';
import styles from './DiffViewer.module.css';

interface DiffLine {
  line_type: string;
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
}

interface DiffHunk {
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

interface FileDiff {
  old_path: string | null;
  new_path: string | null;
  status: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface DiffViewerProps {
  repoPath: string;
  filePath: string;
  staged: boolean;
  onClose: () => void;
}

export function DiffViewer({ repoPath, filePath, staged, onClose }: DiffViewerProps) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadDiff();
  }, [repoPath, filePath, staged]);

  useEffect(() => {
    if (diff) {
      setExpandedHunks(new Set(diff.hunks.map((_, i) => i)));
    }
  }, [diff]);

  const loadDiff = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<FileDiff>('git_diff_file', {
        repoPath,
        filePath,
        staged,
      });
      setDiff(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleHunk = (index: number) => {
    setExpandedHunks(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      added: 'Added',
      deleted: 'Deleted',
      modified: 'Modified',
      renamed: 'Renamed',
      copied: 'Copied',
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      added: 'var(--accent-green)',
      deleted: 'var(--accent-red)',
      modified: 'var(--accent-yellow)',
      renamed: 'var(--accent-purple)',
      copied: 'var(--accent-blue)',
    };
    return colors[status] || 'var(--text-secondary)';
  };

  if (isLoading) {
    return (
      <div className={styles.diffViewer}>
        <div className={styles.header}>
          <span>Loading diff...</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.diffViewer}>
        <div className={styles.header}>
          <span>Error</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!diff || diff.hunks.length === 0) {
    return (
      <div className={styles.diffViewer}>
        <div className={styles.header}>
          <span>{filePath}</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.empty}>No changes to display</div>
      </div>
    );
  }

  return (
    <div className={styles.diffViewer}>
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <span 
            className={styles.status}
            style={{ color: getStatusColor(diff.status) }}
          >
            {getStatusLabel(diff.status)}
          </span>
          <span className={styles.filePath}>{diff.new_path || diff.old_path}</span>
          <span className={styles.stats}>
            <span className={styles.additions}>+{diff.additions}</span>
            <span className={styles.deletions}>-{diff.deletions}</span>
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className={styles.diffContent}>
        {diff.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className={styles.hunk}>
            <div 
              className={styles.hunkHeader}
              onClick={() => toggleHunk(hunkIndex)}
            >
              {expandedHunks.has(hunkIndex) ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span className={styles.hunkInfo}>{hunk.header}</span>
            </div>
            {expandedHunks.has(hunkIndex) && (
              <div className={styles.hunkLines}>
                {hunk.lines.map((line, lineIndex) => (
                  <div
                    key={lineIndex}
                    className={`${styles.line} ${styles[line.line_type]}`}
                  >
                    <span className={styles.lineNumber}>
                      {line.old_lineno || ''}
                    </span>
                    <span className={styles.lineNumber}>
                      {line.new_lineno || ''}
                    </span>
                    <span className={styles.lineSign}>
                      {line.line_type === 'addition' && '+'}
                      {line.line_type === 'deletion' && '-'}
                      {line.line_type === 'context' && ' '}
                    </span>
                    <span className={styles.lineContent}>
                      {line.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
