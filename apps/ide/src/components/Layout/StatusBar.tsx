import { GitBranch, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useGitStore } from '../../store/gitStore';
import { useProblemsStore } from '../../store/problemsStore';
import { useLayoutStore } from '../../store/layoutStore';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const { activeFile } = useEditorStore();
  const { currentBranch, isRepo } = useGitStore();
  const { getCounts } = useProblemsStore();
  const { setActiveSideTab, setActiveBottomTab, setShowBottomPanel } = useLayoutStore();
  
  const { errors, warnings } = getCounts();
  const totalProblems = errors + warnings;

  const getLanguage = (filename?: string) => {
    if (!filename) return '';
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'TypeScript',
      tsx: 'TypeScript React',
      js: 'JavaScript',
      jsx: 'JavaScript React',
      json: 'JSON',
      md: 'Markdown',
      css: 'CSS',
      html: 'HTML',
      py: 'Python',
      rs: 'Rust',
      go: 'Go',
      java: 'Java',
      cpp: 'C++',
      c: 'C',
    };
    return langMap[ext || ''] || ext?.toUpperCase() || '';
  };

  const handleBranchClick = () => {
    setActiveSideTab('git');
  };

  const handleProblemsClick = () => {
    setShowBottomPanel(true);
    setActiveBottomTab('problems');
  };

  const cursorLine = activeFile?.cursorPosition?.line ?? 1;
  const cursorColumn = activeFile?.cursorPosition?.column ?? 1;

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        {isRepo && currentBranch && (
          <button className={styles.item} onClick={handleBranchClick} title="Switch branch">
            <GitBranch size={14} />
            <span>{currentBranch}</span>
          </button>
        )}
        <button 
          className={`${styles.item} ${totalProblems > 0 ? styles.hasProblems : ''}`} 
          onClick={handleProblemsClick}
          title="View problems"
        >
          {errors > 0 ? (
            <AlertCircle size={14} className={styles.errorIcon} />
          ) : warnings > 0 ? (
            <AlertTriangle size={14} className={styles.warningIcon} />
          ) : (
            <CheckCircle2 size={14} className={styles.okIcon} />
          )}
          <span>
            {totalProblems > 0 
              ? `${errors} ${errors === 1 ? 'Error' : 'Errors'}, ${warnings} ${warnings === 1 ? 'Warning' : 'Warnings'}`
              : 'No Problems'
            }
          </span>
        </button>
      </div>
      <div className={styles.right}>
        {activeFile && (
          <>
            <span className={styles.item}>Ln {cursorLine}, Col {cursorColumn}</span>
            <span className={styles.item}>UTF-8</span>
            <span className={styles.item}>{getLanguage(activeFile.name)}</span>
          </>
        )}
        <span className={styles.item}>OpenCodeBrew v0.1.0</span>
      </div>
    </div>
  );
}
