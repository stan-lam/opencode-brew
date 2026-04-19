import { useState, useEffect, useCallback } from 'react';
import { X, Save, Moon, Sun, Monitor, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import styles from './SettingsModal.module.css';

type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';

interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

interface Settings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  aiProvider: AIProvider;
  model: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  customBaseUrl: string;
  customApiKey: string;
  temperature: number;
  maxTokens: number;
  thinkAloud: boolean;
  mcpServers: MCPServer[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'opencodebrew-notes-settings';

const BUILT_IN_MCP_SERVERS: MCPServer[] = [
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance MCP',
    command: 'npx',
    args: ['-y', 'yfinance-mcp'],
    env: {},
    enabled: false,
  },
  {
    id: 'brave-search',
    name: 'Brave Search MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    enabled: false,
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {},
    enabled: false,
  },
  {
    id: 'github',
    name: 'GitHub MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    enabled: false,
  },
];

const DEFAULT_MODELS: Record<AIProvider, string[]> = {
  ollama: ['llama3', 'llama3.1', 'codellama', 'mistral', 'mixtral', 'phi3', 'gemma2', 'qwen2'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  copilot: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'claude-3.5-sonnet'],
  custom: [],
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>({
    theme: 'dark',
    fontSize: 14,
    aiProvider: 'ollama',
    model: 'llama3',
    ollamaUrl: 'http://localhost:11434',
    openaiKey: '',
    anthropicKey: '',
    customBaseUrl: '',
    customApiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
    thinkAloud: false,
    mcpServers: BUILT_IN_MCP_SERVERS,
  });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'mcp'>('general');
  const [expandedMcp, setExpandedMcp] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchOllamaModels = useCallback(async (baseUrl: string) => {
    setLoadingModels(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const models = await invoke<OllamaModel[]>('list_ollama_models', { baseUrl });
      const modelNames = models.map(m => m.name);
      setOllamaModels(modelNames);
      if (modelNames.length > 0 && !modelNames.includes(settings.model)) {
        setSettings(s => ({ ...s, model: modelNames[0] }));
      }
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error);
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [settings.model]);

  useEffect(() => {
    if (isOpen && settings.aiProvider === 'ollama') {
      fetchOllamaModels(settings.ollamaUrl);
    }
  }, [isOpen, settings.aiProvider, settings.ollamaUrl, fetchOllamaModels]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        
        // Migrate old MCP package names
        const packageMigrations: Record<string, string> = {
          '@anthropic-ai/mcp-server-brave-search': '@modelcontextprotocol/server-brave-search',
          '@anthropic-ai/mcp-server-filesystem': '@modelcontextprotocol/server-filesystem',
          '@anthropic-ai/mcp-server-github': '@modelcontextprotocol/server-github',
        };
        
        let mcpServers = parsed.mcpServers?.length ? parsed.mcpServers : BUILT_IN_MCP_SERVERS;
        let migrated = false;
        
        mcpServers = mcpServers.map((server: MCPServer) => {
          const newArgs = server.args.map((arg: string) => {
            if (packageMigrations[arg]) {
              migrated = true;
              console.log(`[Notes] Migrating MCP package: ${arg} -> ${packageMigrations[arg]}`);
              return packageMigrations[arg];
            }
            return arg;
          });
          return { ...server, args: newArgs };
        });
        
        const newSettings = {
          ...settings,
          ...parsed,
          mcpServers,
        };
        
        setSettings(newSettings);
        
        // Save migrated settings
        if (migrated) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
          console.log('[Notes] MCP settings migrated and saved');
        }
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (settings.theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
    document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
  }, [settings.theme, settings.fontSize]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateMcpServer = (id: string, updates: Partial<MCPServer>) => {
    setSettings({
      ...settings,
      mcpServers: settings.mcpServers.map(s => s.id === id ? { ...s, ...updates } : s),
    });
  };

  const addCustomMcpServer = () => {
    const newServer: MCPServer = {
      id: `custom-${Date.now()}`,
      name: 'Custom MCP Server',
      command: 'npx',
      args: ['-y', 'your-mcp-server'],
      env: {},
      enabled: false,
    };
    setSettings({
      ...settings,
      mcpServers: [...settings.mcpServers, newServer],
    });
    setExpandedMcp(newServer.id);
  };

  const removeMcpServer = (id: string) => {
    setSettings({
      ...settings,
      mcpServers: settings.mcpServers.filter(s => s.id !== id),
    });
  };

  const currentModels = settings.aiProvider === 'ollama' && ollamaModels.length > 0
    ? ollamaModels
    : DEFAULT_MODELS[settings.aiProvider] || [];

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'general' ? styles.active : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'ai' ? styles.active : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI Provider
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'mcp' ? styles.active : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP Servers
          </button>
        </div>

        <div className={styles.content}>
          {activeTab === 'general' && (
            <>
              <section className={styles.section}>
                <h3>Appearance</h3>
                <div className={styles.field}>
                  <label>Theme</label>
                  <div className={styles.themeButtons}>
                    <button
                      className={`${styles.themeBtn} ${settings.theme === 'light' ? styles.active : ''}`}
                      onClick={() => setSettings({ ...settings, theme: 'light' })}
                    >
                      <Sun size={16} />
                      <span>Light</span>
                    </button>
                    <button
                      className={`${styles.themeBtn} ${settings.theme === 'dark' ? styles.active : ''}`}
                      onClick={() => setSettings({ ...settings, theme: 'dark' })}
                    >
                      <Moon size={16} />
                      <span>Dark</span>
                    </button>
                    <button
                      className={`${styles.themeBtn} ${settings.theme === 'system' ? styles.active : ''}`}
                      onClick={() => setSettings({ ...settings, theme: 'system' })}
                    >
                      <Monitor size={16} />
                      <span>System</span>
                    </button>
                  </div>
                </div>

                <div className={styles.field}>
                  <label>Font Size: {settings.fontSize}px</label>
                  <input
                    type="range"
                    min="12"
                    max="20"
                    value={settings.fontSize}
                    onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) })}
                    className={styles.slider}
                  />
                </div>
              </section>
            </>
          )}

          {activeTab === 'ai' && (
            <>
              <section className={styles.section}>
                <h3>AI Provider</h3>
                <div className={styles.field}>
                  <label>Provider</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider;
                      const models = DEFAULT_MODELS[provider];
                      setSettings({
                        ...settings,
                        aiProvider: provider,
                        model: models.length > 0 ? models[0] : '',
                      });
                    }}
                    className={styles.select}
                  >
                    <option value="ollama">Ollama (Local)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="copilot">GitHub Copilot</option>
                    <option value="custom">Custom API</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label>Model</label>
                  <div className={styles.modelRow}>
                    {currentModels.length > 0 ? (
                      <select
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                        className={styles.select}
                        disabled={loadingModels}
                      >
                        {currentModels.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                        placeholder={loadingModels ? "Loading models..." : "Enter model name"}
                        className={styles.input}
                        disabled={loadingModels}
                      />
                    )}
                    {settings.aiProvider === 'ollama' && (
                      <button
                        className={styles.refreshBtn}
                        onClick={() => fetchOllamaModels(settings.ollamaUrl)}
                        disabled={loadingModels}
                        title="Refresh models"
                      >
                        {loadingModels ? <Loader2 size={16} className={styles.spinning} /> : <RefreshCw size={16} />}
                      </button>
                    )}
                  </div>
                  {settings.aiProvider === 'ollama' && ollamaModels.length === 0 && !loadingModels && (
                    <p className={styles.fieldHint}>No models found. Make sure Ollama is running.</p>
                  )}
                </div>
              </section>

              <section className={styles.section}>
                <h3>Provider Settings</h3>
                {settings.aiProvider === 'ollama' && (
                  <div className={styles.field}>
                    <label>Ollama URL</label>
                    <input
                      type="text"
                      value={settings.ollamaUrl}
                      onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                      placeholder="http://localhost:11434"
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'openai' && (
                  <div className={styles.field}>
                    <label>OpenAI API Key</label>
                    <input
                      type="password"
                      value={settings.openaiKey}
                      onChange={(e) => setSettings({ ...settings, openaiKey: e.target.value })}
                      placeholder="sk-..."
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'anthropic' && (
                  <div className={styles.field}>
                    <label>Anthropic API Key</label>
                    <input
                      type="password"
                      value={settings.anthropicKey}
                      onChange={(e) => setSettings({ ...settings, anthropicKey: e.target.value })}
                      placeholder="sk-ant-..."
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'custom' && (
                  <>
                    <div className={styles.field}>
                      <label>Base URL</label>
                      <input
                        type="text"
                        value={settings.customBaseUrl}
                        onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1"
                        className={styles.input}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>API Key</label>
                      <input
                        type="password"
                        value={settings.customApiKey}
                        onChange={(e) => setSettings({ ...settings, customApiKey: e.target.value })}
                        placeholder="Your API key"
                        className={styles.input}
                      />
                    </div>
                  </>
                )}
              </section>

              <section className={styles.section}>
                <h3>Advanced</h3>
                <div className={styles.field}>
                  <label>Temperature: {settings.temperature.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.temperature}
                    onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                    className={styles.slider}
                  />
                  <span className={styles.sliderLabels}>
                    <span>Precise</span>
                    <span>Creative</span>
                  </span>
                </div>

                <div className={styles.field}>
                  <label>Max Tokens: {settings.maxTokens}</label>
                  <input
                    type="range"
                    min="1024"
                    max="32768"
                    step="1024"
                    value={settings.maxTokens}
                    onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) })}
                    className={styles.slider}
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.toggleRow}>
                    <div>
                      <label>Think Aloud</label>
                      <p className={styles.fieldDesc}>Show AI reasoning process</p>
                    </div>
                    <button
                      className={`${styles.toggle} ${settings.thinkAloud ? styles.on : ''}`}
                      onClick={() => setSettings({ ...settings, thinkAloud: !settings.thinkAloud })}
                    >
                      <span className={styles.toggleThumb} />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'mcp' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>MCP Servers</h3>
                <button className={styles.addBtn} onClick={addCustomMcpServer}>
                  <Plus size={16} />
                  <span>Add Server</span>
                </button>
              </div>
              <p className={styles.sectionDesc}>
                Model Context Protocol (MCP) servers extend AI capabilities with tools like web search, file access, and APIs.
              </p>

              <div className={styles.mcpList}>
                {settings.mcpServers.map((server) => (
                  <div key={server.id} className={styles.mcpItem}>
                    <div 
                      className={styles.mcpHeader}
                      onClick={() => setExpandedMcp(expandedMcp === server.id ? null : server.id)}
                    >
                      <div className={styles.mcpHeaderLeft}>
                        {expandedMcp === server.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className={styles.mcpName}>{server.name}</span>
                      </div>
                      <div className={styles.mcpHeaderRight}>
                        <button
                          className={`${styles.toggle} ${styles.small} ${server.enabled ? styles.on : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateMcpServer(server.id, { enabled: !server.enabled });
                          }}
                        >
                          <span className={styles.toggleThumb} />
                        </button>
                      </div>
                    </div>

                    {expandedMcp === server.id && (
                      <div className={styles.mcpDetails}>
                        <div className={styles.field}>
                          <label>Name</label>
                          <input
                            type="text"
                            value={server.name}
                            onChange={(e) => updateMcpServer(server.id, { name: e.target.value })}
                            className={styles.input}
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Command</label>
                          <input
                            type="text"
                            value={server.command}
                            onChange={(e) => updateMcpServer(server.id, { command: e.target.value })}
                            placeholder="npx"
                            className={styles.input}
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Arguments</label>
                          <input
                            type="text"
                            value={server.args.join(' ')}
                            onChange={(e) => updateMcpServer(server.id, { args: e.target.value.split(' ').filter(Boolean) })}
                            placeholder="-y your-mcp-package"
                            className={styles.input}
                          />
                        </div>
                        {Object.keys(server.env).length > 0 && (
                          <div className={styles.field}>
                            <label>Environment Variables</label>
                            {Object.entries(server.env).map(([key, value]) => (
                              <div key={key} className={styles.envRow}>
                                <span className={styles.envKey}>{key}</span>
                                <input
                                  type="password"
                                  value={value}
                                  onChange={(e) => updateMcpServer(server.id, { 
                                    env: { ...server.env, [key]: e.target.value }
                                  })}
                                  placeholder="Enter value..."
                                  className={styles.input}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {!BUILT_IN_MCP_SERVERS.find(s => s.id === server.id) && (
                          <button 
                            className={styles.removeBtn}
                            onClick={() => removeMcpServer(server.id)}
                          >
                            <Trash2 size={14} />
                            <span>Remove Server</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className={styles.footer}>
          {saved && <span className={styles.savedMsg}>Settings saved!</span>}
          <button onClick={handleSave} className={styles.saveBtn}>
            <Save size={16} />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
