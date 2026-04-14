import { useState } from 'react';
import { Settings, Palette, Keyboard, Code, Bot, GitBranch, Puzzle } from 'lucide-react';
import { useSettingsStore, Settings as SettingsType } from '../../store/settingsStore';
import styles from './SettingsPanel.module.css';

type SettingsCategory = 'general' | 'appearance' | 'editor' | 'keybindings' | 'ai' | 'git' | 'plugins';

interface SettingItem {
  id: keyof SettingsType;
  label: string;
  description: string;
  type: 'toggle' | 'select' | 'input' | 'number';
  options?: { value: string; label: string }[];
}

const categories = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'ai', label: 'AI Assistant', icon: Bot },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
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
  plugins: [
    { id: 'autoUpdatePlugins', label: 'Auto Update', description: 'Automatically update plugins', type: 'toggle' },
  ],
};

export function SettingsPanel() {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const settings = useSettingsStore();
  const { updateSetting } = settings;

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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
