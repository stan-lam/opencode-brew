import { useLayoutStore } from '../../store/layoutStore';
import { FileTree } from '../FileTree/FileTree';
import { SearchPanel } from '../Search/SearchPanel';
import { GitPanel } from '../Git/GitPanel';
import { CodeReviewPanel } from '../CodeReview/CodeReviewPanel';
import { TestPanel } from '../Test/TestPanel';
import { HistoryPanel } from '../History/HistoryPanel';
import { SettingsPanel } from '../Settings/SettingsPanel';
import { PlansSidePanel } from '../Plans/PlansSidePanel';
import styles from './SidePanel.module.css';

const panelTitles: Record<string, string> = {
  explorer: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  codeReview: 'Code Review',
  plans: 'Plans',
  test: 'Test',
  history: 'Local History',
  settings: 'Settings',
};

export function SidePanel() {
  const { activeSideTab, showSidePanel } = useLayoutStore();
  
  console.log('SidePanel render:', { activeSideTab, showSidePanel });

  return (
    <div className={styles.sidePanel}>
      <div className={styles.header}>
        <span className={styles.title}>{panelTitles[activeSideTab] || 'Panel'}</span>
      </div>
      <div className={styles.content}>
        {/* Keep all panels mounted to preserve state and scroll position */}
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'explorer' ? 'flex' : 'none' }}>
          <FileTree />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'search' ? 'flex' : 'none' }}>
          <SearchPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'git' ? 'flex' : 'none' }}>
          <GitPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'codeReview' ? 'flex' : 'none' }}>
          <CodeReviewPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'plans' ? 'flex' : 'none' }}>
          <PlansSidePanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'test' ? 'flex' : 'none' }}>
          <TestPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'history' ? 'flex' : 'none' }}>
          <HistoryPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'settings' ? 'flex' : 'none' }}>
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
