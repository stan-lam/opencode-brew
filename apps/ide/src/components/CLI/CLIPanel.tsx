import { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCw, CheckCircle, XCircle, Loader2, Plus, X } from 'lucide-react';
import { terminal as terminalService, TerminalOutput } from '../../services/tauri';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './CLIPanel.module.css';

const darkTheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#4ec9b0',
  yellow: '#dcdcaa',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#cccccc',
  brightBlack: '#6d6d6d',
  brightRed: '#f14c4c',
  brightGreen: '#4ec9b0',
  brightYellow: '#dcdcaa',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

const lightTheme = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#1e1e1e',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  black: '#1e1e1e',
  red: '#cd3131',
  green: '#107c41',
  yellow: '#795e26',
  blue: '#0066bf',
  magenta: '#af00db',
  cyan: '#107c41',
  white: '#cccccc',
  brightBlack: '#616161',
  brightRed: '#cd3131',
  brightGreen: '#107c41',
  brightYellow: '#795e26',
  brightBlue: '#0066bf',
  brightMagenta: '#af00db',
  brightCyan: '#107c41',
  brightWhite: '#1e1e1e',
};

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
  const terminalsMapRef = useRef<Map<string, { terminal: any; fitAddon: any; unlisten?: () => void }>>(new Map());
  
  const [cliTabs, setCliTabs] = useState<CLITab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  
  const { currentWorkspace } = useWorkspaceStore();
  const { theme } = useSettingsStore();
  const terminalTheme = theme === 'light' ? lightTheme : darkTheme;

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

  // Update terminal theme when settings change
  useEffect(() => {
    terminalsMapRef.current.forEach((instance) => {
      instance.terminal.options.theme = terminalTheme;
    });
  }, [terminalTheme]);

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

      const currentTheme = useSettingsStore.getState().theme === 'light' ? lightTheme : darkTheme;
      const term = new Terminal({
        theme: currentTheme,
        fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'bar',
        convertEol: true,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

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

      // Create the PTY backend
      const cwd = currentWorkspace?.rootPath;
      const { rows, cols } = term;
      await terminalService.create(terminalId, cwd, rows, cols);

      // Store the instance
      terminalsMapRef.current.set(terminalId, { terminal: term, fitAddon, unlisten });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        const instance = terminalsMapRef.current.get(terminalId);
        if (instance) {
          instance.fitAddon.fit();
          const { rows, cols } = instance.terminal;
          terminalService.resize(terminalId, rows, cols).catch(console.error);
        }
      });
      resizeObserver.observe(terminalRef.current);

      // Longer delay to ensure PTY is fully initialized
      await new Promise(resolve => setTimeout(resolve, 500));
      await terminalService.write(terminalId, fullCommand + '\n');

      updateTabState(tabId, { status: 'running' });
      term.focus();

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
    return <div className={styles.cliPanel}>Loading...</div>;
  }

  return (
    <div className={styles.cliPanel}>
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

      <div className={styles.terminalWrapper} onClick={focusTerminal}>
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
