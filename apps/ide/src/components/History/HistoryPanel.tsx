import { useState, useEffect, useCallback } from 'react';
import { Clock, File, RotateCcw, ChevronDown, ChevronRight, GitCompare } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { history, HistoryEntry } from '../../services/tauri';
import styles from './HistoryPanel.module.css';

export function HistoryPanel() {
  const { activeFile, openFiles, updateFileContent, openHistoryDiff } = useEditorStore();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [contextFilePath, setContextFilePath] = useState<string | null>(null);

  // Find the file we should show history for - either the active non-history file,
  // or the file that the active history-diff tab is showing
  const historyContextFile = activeFile?.type === 'history-diff' 
    ? activeFile.historyDiffInfo?.filePath 
    : activeFile?.type === 'file' || !activeFile?.type
      ? activeFile?.path 
      : null;

  // Get the currently selected history entry ID from the active editor tab
  const selectedHistoryId = activeFile?.type === 'history-diff' 
    ? activeFile.historyDiffInfo?.historyId 
    : null;

  const loadHistory = useCallback(async () => {
    if (!historyContextFile) return;
    setLoading(true);
    setContextFilePath(historyContextFile);
    try {
      const fileHistory = await history.getFileHistory(historyContextFile, 100);
      setEntries(fileHistory);
      if (fileHistory.length > 0) {
        const firstDate = new Date(fileHistory[0].timestamp).toLocaleDateString();
        setExpandedDates(new Set([firstDate]));
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
    setLoading(false);
  }, [historyContextFile]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Refresh history when a file is saved
  useEffect(() => {
    const handleFileSaved = (event: CustomEvent<{ path: string }>) => {
      if (event.detail.path === contextFilePath) {
        loadHistory();
      }
    };

    window.addEventListener('file-saved', handleFileSaved as EventListener);
    return () => {
      window.removeEventListener('file-saved', handleFileSaved as EventListener);
    };
  }, [contextFilePath, loadHistory]);

  // Get the actual file content - either from open files or from the current history diff's newContent
  const getFileContent = useCallback(() => {
    if (!contextFilePath) return null;
    // First try to get from the actual file tab
    const openFile = openFiles.find(f => f.path === contextFilePath && f.type !== 'history-diff');
    if (openFile?.content !== undefined) {
      return openFile.content;
    }
    // Fall back to the newContent from the active history-diff tab
    if (activeFile?.type === 'history-diff' && activeFile.historyDiffInfo?.filePath === contextFilePath) {
      return activeFile.historyDiffInfo.newContent;
    }
    return null;
  }, [contextFilePath, openFiles, activeFile]);

  const getFileName = useCallback(() => {
    if (!contextFilePath) return '';
    return contextFilePath.split('/').pop() || contextFilePath;
  }, [contextFilePath]);

  const handleViewDiff = async (entry: HistoryEntry) => {
    if (!contextFilePath) return;
    const currentContent = getFileContent();
    if (currentContent === null) return;
    
    try {
      const oldContent = await history.getContent(entry.id);
      openHistoryDiff(
        contextFilePath,
        getFileName(),
        entry.id,
        entry.timestamp,
        oldContent,
        currentContent
      );
    } catch (error) {
      console.error('Failed to load history content:', error);
    }
  };

  const handleRestore = async (entry: HistoryEntry) => {
    if (!contextFilePath) return;
    try {
      const content = await history.getContent(entry.id);
      updateFileContent(contextFilePath, content);
    } catch (error) {
      console.error('Failed to restore from history:', error);
    }
  };

  if (!historyContextFile) {
    return (
      <div className={styles.empty}>
        <Clock size={32} />
        <p>Open a file to view its history</p>
      </div>
    );
  }

  // Skip the most recent entry since it represents the current saved state
  // (comparing it to current content would show no changes)
  const historyEntries = entries.slice(1);

  const groupedEntries = historyEntries.reduce((acc, entry) => {
    const date = new Date(entry.timestamp).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(entry);
    return acc;
  }, {} as Record<string, HistoryEntry[]>);

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  return (
    <div className={styles.historyPanel}>
      <div className={styles.header}>
        <File size={14} />
        <span className={styles.fileName}>{getFileName()}</span>
        <button className={styles.refreshBtn} onClick={loadHistory} title="Refresh">
          <RotateCcw size={14} />
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading history...</div>
      ) : historyEntries.length === 0 ? (
        <div className={styles.emptyHistory}>
          <Clock size={24} />
          <p>No previous versions yet</p>
          <p className={styles.hint}>
            Save the file again to create history
          </p>
        </div>
      ) : (
        <div className={styles.timeline}>
          {Object.entries(groupedEntries).map(([date, dateEntries]) => (
            <div key={date} className={styles.dateGroup}>
              <button
                className={styles.dateHeader}
                onClick={() => toggleDate(date)}
              >
                {expandedDates.has(date) ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <span>{date}</span>
                <span className={styles.count}>{dateEntries.length}</span>
              </button>
              {expandedDates.has(date) && (
                <div className={styles.entries}>
                  {dateEntries.map((entry) => {
                    const isSelected = selectedHistoryId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className={`${styles.entry} ${isSelected ? styles.selected : ''}`}
                        onClick={() => handleViewDiff(entry)}
                      >
                        <Clock size={12} className={styles.entryIcon} />
                        <div className={styles.entryInfo}>
                          <span className={styles.time}>
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                          <span className={styles.size}>
                            {formatSize(entry.size)}
                          </span>
                        </div>
                        <div className={styles.entryActions}>
                          <button 
                            title="View Diff"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewDiff(entry);
                            }}
                          >
                            <GitCompare size={12} />
                          </button>
                          <button 
                            title="Restore"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestore(entry);
                            }}
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
