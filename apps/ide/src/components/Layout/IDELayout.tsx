import { useState, useEffect, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TitleBar } from './TitleBar';
import { ActivityBar } from './ActivityBar';
import { StatusBar } from './StatusBar';
import { SidePanel } from './SidePanel';
import { EditorArea } from '../Editor/EditorArea';
import { BottomPanel } from './BottomPanel';
import { RunToolbar } from './RunToolbar';
import { NotificationContainer } from './Notification';
import { FontSizeIndicator } from './FontSizeIndicator';
import { RunConfigEditor } from './RunConfigEditor';
import { UpdateChecker } from './UpdateChecker';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './IDELayout.module.css';

export function IDELayout() {
  const {
    showSidePanel,
    showBottomPanel,
    sidePanelPosition,
    activeBottomTab,
  } = useLayoutStore();
  
  const { fontSize, increaseFontSize, decreaseFontSize, resetFontSize } = useSettingsStore();
  
  const [showRunConfigEditor, setShowRunConfigEditor] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const prevPositionRef = useRef(sidePanelPosition);
  
  // Clear cached panel sizes and force remount when position changes
  useEffect(() => {
    if (prevPositionRef.current !== sidePanelPosition) {
      // Clear any cached panel data for both positions
      localStorage.removeItem('react-resizable-panels:main-horizontal-left');
      localStorage.removeItem('react-resizable-panels:main-horizontal-right');
      localStorage.removeItem('react-resizable-panels:main-horizontal');
      prevPositionRef.current = sidePanelPosition;
      // Force a complete remount of the panel group
      setPanelKey(k => k + 1);
    }
  }, [sidePanelPosition]);
  
  useEffect(() => {
    const handleOpenEditor = () => setShowRunConfigEditor(true);
    window.addEventListener('open-run-config-editor', handleOpenEditor);
    return () => window.removeEventListener('open-run-config-editor', handleOpenEditor);
  }, []);
  
  // Global keyboard shortcuts for font size control
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      
      // Check for font size shortcuts (support both key and code for better compatibility)
      const isPlus = e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd';
      const isMinus = e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract';
      const isZero = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0';
      
      if (cmdOrCtrl && (isPlus || isMinus || isZero)) {
        // Check if we're in an input field, textarea, or content editable
        const target = e.target as HTMLElement;
        const isInputField = target.tagName === 'INPUT' || 
                            target.tagName === 'TEXTAREA' || 
                            target.isContentEditable;
        
        // Only handle if not in an input field
        if (!isInputField) {
          e.preventDefault();
          e.stopPropagation();
          
          if (isPlus) {
            increaseFontSize();
            const newSize = useSettingsStore.getState().fontSize;
            window.dispatchEvent(new CustomEvent('font-size-changed', {
              detail: { fontSize: newSize }
            }));
          } else if (isMinus) {
            decreaseFontSize();
            const newSize = useSettingsStore.getState().fontSize;
            window.dispatchEvent(new CustomEvent('font-size-changed', {
              detail: { fontSize: newSize }
            }));
          } else if (isZero) {
            resetFontSize();
            const newSize = useSettingsStore.getState().fontSize;
            window.dispatchEvent(new CustomEvent('font-size-changed', {
              detail: { fontSize: newSize }
            }));
          }
        }
      }
    };
    
    // Use capture phase to intercept before Monaco editor
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [increaseFontSize, decreaseFontSize, resetFontSize]);
  
  console.log('IDELayout render:', { showSidePanel, showBottomPanel, sidePanelPosition, activeBottomTab });

  return (
    <div className={styles.container}>
      <TitleBar />
      <RunToolbar />
      <div className={styles.main}>
        <ActivityBar />
        <div className={styles.content}>
          <PanelGroup direction="vertical" autoSaveId="main-vertical">
            <Panel defaultSize={75} minSize={30}>
              <PanelGroup 
                key={`horizontal-${sidePanelPosition}-${showSidePanel}-${panelKey}`}
                direction="horizontal" 
                autoSaveId={`main-horizontal-${sidePanelPosition}`}
              >
                {showSidePanel && sidePanelPosition === 'left' && (
                  <>
                    <Panel defaultSize={20} minSize={15} maxSize={70}>
                      <SidePanel />
                    </Panel>
                    <PanelResizeHandle className={styles.resizeHandle} />
                  </>
                )}
                <Panel minSize={30}>
                  <EditorArea />
                </Panel>
                {showSidePanel && sidePanelPosition === 'right' && (
                  <>
                    <PanelResizeHandle className={styles.resizeHandle} />
                    <Panel defaultSize={20} minSize={15} maxSize={70}>
                      <SidePanel />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>
            {showBottomPanel && activeBottomTab && (
              <>
                <PanelResizeHandle className={styles.resizeHandleHorizontal} />
                <Panel defaultSize={25} minSize={10} maxSize={60}>
                  <BottomPanel />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      </div>
      <StatusBar />
      <NotificationContainer />
      <FontSizeIndicator />
      {showRunConfigEditor && (
        <RunConfigEditor onClose={() => setShowRunConfigEditor(false)} />
      )}
      <UpdateChecker />
    </div>
  );
}
