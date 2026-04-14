import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { terminal as terminalService, TerminalOutput } from '../../services/tauri';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './TerminalPanel.module.css';

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
  const { theme } = useSettingsStore();
  const terminalTheme = theme === 'light' ? lightTheme : darkTheme;

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

      const currentTheme = useSettingsStore.getState().theme === 'light' ? lightTheme : darkTheme;
      const term = new Terminal({
        theme: currentTheme,
        fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'bar',
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

  // Update terminal theme when settings change
  useEffect(() => {
    terminalsMapRef.current.forEach((instance) => {
      instance.terminal.options.theme = terminalTheme;
    });
  }, [terminalTheme]);

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
    <div className={styles.terminalPanel}>
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
