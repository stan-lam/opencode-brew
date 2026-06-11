import { useState, useEffect, useCallback } from 'react';
import { Settings, Palette, Keyboard, Code, Bot, GitBranch, Puzzle, BarChart3, Trash2, Loader2, ShieldCheck } from 'lucide-react';
import { useSettingsStore, Settings as SettingsType } from '../../store/settingsStore';
import { useLayoutStore } from '../../store/layoutStore';
import styles from './SettingsPanel.module.css';

type SettingsCategory = 'general' | 'appearance' | 'editor' | 'keybindings' | 'ai' | 'git' | 'security' | 'plugins' | 'usage';

interface UsageStats {
  model: string;
  provider: string;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  request_count: number;
}

interface OverallStats {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  total_requests: number;
  by_model: UsageStats[];
}

interface SettingItem {
  id: keyof SettingsType;
  label: string;
  description: string;
  type: 'toggle' | 'select' | 'input' | 'number' | 'password';
  options?: { value: string; label: string }[];
}

const categories = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'ai', label: 'AI Assistant', icon: Bot },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
] as const;

const settingsConfig: Record<SettingsCategory, SettingItem[]> = {
  general: [
    { id: 'autoSave', label: 'Auto Save', description: 'Automatically save files', type: 'toggle' },
    { id: 'autoSaveDelay', label: 'Auto Save Delay', description: 'Delay in milliseconds', type: 'number' },
  ],
  appearance: [
    { id: 'theme', label: 'Theme', description: 'Color theme', type: 'select', options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'system', label: 'System' },
    ]},
    { id: 'fontSize', label: 'Font Size', description: 'UI font size', type: 'number' },
  ],
  editor: [
    { id: 'tabSize', label: 'Tab Size', description: 'Number of spaces per tab', type: 'number' },
    { id: 'wordWrap', label: 'Word Wrap', description: 'Wrap long lines', type: 'toggle' },
    { id: 'minimap', label: 'Minimap', description: 'Show minimap', type: 'toggle' },
    { id: 'lineNumbers', label: 'Line Numbers', description: 'Show line numbers', type: 'toggle' },
  ],
  keybindings: [
    { id: 'keymap', label: 'Keymap', description: 'Keyboard shortcut preset', type: 'select', options: [
      { value: 'default', label: 'Default' },
      { value: 'vim', label: 'Vim' },
      { value: 'intellij', label: 'IntelliJ' },
      { value: 'vscode', label: 'VS Code' },
    ]},
  ],
  ai: [
    { id: 'aiEnabled', label: 'Enable AI', description: 'Enable AI features', type: 'toggle' },
    { id: 'inlineCompletions', label: 'Inline Completions', description: 'Show AI code completions', type: 'toggle' },
  ],
  git: [
    { id: 'autoFetch', label: 'Auto Fetch', description: 'Automatically fetch changes', type: 'toggle' },
    { id: 'confirmSync', label: 'Confirm Sync', description: 'Confirm before sync', type: 'toggle' },
  ],
  security: [
    { id: 'snykEnabled', label: 'Enable Snyk', description: 'Enable Snyk security scanning in Test panel', type: 'toggle' },
    { id: 'snykCliPath', label: 'Snyk CLI Path', description: 'Path to Snyk CLI (default: snyk)', type: 'input' },
    { id: 'snykAuthToken', label: 'Snyk Auth Token', description: 'Optional API token for authentication', type: 'password' },
  ],
  plugins: [
    { id: 'autoUpdatePlugins', label: 'Auto Update', description: 'Automatically update plugins', type: 'toggle' },
  ],
  usage: [],
};

export function SettingsPanel() {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const settings = useSettingsStore();
  const { updateSetting } = settings;
  const { sidePanelPosition, setSidePanelPosition } = useLayoutStore();
  const [usageStats, setUsageStats] = useState<OverallStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const fetchUsageStats = useCallback(async () => {
    setLoadingUsage(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('init_usage_db');
      const stats = await invoke<OverallStats>('get_usage_stats');
      setUsageStats(stats);
    } catch (error) {
      console.error('Failed to fetch usage stats:', error);
      setUsageStats(null);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  const clearUsageHistory = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_usage_history');
      setUsageStats({
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cache_creation_tokens: 0,
        total_cache_read_tokens: 0,
        total_cost_usd: 0,
        total_requests: 0,
        by_model: [],
      });
    } catch (error) {
      console.error('Failed to clear usage history:', error);
    }
  }, []);

  useEffect(() => {
    if (activeCategory === 'usage') {
      fetchUsageStats();
    }
  }, [activeCategory, fetchUsageStats]);

  return (
    <div className={styles.settingsPanel}>
      <div className={styles.categories}>
        {categories.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.category} ${activeCategory === id ? styles.active : ''}`}
            onClick={() => setActiveCategory(id as SettingsCategory)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className={styles.content}>
        <h2 className={styles.title}>
          {categories.find((c) => c.id === activeCategory)?.label}
        </h2>
        
        {activeCategory === 'usage' ? (
          <div className={styles.usageContent}>
            <div className={styles.usageHeader}>
              <p className={styles.usageDesc}>Track your AI token usage across all conversations and models.</p>
              <button 
                className={styles.clearBtn}
                onClick={clearUsageHistory}
                disabled={loadingUsage || !usageStats?.total_requests}
              >
                <Trash2 size={14} />
                <span>Clear History</span>
              </button>
            </div>

            {loadingUsage ? (
              <div className={styles.loadingState}>
                <Loader2 size={24} className={styles.spinning} />
                <span>Loading usage data...</span>
              </div>
            ) : usageStats ? (
              <>
                <div className={styles.usageSummary}>
                  <div className={styles.usageCard}>
                    <div className={styles.usageValue}>{usageStats.total_requests.toLocaleString()}</div>
                    <div className={styles.usageLabel}>Total Requests</div>
                  </div>
                  <div className={styles.usageCard}>
                    <div className={styles.usageValue}>{usageStats.total_tokens.toLocaleString()}</div>
                    <div className={styles.usageLabel}>Total Tokens</div>
                  </div>
                  <div className={`${styles.usageCard} ${styles.costCard}`}>
                    <div className={styles.usageValue}>
                      ${usageStats.total_cost_usd.toFixed(4)}
                    </div>
                    <div className={styles.usageLabel}>Estimated Cost</div>
                  </div>
                  <div className={styles.usageCard}>
                    <div className={styles.usageValue}>
                      {usageStats.total_cache_read_tokens > 0 
                        ? `${Math.round((usageStats.total_cache_read_tokens / (usageStats.total_prompt_tokens + usageStats.total_cache_read_tokens)) * 100)}%`
                        : '0%'}
                    </div>
                    <div className={styles.usageLabel}>Cache Hit Rate</div>
                  </div>
                </div>
                
                <div className={styles.usageBreakdown}>
                  <div className={styles.usageBreakdownItem}>
                    <span>Prompt Tokens</span>
                    <span>{usageStats.total_prompt_tokens.toLocaleString()}</span>
                  </div>
                  <div className={styles.usageBreakdownItem}>
                    <span>Completion Tokens</span>
                    <span>{usageStats.total_completion_tokens.toLocaleString()}</span>
                  </div>
                  {usageStats.total_cache_creation_tokens > 0 && (
                    <div className={styles.usageBreakdownItem}>
                      <span>Cache Created</span>
                      <span>{usageStats.total_cache_creation_tokens.toLocaleString()}</span>
                    </div>
                  )}
                  {usageStats.total_cache_read_tokens > 0 && (
                    <div className={styles.usageBreakdownItem}>
                      <span>Cache Read</span>
                      <span>{usageStats.total_cache_read_tokens.toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {usageStats.by_model.length > 0 && (
                  <div className={styles.usageTable}>
                    <h4>Usage by Model</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Provider</th>
                          <th>Requests</th>
                          <th>Total Tokens</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageStats.by_model.map((stat, idx) => (
                          <tr key={idx}>
                            <td>{stat.model}</td>
                            <td className={styles.providerCell}>{stat.provider}</td>
                            <td>{stat.request_count.toLocaleString()}</td>
                            <td>{stat.total_tokens.toLocaleString()}</td>
                            <td className={styles.costCell}>
                              {stat.total_cost_usd > 0 
                                ? `$${stat.total_cost_usd.toFixed(4)}`
                                : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {usageStats.by_model.length === 0 && (
                  <div className={styles.emptyState}>
                    <BarChart3 size={48} />
                    <p>No usage data yet</p>
                    <span>Token usage will appear here as you use the AI assistant.</span>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.emptyState}>
                <BarChart3 size={48} />
                <p>Unable to load usage data</p>
                <span>There was an error loading usage statistics.</span>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.settingsList}>
            {settingsConfig[activeCategory].map((setting) => {
              const value = settings[setting.id];
              return (
                <div key={setting.id} className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <label className={styles.settingLabel}>{setting.label}</label>
                    <p className={styles.settingDescription}>{setting.description}</p>
                  </div>
                  <div className={styles.settingControl}>
                    {setting.type === 'toggle' && (
                      <button
                        className={`${styles.toggle} ${value ? styles.on : ''}`}
                        onClick={() => updateSetting(setting.id, !value)}
                      >
                        <span className={styles.toggleThumb} />
                      </button>
                    )}
                    {setting.type === 'select' && (
                      <select
                        value={value as string}
                        onChange={(e) => updateSetting(setting.id, e.target.value as any)}
                      >
                        {setting.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {setting.type === 'number' && (
                      <input
                        type="number"
                        value={value as number}
                        onChange={(e) => updateSetting(setting.id, parseInt(e.target.value) as any)}
                      />
                    )}
                    {setting.type === 'input' && (
                      <input
                        type="text"
                        value={value as string}
                        onChange={(e) => updateSetting(setting.id, e.target.value as any)}
                      />
                    )}
                    {setting.type === 'password' && (
                      <input
                        type="password"
                        value={value as string}
                        onChange={(e) => updateSetting(setting.id, e.target.value as any)}
                        placeholder="••••••••"
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {activeCategory === 'appearance' && (
              <div className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <label className={styles.settingLabel}>Side Panel Position</label>
                  <p className={styles.settingDescription}>Position of the side panel (Explorer, AI, etc.)</p>
                </div>
                <div className={styles.settingControl}>
                  <select
                    value={sidePanelPosition}
                    onChange={(e) => setSidePanelPosition(e.target.value as 'left' | 'right')}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
