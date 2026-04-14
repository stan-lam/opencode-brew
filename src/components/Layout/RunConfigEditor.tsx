import { useState } from 'react';
import { X, Plus, Trash2, Play, Save } from 'lucide-react';
import { useProjectStore, RunConfiguration } from '../../store/projectStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import styles from './RunConfigEditor.module.css';

interface RunConfigEditorProps {
  onClose: () => void;
}

export function RunConfigEditor({ onClose }: RunConfigEditorProps) {
  const { 
    runConfigurations, 
    activeConfiguration,
    addRunConfiguration, 
    removeRunConfiguration,
    setActiveConfiguration,
    setRunConfigurations,
  } = useProjectStore();
  const { currentWorkspace } = useWorkspaceStore();
  
  const [selectedConfig, setSelectedConfig] = useState<RunConfiguration | null>(
    activeConfiguration || runConfigurations[0] || null
  );
  const [editedConfig, setEditedConfig] = useState<RunConfiguration | null>(selectedConfig);

  const handleSelectConfig = (config: RunConfiguration) => {
    setSelectedConfig(config);
    setEditedConfig({ ...config });
  };

  const handleAddConfig = () => {
    const newConfig: RunConfiguration = {
      id: `custom-${Date.now()}`,
      name: 'New Configuration',
      type: 'custom',
      command: '',
      args: [],
      env: {},
      workingDirectory: currentWorkspace?.rootPath || '',
      isDefault: false,
    };
    addRunConfiguration(newConfig);
    setSelectedConfig(newConfig);
    setEditedConfig(newConfig);
  };

  const handleDeleteConfig = (id: string) => {
    removeRunConfiguration(id);
    if (selectedConfig?.id === id) {
      const remaining = runConfigurations.filter(c => c.id !== id);
      setSelectedConfig(remaining[0] || null);
      setEditedConfig(remaining[0] || null);
    }
  };

  const handleSaveConfig = () => {
    if (!editedConfig) return;
    
    const updatedConfigs = runConfigurations.map(c => 
      c.id === editedConfig.id ? editedConfig : c
    );
    setRunConfigurations(updatedConfigs);
    setSelectedConfig(editedConfig);
  };

  const handleSetDefault = () => {
    if (!editedConfig) return;
    
    const updatedConfigs = runConfigurations.map(c => ({
      ...c,
      isDefault: c.id === editedConfig.id,
    }));
    setRunConfigurations(updatedConfigs);
    setActiveConfiguration(editedConfig);
  };

  const updateField = (field: keyof RunConfiguration, value: any) => {
    if (!editedConfig) return;
    setEditedConfig({ ...editedConfig, [field]: value });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Run/Debug Configurations</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <div className={styles.content}>
          <div className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span>Configurations</span>
              <button className={styles.addBtn} onClick={handleAddConfig} title="Add Configuration">
                <Plus size={14} />
              </button>
            </div>
            <div className={styles.configList}>
              {runConfigurations.map(config => (
                <div
                  key={config.id}
                  className={`${styles.configItem} ${selectedConfig?.id === config.id ? styles.selected : ''}`}
                  onClick={() => handleSelectConfig(config)}
                >
                  <span className={styles.configName}>
                    {config.isDefault && <span className={styles.defaultBadge}>★</span>}
                    {config.name}
                  </span>
                  <button
                    className={styles.deleteBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConfig(config.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {runConfigurations.length === 0 && (
                <div className={styles.emptyList}>
                  No configurations. Click + to add one.
                </div>
              )}
            </div>
          </div>
          
          <div className={styles.editor}>
            {editedConfig ? (
              <>
                <div className={styles.formGroup}>
                  <label>Name</label>
                  <input
                    type="text"
                    value={editedConfig.name}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label>Command</label>
                  <input
                    type="text"
                    value={editedConfig.command}
                    onChange={(e) => updateField('command', e.target.value)}
                    placeholder="e.g., npm, python, cargo"
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label>Arguments</label>
                  <input
                    type="text"
                    value={editedConfig.args.join(' ')}
                    onChange={(e) => updateField('args', e.target.value.split(' ').filter(Boolean))}
                    placeholder="e.g., run dev, main.py"
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label>Working Directory</label>
                  <input
                    type="text"
                    value={editedConfig.workingDirectory}
                    onChange={(e) => updateField('workingDirectory', e.target.value)}
                    placeholder="Leave empty for project root"
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label>Environment Variables (KEY=VALUE, one per line)</label>
                  <textarea
                    value={Object.entries(editedConfig.env).map(([k, v]) => `${k}=${v}`).join('\n')}
                    onChange={(e) => {
                      const env: Record<string, string> = {};
                      e.target.value.split('\n').forEach(line => {
                        const [key, ...rest] = line.split('=');
                        if (key && rest.length > 0) {
                          env[key.trim()] = rest.join('=').trim();
                        }
                      });
                      updateField('env', env);
                    }}
                    placeholder="NODE_ENV=development"
                    rows={3}
                  />
                </div>
                
                <div className={styles.actions}>
                  <button className={styles.saveBtn} onClick={handleSaveConfig}>
                    <Save size={14} />
                    Save
                  </button>
                  <button 
                    className={styles.defaultBtn} 
                    onClick={handleSetDefault}
                    disabled={editedConfig.isDefault}
                  >
                    <Play size={14} />
                    Set as Default
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.noSelection}>
                Select a configuration to edit, or click + to create one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
