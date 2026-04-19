import {
  Files,
  Search,
  GitBranch,
  MessageSquare,
  Settings,
  History,
  Terminal,
  Puzzle,
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
  { id: 'ai', icon: <MessageSquare size={22} />, title: 'AI Assistant (⌘⇧A)', position: 'side' },
  { id: 'history', icon: <History size={22} />, title: 'Local History', position: 'side' },
  { id: 'plugins', icon: <Puzzle size={22} />, title: 'Plugins', position: 'side' },
];

const bottomItems: ActivityItem[] = [
  { id: 'terminal', icon: <Terminal size={22} />, title: 'Terminal (⌘`)', position: 'bottom' },
];

export function ActivityBar() {
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
    console.log('ActivityBar: handleSideClick', id);
    console.log('ActivityBar: current state', { activeSideTab, showSidePanel });
    if (activeSideTab === id && showSidePanel) {
      console.log('ActivityBar: toggling side panel off');
      toggleSidePanel();
    } else {
      console.log('ActivityBar: setting active tab to', id);
      setActiveSideTab(id);
      if (!showSidePanel) {
        console.log('ActivityBar: showing side panel');
        toggleSidePanel();
      }
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

  return (
    <div className={styles.activityBar}>
      <div className={styles.topItems}>
        {activityItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.item} ${
              activeSideTab === item.id && showSidePanel ? styles.active : ''
            }`}
            onClick={() => handleSideClick(item.id as SidePanelTab)}
            title={item.title}
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
