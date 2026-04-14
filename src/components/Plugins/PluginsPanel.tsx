import { useState, useEffect } from 'react';
import { Puzzle, Search, Download, Trash2, Power, PowerOff, RefreshCw } from 'lucide-react';
import { PluginManager, BUILT_IN_PLUGINS } from '../../plugins/PluginManager';
import styles from './PluginsPanel.module.css';

interface PluginDisplay {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  installed: boolean;
  enabled: boolean;
  isBuiltIn: boolean;
}

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginDisplay[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [loading, setLoading] = useState(false);

  const loadPlugins = () => {
    const loadedPlugins = PluginManager.getLoadedPlugins();
    const displayPlugins: PluginDisplay[] = loadedPlugins.map((p) => ({
      id: p.id,
      name: p.manifest.name,
      description: p.manifest.description || '',
      version: p.manifest.version,
      author: p.manifest.author || 'Unknown',
      installed: true,
      enabled: p.isActive,
      isBuiltIn: BUILT_IN_PLUGINS.some((bp) => bp.manifest.id === p.id),
    }));

    // Add available built-in plugins that aren't loaded
    BUILT_IN_PLUGINS.forEach((bp) => {
      if (!displayPlugins.some((p) => p.id === bp.manifest.id)) {
        displayPlugins.push({
          id: bp.manifest.id,
          name: bp.manifest.name,
          description: bp.manifest.description || '',
          version: bp.manifest.version,
          author: bp.manifest.author || 'OpenCodeBrew',
          installed: false,
          enabled: false,
          isBuiltIn: true,
        });
      }
    });

    setPlugins(displayPlugins);
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const filteredPlugins = plugins.filter((plugin) => {
    if (activeTab === 'installed' && !plugin.installed) return false;
    if (searchQuery) {
      return (
        plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return true;
  });

  const togglePlugin = async (id: string) => {
    setLoading(true);
    try {
      const plugin = plugins.find((p) => p.id === id);
      if (!plugin) return;

      if (plugin.enabled) {
        await PluginManager.deactivatePlugin(id);
      } else {
        await PluginManager.activatePlugin(id);
      }
      loadPlugins();
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
    }
    setLoading(false);
  };

  const installPlugin = async (id: string) => {
    setLoading(true);
    try {
      const builtIn = BUILT_IN_PLUGINS.find((bp) => bp.manifest.id === id);
      if (builtIn) {
        await PluginManager.loadPlugin(builtIn.manifest, builtIn.code);
        await PluginManager.activatePlugin(id);
        loadPlugins();
      }
    } catch (error) {
      console.error('Failed to install plugin:', error);
    }
    setLoading(false);
  };

  const uninstallPlugin = async (id: string) => {
    setLoading(true);
    try {
      await PluginManager.unloadPlugin(id);
      loadPlugins();
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
    }
    setLoading(false);
  };

  return (
    <div className={styles.pluginsPanel}>
      <div className={styles.searchBox}>
        <Search size={14} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search plugins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
        <button className={styles.refreshBtn} onClick={loadPlugins} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'installed' ? styles.active : ''}`}
          onClick={() => setActiveTab('installed')}
        >
          Installed ({plugins.filter((p) => p.installed).length})
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'browse' ? styles.active : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Available
        </button>
      </div>

      <div className={styles.pluginList}>
        {filteredPlugins.length === 0 ? (
          <div className={styles.empty}>
            <Puzzle size={24} />
            <p>{activeTab === 'installed' ? 'No plugins installed' : 'No plugins available'}</p>
            {activeTab === 'installed' && (
              <p className={styles.hint}>Browse available plugins to get started</p>
            )}
          </div>
        ) : (
          filteredPlugins.map((plugin) => (
            <div key={plugin.id} className={styles.pluginItem}>
              <div className={`${styles.pluginIcon} ${plugin.enabled ? styles.active : ''}`}>
                <Puzzle size={20} />
              </div>
              <div className={styles.pluginInfo}>
                <div className={styles.pluginHeader}>
                  <span className={styles.pluginName}>{plugin.name}</span>
                  <span className={styles.pluginVersion}>v{plugin.version}</span>
                  {plugin.isBuiltIn && (
                    <span className={styles.builtInBadge}>Built-in</span>
                  )}
                </div>
                <p className={styles.pluginDescription}>{plugin.description}</p>
                <span className={styles.pluginAuthor}>by {plugin.author}</span>
              </div>
              <div className={styles.pluginActions}>
                {plugin.installed ? (
                  <>
                    <button
                      className={`${styles.actionBtn} ${plugin.enabled ? styles.enabled : styles.disabled}`}
                      onClick={() => togglePlugin(plugin.id)}
                      disabled={loading}
                      title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                    >
                      {plugin.enabled ? <Power size={14} /> : <PowerOff size={14} />}
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={() => uninstallPlugin(plugin.id)}
                      disabled={loading}
                      title="Uninstall plugin"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.installBtn}
                    onClick={() => installPlugin(plugin.id)}
                    disabled={loading}
                  >
                    <Download size={14} />
                    Install
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <p className={styles.footerText}>
          Plugins extend OpenCodeBrew functionality with custom features.
        </p>
      </div>
    </div>
  );
}
