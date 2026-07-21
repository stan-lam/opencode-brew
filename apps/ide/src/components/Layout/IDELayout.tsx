import { useState, useEffect } from 'react';
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
import { AIPanel } from '../AI/AIPanel';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './IDELayout.module.css';

export function IDELayout() {
  const {
    showSidePanel,
    showBottomPanel,
    showAIPanel,
    showEditorPanel,
    activeBottomTab,
  } = useLayoutStore();
  const clampPercent = (value: number, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, min), max);
  };
  const {
    fontSize,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    aiPanelMaxPercent,
    aiPanelMaxPercentSolo,
    editorPanelMinPercent,
  } = useSettingsStore();
  const safeAiMaxWithEditor = clampPercent(aiPanelMaxPercent, 30, 90, 70);
  const safeAiMaxSolo = clampPercent(aiPanelMaxPercentSolo, 40, 95, 85);
  const safeEditorMin = clampPercent(editorPanelMinPercent, 10, 60, 20);
  const leftPanelMaxSize = showEditorPanel ? 40 : showAIPanel ? 70 : 100;
  const aiPanelMaxSize = showEditorPanel ? safeAiMaxWithEditor : safeAiMaxSolo;
  const editorPanelMinSize = showAIPanel ? safeEditorMin : 30;
  const horizontalLayoutKey = `${showSidePanel}-${showEditorPanel}-${showAIPanel}`;
  
  const [showRunConfigEditor, setShowRunConfigEditor] = useState(false);
  const [panelKey] = useState(0);
  
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
  
  console.log('IDELayout render:', { showSidePanel, showBottomPanel, activeBottomTab });

  return (
    <div className={styles.container}>
      <TitleBar />
      <RunToolbar />
      <div className={styles.main}>
        <div className={styles.content}>
          <PanelGroup direction="vertical" autoSaveId="main-vertical">
            <Panel defaultSize={75} minSize={30}>
              <PanelGroup
                key={`horizontal-left-${horizontalLayoutKey}-${panelKey}`}
                direction="horizontal"
                autoSaveId={`main-horizontal-left-${horizontalLayoutKey}`}
              >
                <Panel className={styles.leftPanel} defaultSize={22} minSize={16} maxSize={leftPanelMaxSize}>
                  <ActivityBar variant="horizontal" />
                  <div
                    className={`${styles.sidePanelContainer} ${
                      showSidePanel ? '' : styles.sidePanelCollapsed
                    }`}
                  >
                    <SidePanel />
                  </div>
                </Panel>
                {(showEditorPanel || showAIPanel) && (
                  <PanelResizeHandle className={styles.resizeHandle} />
                )}
                {showEditorPanel && (
                  <Panel minSize={editorPanelMinSize}>
                    <EditorArea />
                  </Panel>
                )}
                {showAIPanel && (
                  <>
                    {showEditorPanel && <PanelResizeHandle className={styles.resizeHandle} />}
                    <Panel className={styles.aiPanel} defaultSize={26} minSize={18} maxSize={aiPanelMaxSize}>
                      <AIPanel />
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
