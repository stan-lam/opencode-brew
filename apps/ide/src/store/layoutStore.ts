import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidePanelTab =
  | 'explorer'
  | 'search'
  | 'git'
  | 'codeReview'
  | 'test'
  | 'history'
  | 'settings'
  | 'plans';

export type BottomPanelTab = 'terminal' | 'problems' | 'output' | 'cli';

interface LayoutState {
  showSidePanel: boolean;
  showBottomPanel: boolean;
  showAIPanel: boolean;
  showEditorPanel: boolean;
  sidePanelPosition: 'left' | 'right';
  activeSideTab: SidePanelTab;
  activeBottomTab: BottomPanelTab | null;
  syncExplorerWithEditor: boolean;
  toggleSidePanel: () => void;
  toggleBottomPanel: () => void;
  toggleAIPanel: () => void;
  toggleEditorPanel: () => void;
  setShowEditorPanel: (show: boolean) => void;
  setShowAIPanel: (show: boolean) => void;
  setShowBottomPanel: (show: boolean) => void;
  setActiveSideTab: (tab: SidePanelTab) => void;
  setActiveBottomTab: (tab: BottomPanelTab) => void;
  setSidePanelPosition: (position: 'left' | 'right') => void;
  toggleSyncExplorerWithEditor: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      showSidePanel: true,
      showBottomPanel: false,
      showAIPanel: false,
      showEditorPanel: true,
      sidePanelPosition: 'left',
      activeSideTab: 'explorer',
      activeBottomTab: 'terminal',
      syncExplorerWithEditor: false,

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

      toggleAIPanel: () =>
        set((state) => ({ showAIPanel: !state.showAIPanel })),

      toggleEditorPanel: () =>
        set((state) => ({ showEditorPanel: !state.showEditorPanel })),

      setShowEditorPanel: (show) =>
        set({ showEditorPanel: show }),

      setShowAIPanel: (show) =>
        set({ showAIPanel: show }),

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

      setSidePanelPosition: (_position) =>
        set({ sidePanelPosition: 'left' }),

      toggleSyncExplorerWithEditor: () =>
        set((state) => ({ syncExplorerWithEditor: !state.syncExplorerWithEditor })),
    }),
    {
      name: 'opencodebrew-layout',
      version: 3,
      partialize: (state) => ({
        showSidePanel: state.showSidePanel,
        showBottomPanel: state.showBottomPanel,
        showAIPanel: state.showAIPanel,
        showEditorPanel: state.showEditorPanel,
        sidePanelPosition: state.sidePanelPosition,
        activeBottomTab: state.activeBottomTab,
        syncExplorerWithEditor: state.syncExplorerWithEditor,
      }),
    }
  )
);
