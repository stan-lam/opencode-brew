import { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCw, CheckCircle, XCircle, Loader2, Plus, X } from 'lucide-react';
import { terminal as terminalService, TerminalOutput } from '../../services/tauri';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLayoutStore } from '../../store/layoutStore';
import styles from './CLIPanel.module.css';

// Build terminal theme from settings
const buildTerminalTheme = (settings: ReturnType<typeof useSettingsStore.getState>) => ({
  background: settings.terminalBackground,
  foreground: settings.terminalForeground,
  cursor: settings.terminalCursor,
  cursorAccent: settings.terminalBackground,
  selectionBackground: settings.terminalSelectionBackground,
  black: settings.terminalBlack,
  red: settings.terminalRed,
  green: settings.terminalGreen,
  yellow: settings.terminalYellow,
  blue: settings.terminalBlue,
  magenta: settings.terminalMagenta,
  cyan: settings.terminalCyan,
  white: settings.terminalWhite,
  brightBlack: '#6d6d6d',
  brightRed: settings.terminalRed,
  brightGreen: settings.terminalGreen,
  brightYellow: settings.terminalYellow,
  brightBlue: settings.terminalBlue,
  brightMagenta: settings.terminalMagenta,
  brightCyan: settings.terminalCyan,
  brightWhite: '#ffffff',
});

type CLITool = 'claude-code' | 'opencode' | 'custom';
type CLIStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

interface CLITab {
  id: string;
  name: string;
  tool: CLITool;
  customCommand: string;
  status: CLIStatus;
  terminalId: string;
}

interface CLIConfig {
  tool: CLITool;
  command: string;
  args: string[];
  description: string;
}

const CLI_PRESETS: Record<CLITool, CLIConfig> = {
  'claude-code': {
    tool: 'claude-code',
    command: 'claude',
    args: [],
    description: 'Claude Code CLI (Anthropic)',
  },
  'opencode': {
    tool: 'opencode',
    command: 'opencode',
    args: [],
    description: 'OpenCode CLI',
  },
  'custom': {
    tool: 'custom',
    command: '',
    args: [],
    description: 'Custom command',
  },
};

export function CLIPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const terminalsMapRef = useRef<Map<string, { terminal: any; fitAddon: any; unlisten?: () => void }>>(new Map());
  
  const [cliTabs, setCliTabs] = useState<CLITab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  
  const { currentWorkspace } = useWorkspaceStore();
  const settings = useSettingsStore();
  const { activeBottomTab } = useLayoutStore();
  const terminalTheme = buildTerminalTheme(settings);
  const wasHiddenRef = useRef(activeBottomTab !== 'cli');

  // Re-fit terminals when CLI tab becomes visible after being hidden
  useEffect(() => {
    const isVisible = activeBottomTab === 'cli';
    const wasHidden = wasHiddenRef.current;
    wasHiddenRef.current = !isVisible;

    if (isVisible && wasHidden) {
      // Multiple attempts to ensure terminal renders correctly after tab switch
      const fitTerminals = (final: boolean = false) => {
        terminalsMapRef.current.forEach((instance, terminalId) => {
          if (instance.fitAddon && instance.terminal) {
            instance.fitAddon.fit();
            const { rows, cols } = instance.terminal;
            console.log('[CLI] Tab switch fit:', { rows, cols, final });
            // Force complete redraw
            instance.terminal.refresh(0, rows - 1);
            // Only send resize on final attempt to avoid rapid resizes
            if (final) {
              terminalService.resize(terminalId, rows, cols).catch(console.error);
            }
          }
        });
      };

      // Try multiple times with increasing delays
      // First two are for visual refresh, last one sends resize to PTY
      const t1 = setTimeout(() => fitTerminals(false), 0);
      const t2 = setTimeout(() => fitTerminals(false), 100);
      const t3 = setTimeout(() => fitTerminals(true), 250);
      
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [activeBottomTab]);

  // Get active tab
  const activeTab = cliTabs.find(t => t.id === activeTabId);

  // Initialize first CLI tab on mount
  useEffect(() => {
    if (cliTabs.length === 0) {
      const id = crypto.randomUUID();
      setCliTabs([{
        id,
        name: 'CLI 1',
        tool: 'claude-code',
        customCommand: '',
        status: 'idle',
        terminalId: `cli-${crypto.randomUUID()}`,
      }]);
      setActiveTabId(id);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      terminalsMapRef.current.forEach((instance, terminalId) => {
        instance.unlisten?.();
        instance.terminal?.dispose();
        terminalService.close(terminalId).catch(console.error);
      });
      terminalsMapRef.current.clear();
    };
  }, []);

  // Update terminal settings when they change
  useEffect(() => {
    terminalsMapRef.current.forEach((instance) => {
      instance.terminal.options.theme = terminalTheme;
      instance.terminal.options.fontSize = settings.terminalFontSize;
      instance.terminal.options.fontFamily = settings.terminalFontFamily;
      instance.terminal.options.lineHeight = settings.terminalLineHeight;
      instance.terminal.options.cursorStyle = settings.terminalCursorStyle;
      instance.terminal.options.cursorBlink = settings.terminalCursorBlink;
      instance.fitAddon.fit();
    });
  }, [
    terminalTheme,
    settings.terminalFontSize,
    settings.terminalFontFamily,
    settings.terminalLineHeight,
    settings.terminalCursorStyle,
    settings.terminalCursorBlink
  ]);

  // Update tab state helper
  const updateTabState = (tabId: string, updates: Partial<CLITab>) => {
    setCliTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, ...updates } : tab
    ));
  };

  // Switch terminal display when active tab changes
  useEffect(() => {
    if (!activeTabId) return;

    terminalsMapRef.current.forEach((instance, terminalId) => {
      const tab = cliTabs.find(t => t.terminalId === terminalId);
      if (instance.terminal.element) {
        instance.terminal.element.style.display = 
          tab?.id === activeTabId ? 'block' : 'none';
      }
    });

    const activeTerminal = terminalsMapRef.current.get(activeTab?.terminalId || '');
    if (activeTerminal) {
      activeTerminal.fitAddon.fit();
      activeTerminal.terminal.focus();
    }
  }, [activeTabId, cliTabs, activeTab]);

  const startCLI = async () => {
    if (!activeTab) {
      console.error('Active tab not ready');
      return;
    }

    // Wait for terminal ref to be ready (max 2 seconds)
    let attempts = 0;
    while (!terminalRef.current && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!terminalRef.current) {
      console.error('Terminal container not ready after waiting');
      updateTabState(activeTab.id, { status: 'error' });
      return;
    }

    const tabId = activeTab.id;
    const terminalId = activeTab.terminalId;

    // Clean up any existing terminal for this tab
    const existing = terminalsMapRef.current.get(terminalId);
    if (existing) {
      existing.unlisten?.();
      existing.terminal?.dispose();
      await terminalService.close(terminalId).catch(() => {});
      terminalsMapRef.current.delete(terminalId);
      
      // Create new terminal ID
      const newTerminalId = `cli-${crypto.randomUUID()}`;
      updateTabState(tabId, { terminalId: newTerminalId, status: 'starting' });
      
      // Wait for state update before continuing
      await new Promise(resolve => setTimeout(resolve, 50));
      return startCLI();
    }

    updateTabState(tabId, { status: 'starting' });

    const config = activeTab.tool === 'custom' 
      ? { ...CLI_PRESETS.custom, command: activeTab.customCommand }
      : CLI_PRESETS[activeTab.tool];

    const fullCommand = config.command + (config.args.length > 0 ? ' ' + config.args.join(' ') : '');

    try {
      // Clear the container
      if (terminalRef.current) {
        terminalRef.current.innerHTML = '';
      }

      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      const currentSettings = useSettingsStore.getState();
      const currentTheme = buildTerminalTheme(currentSettings);
      const term = new Terminal({
        theme: currentTheme,
        fontFamily: currentSettings.terminalFontFamily,
        fontSize: currentSettings.terminalFontSize,
        lineHeight: currentSettings.terminalLineHeight,
        cursorBlink: currentSettings.terminalCursorBlink,
        cursorStyle: currentSettings.terminalCursorStyle,
        convertEol: true,
        scrollback: currentSettings.terminalScrollback,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      
      // Wait for container to have stable dimensions
      // This is crucial because flex layout may not be complete immediately
      const waitForStableDimensions = (): Promise<{ cols: number; rows: number }> => {
        return new Promise((resolve) => {
          let lastWidth = 0;
          let lastHeight = 0;
          let stableCount = 0;
          
          const checkDimensions = () => {
            const rect = terminalRef.current?.getBoundingClientRect();
            if (!rect) {
              setTimeout(checkDimensions, 50);
              return;
            }
            
            console.log('[CLI] Checking dimensions:', { width: rect.width, height: rect.height, lastWidth, lastHeight });
            
            if (rect.width === lastWidth && rect.height === lastHeight && rect.width > 100) {
              stableCount++;
              if (stableCount >= 2) {
                // Dimensions are stable, fit and return
                fitAddon.fit();
                console.log('[CLI] Stable dimensions:', { cols: term.cols, rows: term.rows, width: rect.width, height: rect.height });
                resolve({ cols: term.cols, rows: term.rows });
                return;
              }
            } else {
              stableCount = 0;
            }
            
            lastWidth = rect.width;
            lastHeight = rect.height;
            
            // Keep checking
            setTimeout(checkDimensions, 50);
          };
          
          // Start checking after a small delay
          setTimeout(checkDimensions, 50);
          
          // Fallback: resolve after 500ms regardless
          setTimeout(() => {
            fitAddon.fit();
            console.log('[CLI] Fallback dimensions:', { cols: term.cols, rows: term.rows });
            resolve({ cols: term.cols, rows: term.rows });
          }, 500);
        });
      };
      
      const { cols: initialCols, rows: initialRows } = await waitForStableDimensions();
      console.log('[CLI] Final dimensions for PTY:', { cols: initialCols, rows: initialRows });

      // Show startup message
      term.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      term.writeln(`\x1b[1;33m▶ Starting ${CLI_PRESETS[activeTab.tool].description}\x1b[0m`);
      term.writeln(`\x1b[90m  Command: ${fullCommand}\x1b[0m`);
      term.writeln(`\x1b[90m  Directory: ${currentWorkspace?.rootPath || '~'}\x1b[0m`);
      term.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      term.writeln('');

      // Handle user input
      term.onData((data: string) => {
        terminalService.write(terminalId, data).catch(console.error);
      });

      // Listen for output from PTY
      const unlisten = await terminalService.onOutput(terminalId, (output: TerminalOutput) => {
        term.write(output.data);
      });

      // Create the PTY backend with the stable dimensions we calculated above
      const cwd = currentWorkspace?.rootPath;
      console.log('[CLI] Creating PTY with stable dimensions:', {
        rows: initialRows, cols: initialCols, terminalId
      });
      await terminalService.create(terminalId, cwd, initialRows, initialCols);

      // Store the instance
      terminalsMapRef.current.set(terminalId, { terminal: term, fitAddon, unlisten });

      // Handle resize with debouncing to avoid issues during resize drag
      // Ink-based TUIs like Claude Code have issues with xterm.js reflow
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
      let lastSentCols = initialCols;
      let lastSentRows = initialRows;
      
      const resizeObserver = new ResizeObserver(() => {
        // Debounce resize - wait for user to stop resizing
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
        
        resizeTimeout = setTimeout(() => {
          const instance = terminalsMapRef.current.get(terminalId);
          if (instance) {
            instance.fitAddon.fit();
            const { rows, cols } = instance.terminal;

            // Only send resize if dimensions actually changed
            if (cols !== lastSentCols || rows !== lastSentRows) {
              console.log('[CLI] Resize:', { 
                rows, cols, 
                prevRows: lastSentRows, prevCols: lastSentCols 
              });
              lastSentCols = cols;
              lastSentRows = rows;
              
              // Send resize to PTY - Claude Code will handle SIGWINCH and redraw
              terminalService.resize(terminalId, rows, cols).catch(console.error);
            }
          }
        }, 200); // Wait 200ms after resize stops to allow xterm reflow to complete
      });
      resizeObserver.observe(terminalRef.current);

      // Longer delay to ensure PTY is fully initialized
      await new Promise(resolve => setTimeout(resolve, 500));
      await terminalService.write(terminalId, fullCommand + '\n');

      updateTabState(tabId, { status: 'running' });
      term.focus();
      
      // After CLI tool starts, send resize events to ensure it has correct dimensions
      // (some CLI tools query size on startup before SIGWINCH handler is registered)
      const sendResize = (delay: number) => {
        setTimeout(() => {
          const instance = terminalsMapRef.current.get(terminalId);
          if (instance) {
            instance.fitAddon.fit();
            const { rows, cols } = instance.terminal;
            console.log(`[CLI] Resize after ${delay}ms:`, { rows, cols });
            terminalService.resize(terminalId, rows, cols).catch(console.error);
          }
        }, delay);
      };
      // Send multiple resize events to ensure CLI tool picks up correct size
      sendResize(500);
      sendResize(1000);
      sendResize(2000);

    } catch (error) {
      console.error('Failed to start CLI:', error);
      updateTabState(tabId, { status: 'error' });
    }
  };

  const stopCLI = async () => {
    if (!activeTab) return;

    try {
      const instance = terminalsMapRef.current.get(activeTab.terminalId);
      if (instance) {
        // Send Ctrl+C
        await terminalService.write(activeTab.terminalId, '\x03');
        await new Promise(resolve => setTimeout(resolve, 100));
        
        instance.unlisten?.();
        instance.terminal?.dispose();
        await terminalService.close(activeTab.terminalId);
        terminalsMapRef.current.delete(activeTab.terminalId);
        
        // Clear container
        if (terminalRef.current) {
          terminalRef.current.innerHTML = '';
        }
        
        // Create new terminal ID for restart
        const newTerminalId = `cli-${crypto.randomUUID()}`;
        updateTabState(activeTab.id, { terminalId: newTerminalId, status: 'stopped' });
      }
      
    } catch (error) {
      console.error('Failed to stop CLI:', error);
      updateTabState(activeTab.id, { status: 'error' });
    }
  };

  const restartCLI = async () => {
    await stopCLI();
    setTimeout(() => startCLI(), 200);
  };

  const focusTerminal = () => {
    if (activeTab) {
      const instance = terminalsMapRef.current.get(activeTab.terminalId);
      instance?.terminal?.focus();
    }
  };

  const addCliTab = () => {
    const id = crypto.randomUUID();
    const num = cliTabs.length + 1;
    const newTab: CLITab = {
      id,
      name: `CLI ${num}`,
      tool: 'claude-code',
      customCommand: '',
      status: 'idle',
      terminalId: `cli-${crypto.randomUUID()}`,
    };
    setCliTabs([...cliTabs, newTab]);
    setActiveTabId(id);
  };

  const closeCliTab = (tabId: string) => {
    if (cliTabs.length === 1) return;
    
    const tab = cliTabs.find(t => t.id === tabId);
    if (tab) {
      const instance = terminalsMapRef.current.get(tab.terminalId);
      if (instance) {
        instance.unlisten?.();
        instance.terminal?.dispose();
        terminalsMapRef.current.delete(tab.terminalId);
        terminalService.close(tab.terminalId).catch(console.error);
      }
    }
    
    const newTabs = cliTabs.filter(t => t.id !== tabId);
    setCliTabs(newTabs);
    
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
  };

  if (!activeTab) {
    return (
      <div 
        className={styles.cliPanel}
        style={{ backgroundColor: settings.terminalBackground }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div 
      className={styles.cliPanel}
      style={{ backgroundColor: settings.terminalBackground }}
    >
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {cliTabs.map((tab) => (
            <div
              key={tab.id}
              className={`${styles.tab} ${activeTabId === tab.id ? styles.active : ''}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.name}</span>
              {cliTabs.length > 1 && (
                <button
                  className={styles.closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeCliTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className={styles.addBtn} onClick={addCliTab} title="New CLI">
          <Plus size={16} />
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolSelector}>
          <select 
            value={activeTab.tool}
            onChange={(e) => updateTabState(activeTab.id, { tool: e.target.value as CLITool })}
            disabled={activeTab.status === 'running' || activeTab.status === 'starting'}
          >
            <option value="claude-code">Claude Code</option>
            <option value="opencode">OpenCode</option>
            <option value="custom">Custom CLI</option>
          </select>
          {activeTab.tool === 'custom' && (
            <input
              type="text"
              placeholder="Enter command..."
              value={activeTab.customCommand}
              onChange={(e) => updateTabState(activeTab.id, { customCommand: e.target.value })}
              disabled={activeTab.status === 'running' || activeTab.status === 'starting'}
              className={styles.customInput}
            />
          )}
        </div>

        <div className={styles.status}>
          {activeTab.status === 'idle' && <span className={styles.statusIdle}>Ready</span>}
          {activeTab.status === 'starting' && (
            <span className={styles.statusStarting}>
              <Loader2 size={14} className={styles.spinner} />
              Starting...
            </span>
          )}
          {activeTab.status === 'running' && (
            <span className={styles.statusRunning}>
              <CheckCircle size={14} />
              Running
            </span>
          )}
          {activeTab.status === 'stopped' && <span className={styles.statusStopped}>Stopped</span>}
          {activeTab.status === 'error' && (
            <span className={styles.statusError}>
              <XCircle size={14} />
              Error
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {activeTab.status !== 'running' ? (
            <button 
              className={styles.startBtn} 
              onClick={startCLI}
              disabled={activeTab.status === 'starting' || (activeTab.tool === 'custom' && !activeTab.customCommand)}
              title="Start CLI"
            >
              <Play size={16} />
              Start
            </button>
          ) : (
            <>
              <button className={styles.restartBtn} onClick={restartCLI} title="Restart">
                <RefreshCw size={16} />
              </button>
              <button className={styles.stopBtn} onClick={stopCLI} title="Stop CLI">
                <Square size={16} />
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div ref={wrapperRef} className={styles.terminalWrapper} onClick={focusTerminal}>
        <div 
          ref={terminalRef} 
          className={styles.terminalContainer}
        />
        {activeTab.status === 'idle' && (
          <div className={styles.placeholder}>
            <p>Select a CLI tool and click <strong>Start</strong> to begin.</p>
            <p className={styles.hint}>
              Supported: Claude Code, OpenCode, or any custom CLI command.
            </p>
          </div>
        )}
        {activeTab.status === 'stopped' && (
          <div className={styles.placeholder}>
            <p style={{ color: 'var(--warning-color)' }}>■ CLI stopped</p>
            <p className={styles.hint}>Click Start to run again.</p>
          </div>
        )}
        {activeTab.status === 'error' && (
          <div className={styles.placeholder}>
            <p style={{ color: 'var(--error-color)' }}>✗ Failed to start CLI</p>
            <p className={styles.hint}>
              Make sure the command is installed and in your PATH.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
