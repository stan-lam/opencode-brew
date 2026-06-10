import { useLayoutStore } from '../../store/layoutStore';
import { FileTree } from '../FileTree/FileTree';
import { SearchPanel } from '../Search/SearchPanel';
import { GitPanel } from '../Git/GitPanel';
import { AIPanel } from '../AI/AIPanel';
import { TestPanel } from '../Test/TestPanel';
import { HistoryPanel } from '../History/HistoryPanel';
import { PluginsPanel } from '../Plugins/PluginsPanel';
import { SettingsPanel } from '../Settings/SettingsPanel';
import styles from './SidePanel.module.css';

const panelTitles: Record<string, string> = {
  explorer: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  ai: 'AI Assistant',
  test: 'Test',
  history: 'Local History',
  plugins: 'Plugins',
  settings: 'Settings',
};

export function SidePanel() {
  const { activeSideTab, showSidePanel } = useLayoutStore();
  
  console.log('SidePanel render:', { activeSideTab, showSidePanel });

  return (
    <div className={styles.sidePanel}>
      <div className={styles.header}>
        <span className={styles.title}>{panelTitles[activeSideTab] || 'Explorer'}</span>
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
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'ai' ? 'flex' : 'none' }}>
          <AIPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'test' ? 'flex' : 'none' }}>
          <TestPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'history' ? 'flex' : 'none' }}>
          <HistoryPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'plugins' ? 'flex' : 'none' }}>
          <PluginsPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeSideTab === 'settings' ? 'flex' : 'none' }}>
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
