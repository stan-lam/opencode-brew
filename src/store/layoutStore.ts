import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidePanelTab =
  | 'explorer'
  | 'search'
  | 'git'
  | 'ai'
  | 'test'
  | 'history'
  | 'plugins'
  | 'settings';

export type BottomPanelTab = 'terminal' | 'problems' | 'output' | 'cli';

interface LayoutState {
  showSidePanel: boolean;
  showBottomPanel: boolean;
  sidePanelPosition: 'left' | 'right';
  activeSideTab: SidePanelTab;
  activeBottomTab: BottomPanelTab | null;
  toggleSidePanel: () => void;
  toggleBottomPanel: () => void;
  setShowBottomPanel: (show: boolean) => void;
  setActiveSideTab: (tab: SidePanelTab) => void;
  setActiveBottomTab: (tab: BottomPanelTab) => void;
  setSidePanelPosition: (position: 'left' | 'right') => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      showSidePanel: true,
      showBottomPanel: false,
      sidePanelPosition: 'left',
      activeSideTab: 'explorer',
      activeBottomTab: 'terminal',

      toggleSidePanel: () =>
        set((state) => {
          console.log('toggleSidePanel:', !state.showSidePanel);
          return { showSidePanel: !state.showSidePanel };
        }),

      toggleBottomPanel: () =>
        set((state) => {
          const newShow = !state.showBottomPanel;
          console.log('toggleBottomPanel:', newShow);
          return {
            showBottomPanel: newShow,
            activeBottomTab: state.activeBottomTab || 'terminal',
          };
        }),

      setShowBottomPanel: (show) => {
        console.log('setShowBottomPanel:', show);
        set((state) => ({
          showBottomPanel: show,
          activeBottomTab: show ? (state.activeBottomTab || 'terminal') : state.activeBottomTab,
        }));
      },

      setActiveSideTab: (tab) => {
        console.log('setActiveSideTab:', tab);
        set({ activeSideTab: tab, showSidePanel: true });
      },

      setActiveBottomTab: (tab) => {
        console.log('setActiveBottomTab:', tab);
        set({ activeBottomTab: tab, showBottomPanel: true });
      },

      setSidePanelPosition: (position) =>
        set({ sidePanelPosition: position }),
    }),
    {
      name: 'opencodebrew-layout',
      version: 2,
      partialize: (state) => ({
        showSidePanel: state.showSidePanel,
        showBottomPanel: state.showBottomPanel,
        sidePanelPosition: state.sidePanelPosition,
        activeBottomTab: state.activeBottomTab,
      }),
    }
  )
);
