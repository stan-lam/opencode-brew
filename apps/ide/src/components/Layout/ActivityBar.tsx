import {
  Files,
  Search,
  GitBranch,
  GitPullRequest,
  Settings,
  History,
  Terminal,
  FlaskConical,
} from 'lucide-react';
import { useLayoutStore, SidePanelTab, BottomPanelTab } from '../../store/layoutStore';
import styles from './ActivityBar.module.css';

interface ActivityItem {
  id: SidePanelTab | BottomPanelTab;
  icon: React.ReactNode;
  title: string;
  position: 'side' | 'bottom';
}

const activityItems: ActivityItem[] = [
  { id: 'explorer', icon: <Files size={22} />, title: 'Explorer (⌘1)', position: 'side' },
  { id: 'search', icon: <Search size={22} />, title: 'Search (⌘⇧F)', position: 'side' },
  { id: 'git', icon: <GitBranch size={22} />, title: 'Source Control (⌘⇧G)', position: 'side' },
  { id: 'codeReview', icon: <GitPullRequest size={22} />, title: 'Code Review', position: 'side' },
  { id: 'test', icon: <FlaskConical size={22} />, title: 'Test (⌘⇧T)', position: 'side' },
  { id: 'history', icon: <History size={22} />, title: 'Local History', position: 'side' },
];

const bottomItems: ActivityItem[] = [
  { id: 'terminal', icon: <Terminal size={22} />, title: 'Terminal (⌘`)', position: 'bottom' },
];

interface ActivityBarProps {
  variant?: 'vertical' | 'horizontal';
}

export function ActivityBar({ variant = 'vertical' }: ActivityBarProps) {
  const {
    activeSideTab,
    activeBottomTab,
    showSidePanel,
    showBottomPanel,
    setActiveSideTab,
    setActiveBottomTab,
    toggleSidePanel,
    toggleBottomPanel,
  } = useLayoutStore();

  const handleSideClick = (id: SidePanelTab) => {
    if (activeSideTab === id && showSidePanel) {
      // Clicking same tab while visible - hide panel
      toggleSidePanel();
    } else {
      // Clicking different tab or panel not visible - show panel with this tab
      // setActiveSideTab already sets showSidePanel: true, so no need to toggle
      setActiveSideTab(id);
    }
  };

  const handleBottomClick = (id: BottomPanelTab) => {
    console.log('ActivityBar: handleBottomClick', id, { activeBottomTab, showBottomPanel });
    if (activeBottomTab === id && showBottomPanel) {
      // Clicking same tab while visible - hide panel
      toggleBottomPanel();
    } else {
      // Clicking different tab or panel not visible - show panel with this tab
      // setActiveBottomTab already sets showBottomPanel: true, so no need to toggle
      setActiveBottomTab(id);
    }
  };

  const isHorizontal = variant === 'horizontal';

  return (
    <div className={`${styles.activityBar} ${isHorizontal ? styles.horizontal : ''}`}>
      <div className={styles.topItems}>
        {activityItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.item} ${
              activeSideTab === item.id && showSidePanel ? styles.active : ''
            }`}
            onClick={() => handleSideClick(item.id as SidePanelTab)}
            title={item.title}
            data-activity-id={item.id}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className={styles.bottomItems}>
        {bottomItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.item} ${
              activeBottomTab === item.id && showBottomPanel ? styles.active : ''
            }`}
            onClick={() => handleBottomClick(item.id as BottomPanelTab)}
            title={item.title}
          >
            {item.icon}
          </button>
        ))}
        <button
          className={styles.item}
          onClick={() => useLayoutStore.getState().setActiveSideTab('settings')}
          title="Settings (⌘,)"
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
}
