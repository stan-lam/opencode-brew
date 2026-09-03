import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { terminal as terminalService, TerminalOutput } from '../../services/tauri';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLayoutStore } from '../../store/layoutStore';
import styles from './TerminalPanel.module.css';

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
  // Bright colors (slightly lighter versions)
  brightBlack: '#6d6d6d',
  brightRed: settings.terminalRed,
  brightGreen: settings.terminalGreen,
  brightYellow: settings.terminalYellow,
  brightBlue: settings.terminalBlue,
  brightMagenta: settings.terminalMagenta,
  brightCyan: settings.terminalCyan,
  brightWhite: '#ffffff',
});

interface TerminalTab {
  id: string;
  name: string;
}

interface TerminalInstance {
  terminal: any;
  fitAddon: any;
  unlisten?: () => void;
}

export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalsMapRef = useRef<Map<string, TerminalInstance>>(new Map());
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null);
  const { currentWorkspace } = useWorkspaceStore();
  const settings = useSettingsStore();
  const { activeBottomTab } = useLayoutStore();
  const terminalTheme = buildTerminalTheme(settings);
  const wasHiddenRef = useRef(activeBottomTab !== 'terminal');

  // Re-fit terminals when Terminal tab becomes visible after being hidden
  useEffect(() => {
    const isVisible = activeBottomTab === 'terminal';
    const wasHidden = wasHiddenRef.current;
    wasHiddenRef.current = !isVisible;

    if (isVisible && wasHidden) {
      // Multiple attempts to ensure terminal renders correctly after tab switch
      const fitTerminals = () => {
        terminalsMapRef.current.forEach((instance, terminalId) => {
          if (instance.fitAddon && instance.terminal) {
            instance.fitAddon.fit();
            // Force complete redraw
            const { rows, cols } = instance.terminal;
            instance.terminal.refresh(0, rows - 1);
            terminalService.resize(terminalId, rows, cols).catch(console.error);
          }
        });
      };

      // Try multiple times with increasing delays
      const t1 = setTimeout(fitTerminals, 0);
      const t2 = setTimeout(fitTerminals, 100);
      const t3 = setTimeout(fitTerminals, 200);
      
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [activeBottomTab]);


  const createTerminalInstance = useCallback(async (id: string) => {
    // Wait for terminal ref to be ready (max 2 seconds)
    let attempts = 0;
    while (!terminalRef.current && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!terminalRef.current) {
      console.error('Terminal container not ready after waiting');
      return;
    }

    try {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      
      await import('@xterm/xterm/css/xterm.css');

      const currentSettings = useSettingsStore.getState();
      const currentTheme = buildTerminalTheme(currentSettings);
      const term = new Terminal({
        theme: currentTheme,
        fontFamily: currentSettings.terminalFontFamily,
        fontSize: currentSettings.terminalFontSize,
        lineHeight: 1.2,
        cursorBlink: currentSettings.terminalCursorBlink,
        cursorStyle: currentSettings.terminalCursorStyle,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      // Handle user input
      term.onData((data: string) => {
        terminalService.write(id, data).catch(console.error);
      });

      // Listen for output from PTY
      const unlisten = await terminalService.onOutput(id, (output: TerminalOutput) => {
        term.write(output.data);
      });

      // Check if there's a pending command for this terminal
      const pendingCommand = pendingCommandsRef.current.get(id);
      const cwd = pendingCommand?.cwd || currentWorkspace?.rootPath;
      
      // Create the PTY backend
      const { rows, cols } = term;
      await terminalService.create(id, cwd, rows, cols);

      terminalsMapRef.current.set(id, { terminal: term, fitAddon, unlisten });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        const instance = terminalsMapRef.current.get(id);
        if (instance) {
          instance.fitAddon.fit();
          const { rows, cols } = instance.terminal;
          terminalService.resize(id, rows, cols).catch(console.error);
        }
      });
      resizeObserver.observe(terminalRef.current);

      // If there's a pending command, run it after terminal is ready
      if (pendingCommand) {
        // Wait longer to ensure PTY is fully initialized
        setTimeout(async () => {
          try {
            console.log('Running pending command:', pendingCommand.command);
            await terminalService.write(id, pendingCommand.command + '\n');
            pendingCommandsRef.current.delete(id);
          } catch (err) {
            console.error('Failed to run pending command:', err);
          }
        }, 500); // Increased from 300ms to 500ms
      }

    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, [currentWorkspace?.rootPath]);

  const destroyTerminalInstance = useCallback((id: string) => {
    const instance = terminalsMapRef.current.get(id);
    if (instance) {
      instance.unlisten?.();
      instance.terminal.dispose();
      terminalsMapRef.current.delete(id);
      terminalService.close(id).catch(console.error);
    }
  }, []);

  // Initialize first terminal on mount
  useEffect(() => {
    if (terminals.length === 0) {
      const id = crypto.randomUUID();
      setTerminals([{ id, name: 'Terminal 1' }]);
      setActiveTerminal(id);
    }
  }, []);

  // Create terminal instance when active terminal changes
  useEffect(() => {
    if (!activeTerminal) return;

    // Hide all terminals
    terminalsMapRef.current.forEach((instance) => {
      if (instance.terminal.element) {
        instance.terminal.element.style.display = 'none';
      }
    });

    // Show or create active terminal
    const existing = terminalsMapRef.current.get(activeTerminal);
    if (existing) {
      if (existing.terminal.element) {
        existing.terminal.element.style.display = 'block';
        existing.fitAddon.fit();
        existing.terminal.focus();
      }
    } else {
      createTerminalInstance(activeTerminal);
    }
  }, [activeTerminal, createTerminalInstance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      terminalsMapRef.current.forEach((_, id) => {
        destroyTerminalInstance(id);
      });
    };
  }, [destroyTerminalInstance]);

  // Update terminal settings when they change
  useEffect(() => {
    terminalsMapRef.current.forEach((instance) => {
      instance.terminal.options.theme = terminalTheme;
      instance.terminal.options.fontSize = settings.terminalFontSize;
      instance.terminal.options.fontFamily = settings.terminalFontFamily;
      instance.terminal.options.cursorStyle = settings.terminalCursorStyle;
      instance.terminal.options.cursorBlink = settings.terminalCursorBlink;
      // Refit after font changes
      instance.fitAddon.fit();
    });
  }, [
    terminalTheme, 
    settings.terminalFontSize, 
    settings.terminalFontFamily,
    settings.terminalCursorStyle,
    settings.terminalCursorBlink
  ]);

  // Store pending commands to run after terminal is created
  const pendingCommandsRef = useRef<Map<string, { command: string; cwd?: string }>>(new Map());

  // Listen for run-command events from Build/Run menu
  useEffect(() => {
    const handleRunCommand = async (event: CustomEvent<{ terminalId: string; command: string; cwd?: string; label?: string }>) => {
      const { terminalId, command, cwd, label } = event.detail;
      const name = label || 'Run';
      
      console.log('TerminalPanel: run-command event received', { terminalId, command, name });
      
      // Store the command to run after terminal is created
      pendingCommandsRef.current.set(terminalId, { command, cwd });
      
      // Add a new terminal tab for this run
      setTerminals(prev => {
        if (prev.some(t => t.id === terminalId)) {
          return prev;
        }
        return [...prev, { id: terminalId, name }];
      });
      
      // Switch to this terminal - this will trigger creation if needed
      setActiveTerminal(terminalId);
      
      // If terminal already exists, run the command immediately
      if (terminalsMapRef.current.has(terminalId)) {
        setTimeout(async () => {
          try {
            console.log('Terminal already exists, running command immediately');
            await terminalService.write(terminalId, command + '\n');
            pendingCommandsRef.current.delete(terminalId);
          } catch (err) {
            console.error('Failed to run command immediately:', err);
          }
        }, 100);
      }
    };

    window.addEventListener('run-command', handleRunCommand as any);
    
    return () => {
      window.removeEventListener('run-command', handleRunCommand as any);
    };
  }, []);

  const addTerminal = () => {
    const id = crypto.randomUUID();
    const num = terminals.length + 1;
    setTerminals([...terminals, { id, name: `Terminal ${num}` }]);
    setActiveTerminal(id);
  };

  const closeTerminal = (id: string) => {
    if (terminals.length === 1) return;
    
    destroyTerminalInstance(id);
    
    const newTerminals = terminals.filter((t) => t.id !== id);
    setTerminals(newTerminals);
    
    if (activeTerminal === id) {
      setActiveTerminal(newTerminals[0].id);
    }
  };

  return (
    <div 
      className={styles.terminalPanel}
      style={{ backgroundColor: settings.terminalBackground }}
    >
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {terminals.map((term) => (
            <div
              key={term.id}
              className={`${styles.tab} ${activeTerminal === term.id ? styles.active : ''}`}
              onClick={() => setActiveTerminal(term.id)}
            >
              <span>{term.name}</span>
              {terminals.length > 1 && (
                <button
                  className={styles.closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(term.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className={styles.addBtn} onClick={addTerminal} title="New Terminal">
          <Plus size={16} />
        </button>
      </div>
      <div ref={terminalRef} className={styles.terminalContainer} />
    </div>
  );
}
