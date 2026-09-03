import { useState, useEffect, useCallback } from 'react';
import { Settings, Palette, Keyboard, Code, Bot, GitBranch, Puzzle, BarChart3, Trash2, Loader2, ShieldCheck, HelpCircle, Terminal, Save, Plus } from 'lucide-react';
import { useSettingsStore, Settings as SettingsType, TERMINAL_THEME_PRESETS } from '../../store/settingsStore';
import { shell } from '../../services/tauri';
import styles from './SettingsPanel.module.css';

type SettingsCategory = 'general' | 'appearance' | 'editor' | 'keybindings' | 'ai' | 'git' | 'security' | 'plugins' | 'terminal' | 'usage';

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
  type: 'toggle' | 'select' | 'input' | 'number' | 'password' | 'color';
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
  { id: 'terminal', label: 'Terminal', icon: Terminal },
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
    { id: 'aiPanelMaxPercent', label: 'AI Panel Max %', description: 'Max AI panel width when editor is visible', type: 'number' },
    { id: 'aiPanelMaxPercentSolo', label: 'AI Panel Max % (Solo)', description: 'Max AI panel width when editor is hidden', type: 'number' },
    { id: 'editorPanelMinPercent', label: 'Editor Min %', description: 'Minimum editor width when AI panel is visible', type: 'number' },
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
    { id: 'aiAutoApplyFileOps', label: 'Auto-apply AI File Ops', description: 'Apply AI file edits automatically (no review)', type: 'toggle' },
  ],
  git: [
    { id: 'autoFetch', label: 'Auto Fetch', description: 'Automatically fetch changes', type: 'toggle' },
    { id: 'confirmSync', label: 'Confirm Sync', description: 'Confirm before sync', type: 'toggle' },
    {
      id: 'githubToken',
      label: 'GitHub Token',
      description: 'Personal access token for PR review',
      type: 'password',
    },
    {
      id: 'githubApiBase',
      label: 'GitHub API Base',
      description: 'Optional override for GitHub Enterprise (e.g. https://scm.example.com/api/v3)',
      type: 'input',
    },
  ],
  security: [
    { id: 'snykEnabled', label: 'Enable Snyk', description: 'Enable Snyk security scanning in Test panel', type: 'toggle' },
    { id: 'snykCliPath', label: 'Snyk CLI Path', description: 'Path to Snyk CLI (default: snyk)', type: 'input' },
    { id: 'snykAuthToken', label: 'Snyk Auth Token', description: 'Optional API token for authentication', type: 'password' },
  ],
  plugins: [
    { id: 'autoUpdatePlugins', label: 'Auto Update', description: 'Automatically update plugins', type: 'toggle' },
  ],
  terminal: [], // Terminal has custom UI below
  usage: [],
};

const GITHUB_TOKEN_URL = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token';
const GITLAB_TOKEN_URL = 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html';
const GITHUB_TOKEN_TIP = 'GitHub: Settings → Developer settings → Personal access tokens → Generate new token (classic) with repo scope.';
const GITLAB_TOKEN_TIP = 'GitLab: User Settings → Access Tokens → create token with read_api and read_repository.';

export function SettingsPanel() {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const settings = useSettingsStore();
  const { updateSetting } = settings;
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
        ) : activeCategory === 'terminal' ? (
          <TerminalSettings />
        ) : (
          <div className={styles.settingsList}>
            {settingsConfig[activeCategory].map((setting) => {
              const value = settings[setting.id];
              const isGithubToken = setting.id === 'githubToken';
              return (
                <div key={setting.id} className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <div className={styles.settingLabelRow}>
                      <span className={styles.settingLabel}>{setting.label}</span>
                      {isGithubToken && (
                        <div className={styles.tokenHelp}>
                          <button
                            type="button"
                            className={styles.helpButton}
                            title={GITHUB_TOKEN_TIP}
                            onClick={() => shell.openExternal(GITHUB_TOKEN_URL)}
                          >
                            <HelpCircle size={12} />
                            <span>GitHub</span>
                          </button>
                          <button
                            type="button"
                            className={styles.helpButton}
                            title={GITLAB_TOKEN_TIP}
                            onClick={() => shell.openExternal(GITLAB_TOKEN_URL)}
                          >
                            <HelpCircle size={12} />
                            <span>GitLab</span>
                          </button>
                        </div>
                      )}
                    </div>
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
                    {setting.type === 'color' && (
                      <div className={styles.colorInput}>
                        <input
                          type="color"
                          value={value as string}
                          onChange={(e) => updateSetting(setting.id, e.target.value as any)}
                        />
                        <input
                          type="text"
                          value={value as string}
                          onChange={(e) => updateSetting(setting.id, e.target.value as any)}
                          placeholder="#000000"
                          className={styles.colorText}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Terminal Settings Component
function TerminalSettings() {
  const settings = useSettingsStore();
  const { 
    updateSetting, 
    applyTerminalPreset, 
    saveCustomTerminalTheme, 
    deleteCustomTerminalTheme,
    customTerminalThemes 
  } = settings;
  const [newThemeName, setNewThemeName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const allThemes = [
    ...Object.entries(TERMINAL_THEME_PRESETS).map(([id, preset]) => ({ id, name: preset.name, isCustom: false })),
    ...customTerminalThemes.map(t => ({ id: t.id, name: t.name, isCustom: true })),
  ];

  const handleSaveTheme = () => {
    if (newThemeName.trim()) {
      saveCustomTerminalTheme(newThemeName.trim());
      setNewThemeName('');
      setShowSaveDialog(false);
    }
  };

  return (
    <div className={styles.terminalSettings}>
      <p className={styles.terminalDesc}>
        Configure terminal appearance for Terminal, CLI, and Output panels.
      </p>

      {/* Theme Preset Selector */}
      <div className={styles.terminalSection}>
        <h3>Theme Preset</h3>
        <div className={styles.themeSelector}>
          <select
            value={settings.terminalThemePreset}
            onChange={(e) => applyTerminalPreset(e.target.value)}
          >
            <optgroup label="Built-in Themes">
              {Object.entries(TERMINAL_THEME_PRESETS).map(([id, preset]) => (
                <option key={id} value={id}>{preset.name}</option>
              ))}
            </optgroup>
            {customTerminalThemes.length > 0 && (
              <optgroup label="Custom Themes">
                {customTerminalThemes.map(theme => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          
          {/* Save as custom theme */}
          {!showSaveDialog ? (
            <button 
              className={styles.saveThemeBtn}
              onClick={() => setShowSaveDialog(true)}
              title="Save current colors as custom theme"
            >
              <Plus size={14} />
              Save Theme
            </button>
          ) : (
            <div className={styles.saveThemeDialog}>
              <input
                type="text"
                placeholder="Theme name..."
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTheme()}
              />
              <button onClick={handleSaveTheme} disabled={!newThemeName.trim()}>
                <Save size={14} />
              </button>
              <button onClick={() => { setShowSaveDialog(false); setNewThemeName(''); }}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Delete custom theme button */}
        {settings.terminalThemePreset.startsWith('custom-') && (
          <button
            className={styles.deleteThemeBtn}
            onClick={() => deleteCustomTerminalTheme(settings.terminalThemePreset)}
          >
            <Trash2 size={14} />
            Delete "{customTerminalThemes.find(t => t.id === settings.terminalThemePreset)?.name}"
          </button>
        )}
      </div>

      {/* Font Settings */}
      <div className={styles.terminalSection}>
        <h3>Font</h3>
        <div className={styles.terminalGrid}>
          <div className={styles.terminalField}>
            <label>Size</label>
            <input
              type="number"
              value={settings.terminalFontSize}
              onChange={(e) => updateSetting('terminalFontSize', parseInt(e.target.value) || 13)}
              min={8}
              max={32}
            />
          </div>
          <div className={styles.terminalField}>
            <label>Line Height</label>
            <input
              type="number"
              value={settings.terminalLineHeight}
              onChange={(e) => updateSetting('terminalLineHeight', parseFloat(e.target.value) || 1.2)}
              min={1}
              max={2}
              step={0.1}
            />
          </div>
          <div className={styles.terminalField}>
            <label>Scrollback</label>
            <input
              type="number"
              value={settings.terminalScrollback}
              onChange={(e) => updateSetting('terminalScrollback', parseInt(e.target.value) || 1000)}
              min={100}
              max={100000}
              step={1000}
            />
          </div>
        </div>
        <div className={styles.terminalField} style={{ marginTop: 12 }}>
          <label>Font Family</label>
          <input
            type="text"
            value={settings.terminalFontFamily}
            onChange={(e) => updateSetting('terminalFontFamily', e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Cursor Settings */}
      <div className={styles.terminalSection}>
        <h3>Cursor</h3>
        <div className={styles.terminalGrid}>
          <div className={styles.terminalField}>
            <label>Style</label>
            <select
              value={settings.terminalCursorStyle}
              onChange={(e) => updateSetting('terminalCursorStyle', e.target.value as any)}
            >
              <option value="block">Block</option>
              <option value="bar">Bar</option>
              <option value="underline">Underline</option>
            </select>
          </div>
          <div className={styles.terminalField}>
            <label>Blink</label>
            <button
              className={`${styles.toggle} ${settings.terminalCursorBlink ? styles.on : ''}`}
              onClick={() => updateSetting('terminalCursorBlink', !settings.terminalCursorBlink)}
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>
        </div>
      </div>

      {/* Color Settings */}
      <div className={styles.terminalSection}>
        <h3>Colors</h3>
        <div className={styles.terminalColorGrid}>
          <div className={styles.terminalColorField}>
            <label>Background</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalBackground} onChange={(e) => updateSetting('terminalBackground', e.target.value)} />
              <input type="text" value={settings.terminalBackground} onChange={(e) => updateSetting('terminalBackground', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Foreground</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalForeground} onChange={(e) => updateSetting('terminalForeground', e.target.value)} />
              <input type="text" value={settings.terminalForeground} onChange={(e) => updateSetting('terminalForeground', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Cursor</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalCursor} onChange={(e) => updateSetting('terminalCursor', e.target.value)} />
              <input type="text" value={settings.terminalCursor} onChange={(e) => updateSetting('terminalCursor', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Selection</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalSelectionBackground} onChange={(e) => updateSetting('terminalSelectionBackground', e.target.value)} />
              <input type="text" value={settings.terminalSelectionBackground} onChange={(e) => updateSetting('terminalSelectionBackground', e.target.value)} className={styles.colorText} />
            </div>
          </div>
        </div>

        <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>ANSI Colors</h4>
        <div className={styles.terminalColorGrid}>
          <div className={styles.terminalColorField}>
            <label>Black</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalBlack} onChange={(e) => updateSetting('terminalBlack', e.target.value)} />
              <input type="text" value={settings.terminalBlack} onChange={(e) => updateSetting('terminalBlack', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Red</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalRed} onChange={(e) => updateSetting('terminalRed', e.target.value)} />
              <input type="text" value={settings.terminalRed} onChange={(e) => updateSetting('terminalRed', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Green</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalGreen} onChange={(e) => updateSetting('terminalGreen', e.target.value)} />
              <input type="text" value={settings.terminalGreen} onChange={(e) => updateSetting('terminalGreen', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Yellow</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalYellow} onChange={(e) => updateSetting('terminalYellow', e.target.value)} />
              <input type="text" value={settings.terminalYellow} onChange={(e) => updateSetting('terminalYellow', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Blue</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalBlue} onChange={(e) => updateSetting('terminalBlue', e.target.value)} />
              <input type="text" value={settings.terminalBlue} onChange={(e) => updateSetting('terminalBlue', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Magenta</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalMagenta} onChange={(e) => updateSetting('terminalMagenta', e.target.value)} />
              <input type="text" value={settings.terminalMagenta} onChange={(e) => updateSetting('terminalMagenta', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>Cyan</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalCyan} onChange={(e) => updateSetting('terminalCyan', e.target.value)} />
              <input type="text" value={settings.terminalCyan} onChange={(e) => updateSetting('terminalCyan', e.target.value)} className={styles.colorText} />
            </div>
          </div>
          <div className={styles.terminalColorField}>
            <label>White</label>
            <div className={styles.colorInput}>
              <input type="color" value={settings.terminalWhite} onChange={(e) => updateSetting('terminalWhite', e.target.value)} />
              <input type="text" value={settings.terminalWhite} onChange={(e) => updateSetting('terminalWhite', e.target.value)} className={styles.colorText} />
            </div>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className={styles.terminalSection}>
        <h3>Preview</h3>
        <div 
          className={styles.terminalPreview}
          style={{ 
            backgroundColor: settings.terminalBackground,
            color: settings.terminalForeground,
            fontFamily: settings.terminalFontFamily,
            fontSize: settings.terminalFontSize,
            lineHeight: settings.terminalLineHeight,
          }}
        >
          <div><span style={{ color: settings.terminalGreen }}>user@host</span>:<span style={{ color: settings.terminalBlue }}>~</span>$ ls -la</div>
          <div>drwxr-xr-x  5 user staff  160 Sep  3 09:00 <span style={{ color: settings.terminalBlue }}>src</span></div>
          <div>-rw-r--r--  1 user staff 1024 Sep  3 09:00 package.json</div>
          <div><span style={{ color: settings.terminalRed }}>error:</span> <span style={{ color: settings.terminalYellow }}>warning:</span> <span style={{ color: settings.terminalMagenta }}>info</span></div>
          <div><span style={{ color: settings.terminalGreen }}>user@host</span>:<span style={{ color: settings.terminalBlue }}>~</span>$ <span style={{ backgroundColor: settings.terminalCursor, color: settings.terminalBackground }}>_</span></div>
        </div>
      </div>
    </div>
  );
}
