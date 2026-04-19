import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Clock } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import styles from './HistoryDiffEditor.module.css';

interface HistoryDiffEditorProps {
  filePath: string;
  fileName: string;
  historyId: number;
  historyTimestamp: string;
  oldContent: string;
  newContent: string;
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

export function HistoryDiffEditor({ 
  filePath, 
  fileName, 
  historyTimestamp, 
  oldContent, 
  newContent 
}: HistoryDiffEditorProps) {
  const { updateFileContent, openFiles } = useEditorStore();
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const { hunks, additions, deletions } = useMemo(() => {
    return computeDiff(oldContent, newContent);
  }, [oldContent, newContent]);

  const handleRestore = () => {
    const activeFileTab = openFiles.find(f => f.path === filePath && f.type !== 'history-diff');
    if (activeFileTab) {
      updateFileContent(filePath, oldContent);
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

  const formattedTime = new Date(historyTimestamp).toLocaleString();

  return (
    <div className={styles.historyDiffEditor}>
      <div className={styles.header}>
        <Clock size={16} className={styles.headerIcon} />
        <div className={styles.headerInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.timestamp}>{formattedTime}</span>
        </div>
        <span className={styles.stats}>
          <span className={styles.additions}>+{additions}</span>
          <span className={styles.deletions}>-{deletions}</span>
        </span>
        <button className={styles.restoreBtn} onClick={handleRestore} title="Restore this version">
          <RotateCcw size={14} />
          Restore
        </button>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendOld}></span>
          History Version
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNew}></span>
          Current Version
        </span>
      </div>

      <div className={styles.diffContent}>
        {hunks.length === 0 ? (
          <div className={styles.noChanges}>No changes between versions</div>
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

  let currentHunk: DiffHunk | null = null;
  let contextBuffer: DiffLine[] = [];
  const contextSize = 3;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    
    if (line.type === 'unchanged') {
      if (currentHunk) {
        currentHunk.lines.push(line);
        if (currentHunk.lines.filter(l => l.type !== 'unchanged').length > 0) {
          let unchangedCount = 0;
          for (let j = currentHunk.lines.length - 1; j >= 0; j--) {
            if (currentHunk.lines[j].type === 'unchanged') {
              unchangedCount++;
            } else {
              break;
            }
          }
          if (unchangedCount > contextSize * 2) {
            currentHunk.lines = currentHunk.lines.slice(0, currentHunk.lines.length - unchangedCount + contextSize);
            hunks.push(currentHunk);
            currentHunk = null;
            contextBuffer = diffLines.slice(i - contextSize + 1, i + 1).filter(l => l.type === 'unchanged');
          }
        }
      } else {
        contextBuffer.push(line);
        if (contextBuffer.length > contextSize) {
          contextBuffer.shift();
        }
      }
    } else {
      if (!currentHunk) {
        currentHunk = {
          oldStart: line.oldLineNo || (line.newLineNo ? line.newLineNo - additions + deletions : 1),
          newStart: line.newLineNo || 1,
          lines: [...contextBuffer]
        };
        contextBuffer = [];
      }
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk && currentHunk.lines.some(l => l.type !== 'unchanged')) {
    const lastChangeIdx = currentHunk.lines.map(l => l.type !== 'unchanged').lastIndexOf(true);
    currentHunk.lines = currentHunk.lines.slice(0, Math.min(lastChangeIdx + contextSize + 1, currentHunk.lines.length));
    hunks.push(currentHunk);
  }

  return { hunks, additions, deletions };
}
