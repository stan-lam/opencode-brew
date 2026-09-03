import { AlertCircle, AlertTriangle, Info, ChevronDown, ChevronRight, File } from 'lucide-react';
import { useState } from 'react';
import { useProblemsStore, Problem } from '../../store/problemsStore';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './ProblemsPanel.module.css';

export function ProblemsPanel() {
  const { problems } = useProblemsStore();
  const { openFile } = useEditorStore();
  const settings = useSettingsStore();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const groupedProblems = problems.reduce((acc, problem) => {
    if (!acc[problem.file]) acc[problem.file] = [];
    acc[problem.file].push(problem);
    return acc;
  }, {} as Record<string, Problem[]>);

  const errorCount = problems.filter((p) => p.type === 'error').length;
  const warningCount = problems.filter((p) => p.type === 'warning').length;
  const infoCount = problems.filter((p) => p.type === 'info').length;

  const toggleFile = (file: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(file)) {
      newExpanded.delete(file);
    } else {
      newExpanded.add(file);
    }
    setExpandedFiles(newExpanded);
  };

  const getIcon = (type: Problem['type']) => {
    switch (type) {
      case 'error':
        return <AlertCircle size={14} className={styles.errorIcon} />;
      case 'warning':
        return <AlertTriangle size={14} className={styles.warningIcon} />;
      case 'info':
        return <Info size={14} className={styles.infoIcon} />;
    }
  };

  const handleProblemClick = (problem: Problem) => {
    openFile(problem.file);
    // Dispatch event to navigate editor to the line
    window.dispatchEvent(new CustomEvent('navigate-to-line', {
      detail: { file: problem.file, line: problem.line, column: problem.column }
    }));
  };

  return (
    <div 
      className={styles.problemsPanel}
      style={{
        backgroundColor: settings.terminalBackground,
        color: settings.terminalForeground,
        fontFamily: settings.terminalFontFamily,
        fontSize: settings.terminalFontSize,
      }}
    >
      <div className={styles.summary}>
        <span className={styles.summaryItem}>
          <AlertCircle size={14} className={styles.errorIcon} />
          {errorCount} Errors
        </span>
        <span className={styles.summaryItem}>
          <AlertTriangle size={14} className={styles.warningIcon} />
          {warningCount} Warnings
        </span>
        <span className={styles.summaryItem}>
          <Info size={14} className={styles.infoIcon} />
          {infoCount} Info
        </span>
      </div>

      <div className={styles.problemList}>
        {problems.length === 0 ? (
          <div className={styles.empty}>
            <AlertCircle size={24} />
            <p>No problems detected</p>
          </div>
        ) : (
          Object.entries(groupedProblems).map(([file, fileProblems]) => (
            <div key={file} className={styles.fileGroup}>
              <button
                className={styles.fileHeader}
                onClick={() => toggleFile(file)}
              >
                {expandedFiles.has(file) ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <File size={14} />
                <span className={styles.fileName}>{file}</span>
                <span className={styles.fileCount}>{fileProblems.length}</span>
              </button>
              {expandedFiles.has(file) && (
                <div className={styles.problems}>
                  {fileProblems.map((problem) => (
                    <div 
                      key={problem.id} 
                      className={styles.problemItem}
                      onClick={() => handleProblemClick(problem)}
                    >
                      {getIcon(problem.type)}
                      <span className={styles.message}>{problem.message}</span>
                      <span className={styles.location}>
                        [{problem.line}:{problem.column}]
                      </span>
                      {problem.source && (
                        <span className={styles.source}>{problem.source}</span>
                      )}
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
