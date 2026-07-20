import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check, X, Sparkles, FileText, FilePlus, FileX } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { fs } from '../../services/tauri';
import styles from './HistoryDiffEditor.module.css';

interface AIDiffEditorProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  operationType: 'create' | 'edit' | 'delete';
  requiresOverwrite?: boolean;
  isApplied?: boolean;
}

interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export function AIDiffEditor({ 
  filePath, 
  oldContent, 
  newContent,
  operationType,
  requiresOverwrite,
  isApplied
}: AIDiffEditorProps) {
  const { closeFile, openFile } = useEditorStore();
  const { currentWorkspace } = useWorkspaceStore();
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  const [isApplying, setIsApplying] = useState(false);

  const { hunks, additions, deletions } = useMemo(() => {
    return computeDiff(oldContent, newContent);
  }, [oldContent, newContent]);

  const fileName = filePath.split('/').pop() || filePath;
  const applyLabel = requiresOverwrite ? 'Overwrite' : 'Apply';
  const showActions = !isApplied;
  const resolvedPath = useMemo(() => {
    if (!currentWorkspace?.rootPath) return filePath;
    if (filePath.startsWith(currentWorkspace.rootPath) || filePath.startsWith('/')) {
      return filePath;
    }
    return `${currentWorkspace.rootPath}/${filePath}`.replace(/\/{2,}/g, '/');
  }, [currentWorkspace?.rootPath, filePath]);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      if (operationType === 'delete') {
        // For delete, we'd need to delete the file
        // For now, just close the diff
      } else {
        await fs.writeFile(resolvedPath, newContent);
      }
      // Close this diff tab and open the actual file
      const diffPath = useEditorStore.getState().activeFile?.path;
      if (diffPath) {
        closeFile(diffPath);
      }
      if (operationType !== 'delete') {
        await openFile(resolvedPath);
      }
    } catch (error) {
      console.error('Failed to apply changes:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDismiss = () => {
    const diffPath = useEditorStore.getState().activeFile?.path;
    if (diffPath) {
      closeFile(diffPath);
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

  const getOperationIcon = () => {
    switch (operationType) {
      case 'create': return <FilePlus size={16} />;
      case 'edit': return <FileText size={16} />;
      case 'delete': return <FileX size={16} />;
    }
  };

  const getOperationLabel = () => {
    switch (operationType) {
      case 'create': return 'Create File';
      case 'edit': return 'Edit File';
      case 'delete': return 'Delete File';
    }
  };

  return (
    <div className={styles.historyDiffEditor}>
      <div className={styles.header}>
        <Sparkles size={16} className={styles.headerIcon} style={{ color: 'var(--accent-purple)' }} />
        <div className={styles.headerInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.timestamp} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {getOperationIcon()}
            {getOperationLabel()}
          </span>
        </div>
        <span className={styles.stats}>
          <span className={styles.additions}>+{additions}</span>
          <span className={styles.deletions}>-{deletions}</span>
        </span>
        {showActions && (
          <>
            <button 
              className={styles.restoreBtn} 
              onClick={handleApply} 
              disabled={isApplying}
              title={requiresOverwrite ? 'Overwrite with AI changes' : 'Apply these changes'}
              style={{ background: 'var(--accent-green)', marginRight: '4px' }}
            >
              <Check size={14} />
              {isApplying ? 'Applying...' : applyLabel}
            </button>
            <button 
              className={styles.restoreBtn} 
              onClick={handleDismiss}
              title="Dismiss without applying"
              style={{ background: 'var(--bg-tertiary)' }}
            >
              <X size={14} />
              Dismiss
            </button>
          </>
        )}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendOld}></span>
          Current
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNew}></span>
          AI Proposed
        </span>
      </div>

      {requiresOverwrite && (
        <div className={styles.aiDiffWarning}>
          <strong>Overwrite required.</strong>
          <span>File exists and differs from the AI proposal. Review the diff, then overwrite if desired.</span>
        </div>
      )}

      <div className={styles.diffContent}>
        {hunks.length === 0 ? (
          <div className={styles.noChanges}>
            {operationType === 'create' ? 'New file will be created' : 'No changes to display'}
          </div>
        ) : (
          hunks.map((hunk, hunkIndex) => (
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
                <span className={styles.hunkInfo}>
                  @@ -{hunk.oldStart} +{hunk.newStart} @@
                </span>
              </div>
              {expandedHunks.has(hunkIndex) && (
                <div className={styles.hunkLines}>
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`${styles.line} ${styles[line.type]}`}
                    >
                      <span className={styles.lineNumber}>
                        {line.type !== 'add' ? line.oldLineNo : ''}
                      </span>
                      <span className={styles.lineNumber}>
                        {line.type !== 'remove' ? line.newLineNo : ''}
                      </span>
                      <span className={styles.lineSign}>
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                      </span>
                      <pre className={styles.lineContent}>{line.content}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function computeDiff(oldContent: string, newContent: string): { hunks: DiffHunk[], additions: number, deletions: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  
  const diffLines: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      diffLines.push({ 
        type: 'add', 
        content: newLines[newIdx],
        newLineNo: newIdx + 1
      });
      additions++;
      newIdx++;
    } else if (newIdx >= newLines.length) {
      diffLines.push({ 
        type: 'remove', 
        content: oldLines[oldIdx],
        oldLineNo: oldIdx + 1
      });
      deletions++;
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      diffLines.push({ 
        type: 'unchanged', 
        content: oldLines[oldIdx],
        oldLineNo: oldIdx + 1,
        newLineNo: newIdx + 1
      });
      oldIdx++;
      newIdx++;
    } else {
      const oldInNew = newLines.indexOf(oldLines[oldIdx], newIdx);
      const newInOld = oldLines.indexOf(newLines[newIdx], oldIdx);
      
      if (oldInNew === -1 && newInOld === -1) {
        diffLines.push({ 
          type: 'remove', 
          content: oldLines[oldIdx],
          oldLineNo: oldIdx + 1
        });
        diffLines.push({ 
          type: 'add', 
          content: newLines[newIdx],
          newLineNo: newIdx + 1
        });
        deletions++;
        additions++;
        oldIdx++;
        newIdx++;
      } else if (oldInNew === -1) {
        diffLines.push({ 
          type: 'remove', 
          content: oldLines[oldIdx],
          oldLineNo: oldIdx + 1
        });
        deletions++;
        oldIdx++;
      } else if (newInOld === -1) {
        diffLines.push({ 
          type: 'add', 
          content: newLines[newIdx],
          newLineNo: newIdx + 1
        });
        additions++;
        newIdx++;
      } else if (oldInNew <= newInOld) {
        diffLines.push({ 
          type: 'add', 
          content: newLines[newIdx],
          newLineNo: newIdx + 1
        });
        additions++;
        newIdx++;
      } else {
        diffLines.push({ 
          type: 'remove', 
          content: oldLines[oldIdx],
          oldLineNo: oldIdx + 1
        });
        deletions++;
        oldIdx++;
      }
    }
  }
  
  // Group into hunks with context
  let currentHunk: DiffHunk | null = null;
  let contextLines = 0;
  const CONTEXT = 3;
  
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    const isChange = line.type !== 'unchanged';
    
    if (isChange) {
      if (!currentHunk) {
        const startIdx = Math.max(0, i - CONTEXT);
        currentHunk = {
          oldStart: diffLines[startIdx]?.oldLineNo || 1,
          newStart: diffLines[startIdx]?.newLineNo || 1,
          lines: diffLines.slice(startIdx, i)
        };
      }
      currentHunk.lines.push(line);
      contextLines = 0;
    } else if (currentHunk) {
      currentHunk.lines.push(line);
      contextLines++;
      if (contextLines >= CONTEXT * 2) {
        hunks.push(currentHunk);
        currentHunk = null;
        contextLines = 0;
      }
    }
  }
  
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  
  return { hunks, additions, deletions };
}
