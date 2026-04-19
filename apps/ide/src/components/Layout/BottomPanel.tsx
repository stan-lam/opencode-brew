import { X } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { TerminalPanel } from '../Terminal/TerminalPanel';
import { ProblemsPanel } from '../Problems/ProblemsPanel';
import { OutputPanel } from '../Output/OutputPanel';
import { CLIPanel } from '../CLI/CLIPanel';
import styles from './BottomPanel.module.css';

const tabs = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'cli', label: 'CLI' },
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
] as const;

export function BottomPanel() {
  const { activeBottomTab, setActiveBottomTab, toggleBottomPanel } = useLayoutStore();

  return (
    <div className={styles.bottomPanel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tab} ${activeBottomTab === tab.id ? styles.active : ''}`}
              onClick={() => setActiveBottomTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={toggleBottomPanel}
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.panelContainer} style={{ display: activeBottomTab === 'terminal' ? 'block' : 'none' }}>
          <TerminalPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeBottomTab === 'cli' ? 'block' : 'none' }}>
          <CLIPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeBottomTab === 'problems' ? 'block' : 'none' }}>
          <ProblemsPanel />
        </div>
        <div className={styles.panelContainer} style={{ display: activeBottomTab === 'output' ? 'block' : 'none' }}>
          <OutputPanel />
        </div>
      </div>
    </div>
  );
}
