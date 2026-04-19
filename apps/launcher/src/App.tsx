import { useState } from 'react';
import { Code2, MessageSquare, Bot, Settings, Sparkles } from 'lucide-react';
import { SettingsModal } from './components/SettingsModal';
import styles from './App.module.css';

interface ToolCard {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  gradient: string;
  windowLabel: string;
}

const tools: ToolCard[] = [
  {
    id: 'ide',
    name: 'OpenCodeIDE',
    description: 'Full-featured AI-powered code editor with terminal, git, and intelligent completions',
    icon: <Code2 size={32} />,
    color: 'var(--accent-blue)',
    gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0d1117 100%)',
    windowLabel: 'ide',
  },
  {
    id: 'notes',
    name: 'OpenCodeNotes',
    description: 'AI chatbot with organized conversation history, workspaces, folders, and tags',
    icon: <MessageSquare size={32} />,
    color: 'var(--accent-green)',
    gradient: 'linear-gradient(135deg, #1a3d2e 0%, #0d1117 100%)',
    windowLabel: 'notes',
  },
  {
    id: 'assistant',
    name: 'OpenCodeAssistant',
    description: 'Automated task scheduling with AI agents, CLI commands, APIs, and MCP tools',
    icon: <Bot size={32} />,
    color: 'var(--accent-purple)',
    gradient: 'linear-gradient(135deg, #2d1f4e 0%, #0d1117 100%)',
    windowLabel: 'assistant',
  },
];

function App() {
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleLaunchTool = async (tool: ToolCard) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_tool_window', { 
        tool: tool.id,
        label: tool.windowLabel,
        title: tool.name,
      });
    } catch (error) {
      console.error('Failed to launch tool:', error);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <Sparkles size={28} className={styles.logoIcon} />
          <h1>OpenCodeBrew</h1>
        </div>
        <p className={styles.tagline}>All-in-one AI tools for developers</p>
        <button 
          className={styles.settingsBtn} 
          title="Settings"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={20} />
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.toolsGrid}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={styles.toolCard}
              style={{
                '--tool-color': tool.color,
                '--tool-gradient': tool.gradient,
              } as React.CSSProperties}
              onMouseEnter={() => setHoveredTool(tool.id)}
              onMouseLeave={() => setHoveredTool(null)}
              onClick={() => handleLaunchTool(tool)}
            >
              <div className={styles.cardGlow} />
              <div className={styles.cardContent}>
                <div 
                  className={styles.iconWrapper}
                  style={{ color: tool.color }}
                >
                  {tool.icon}
                </div>
                <h2 className={styles.toolName}>{tool.name}</h2>
                <p className={styles.toolDescription}>{tool.description}</p>
                <div className={styles.launchIndicator}>
                  <span>Launch</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path 
                      d="M6 12L10 8L6 4" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <span className={styles.version}>v0.1.0</span>
          <span className={styles.divider}>|</span>
          <a href="https://github.com/opencodebrew" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span className={styles.divider}>|</span>
          <a href="#" onClick={(e) => { e.preventDefault(); }}>
            Documentation
          </a>
        </div>
      </footer>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default App;
