import { Plugin, PluginManifest, PluginAPI, PluginContext, QuickPickItem, QuickPickOptions, InputBoxOptions, StatusBarItem } from './types';
import { useEditorStore } from '../store/editorStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { fs } from '../services/tauri';

async function getPluginsDir(workspacePath: string): Promise<string> {
  try {
    const appDataDir = await fs.getAppDataDir();
    const slug = workspacePath.replace(/[\\/: ]+/g, '_').replace(/^_+/, '');
    return `${appDataDir}/workspaces/${slug}/plugins`;
  } catch {
    return `${workspacePath}/.opencodebrew/plugins`;
  }
}

class PluginManagerClass {
  private plugins: Map<string, Plugin> = new Map();
  private commands: Map<string, (...args: any[]) => any> = new Map();
  private eventListeners: Map<string, Set<Function>> = new Map();
  private statusBarItems: StatusBarItem[] = [];
  private keybindings: Map<string, string> = new Map();
  private registeredLanguages: Map<string, string[]> = new Map();

  async loadPlugin(manifest: PluginManifest, code: string): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      console.warn(`Plugin ${manifest.id} is already loaded`);
      return;
    }

    try {
      const api = this.createPluginAPI(manifest.id);
      const context: PluginContext = {
        subscriptions: [],
        workspaceState: new Map(),
        globalState: new Map(),
      };

      // Create a sandboxed function from the plugin code
      const pluginFactory = new Function('api', 'context', `
        ${code}
        if (typeof activate === 'function') {
          return { activate, deactivate: typeof deactivate === 'function' ? deactivate : undefined };
        }
        return {};
      `);

      const pluginExports = pluginFactory(api, context);

      const plugin: Plugin = {
        id: manifest.id,
        manifest,
        isActive: false,
        activate: pluginExports.activate || (() => {}),
        deactivate: pluginExports.deactivate,
      };

      this.plugins.set(manifest.id, plugin);
      console.log(`Plugin ${manifest.id} loaded`);
    } catch (error) {
      console.error(`Failed to load plugin ${manifest.id}:`, error);
      throw error;
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (plugin.isActive) {
      return;
    }

    try {
      const api = this.createPluginAPI(pluginId);
      
      // Process contributions before activating
      this.processContributions(plugin.manifest);
      
      await plugin.activate(api);
      plugin.isActive = true;
      console.log(`Plugin ${pluginId} activated`);
    } catch (error) {
      console.error(`Failed to activate plugin ${pluginId}:`, error);
      throw error;
    }
  }

  // Process plugin contributions (commands, keybindings, languages, etc.)
  private processContributions(manifest: PluginManifest): void {
    const contributions = manifest.contributes;
    if (!contributions) return;

    // Process commands
    if (contributions.commands) {
      contributions.commands.forEach(cmd => {
        const fullCommandId = `${manifest.id}.${cmd.command}`;
        console.log(`Registered command: ${fullCommandId} - ${cmd.title}`);
        // Commands are registered when plugin calls api.commands.register
      });
    }

    // Process keybindings
    if (contributions.keybindings) {
      contributions.keybindings.forEach(kb => {
        const fullCommandId = `${manifest.id}.${kb.command}`;
        const key = navigator.platform.includes('Mac') && kb.mac ? kb.mac : kb.key;
        this.keybindings.set(key, fullCommandId);
        console.log(`Registered keybinding: ${key} -> ${fullCommandId}`);
      });
    }

    // Process languages
    if (contributions.languages) {
      contributions.languages.forEach(lang => {
        this.registeredLanguages.set(lang.id, lang.extensions);
        console.log(`Registered language: ${lang.id} (${lang.extensions.join(', ')})`);
      });
    }

    // Process menus (emit event for UI to handle)
    if (contributions.menus) {
      this.emit('contributions:menus', manifest.id, contributions.menus);
    }

    // Process configuration
    if (contributions.configuration) {
      this.emit('contributions:configuration', manifest.id, contributions.configuration);
    }

    // Process themes
    if (contributions.themes) {
      this.emit('contributions:themes', manifest.id, contributions.themes);
    }
  }

  // Get all registered keybindings
  getKeybindings(): Map<string, string> {
    return new Map(this.keybindings);
  }

  // Get registered languages
  getRegisteredLanguages(): Map<string, string[]> {
    return new Map(this.registeredLanguages);
  }

  // Get language ID for a file extension
  getLanguageForExtension(extension: string): string | undefined {
    for (const [langId, extensions] of this.registeredLanguages) {
      if (extensions.includes(extension) || extensions.includes(`.${extension}`)) {
        return langId;
      }
    }
    return undefined;
  }

  // Handle keyboard shortcuts
  handleKeyboardShortcut(key: string): boolean {
    const commandId = this.keybindings.get(key);
    if (commandId) {
      this.executeCommand(commandId).catch(console.error);
      return true;
    }
    return false;
  }

  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.isActive) {
      return;
    }

    try {
      if (plugin.deactivate) {
        await plugin.deactivate();
      }
      plugin.isActive = false;
      console.log(`Plugin ${pluginId} deactivated`);
    } catch (error) {
      console.error(`Failed to deactivate plugin ${pluginId}:`, error);
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    await this.deactivatePlugin(pluginId);
    this.plugins.delete(pluginId);
    console.log(`Plugin ${pluginId} unloaded`);
  }

  getLoadedPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  // Load plugins from the workspace plugins directory
  async loadPluginsFromDirectory(workspacePath: string): Promise<void> {
    const pluginsDir = await getPluginsDir(workspacePath);
    
    try {
      const exists = await fs.pathExists(pluginsDir);
      if (!exists) {
        console.log('No plugins directory found at', pluginsDir);
        return;
      }

      const entries = await fs.readDirectory(pluginsDir);
      const pluginDirs = entries.filter(e => e.is_directory);

      for (const dir of pluginDirs) {
        await this.loadPluginFromPath(dir.path);
      }
    } catch (error) {
      console.error('Failed to load plugins from directory:', error);
    }
  }

  // Load a single plugin from a directory path
  async loadPluginFromPath(pluginPath: string): Promise<void> {
    try {
      // Read manifest
      const manifestPath = `${pluginPath}/package.json`;
      const manifestExists = await fs.pathExists(manifestPath);
      
      if (!manifestExists) {
        console.warn(`No package.json found in ${pluginPath}`);
        return;
      }

      const manifestContent = await fs.readFile(manifestPath);
      const packageJson = JSON.parse(manifestContent);
      
      // Build manifest from package.json
      const manifest: PluginManifest = {
        id: packageJson.name || pluginPath.split('/').pop() || 'unknown',
        name: packageJson.displayName || packageJson.name || 'Unknown Plugin',
        version: packageJson.version || '0.0.0',
        description: packageJson.description,
        author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author?.name,
        main: packageJson.main || 'index.js',
        activationEvents: packageJson.activationEvents,
        contributes: packageJson.contributes,
      };

      // Read main file
      const mainPath = `${pluginPath}/${manifest.main}`;
      const mainExists = await fs.pathExists(mainPath);
      
      if (!mainExists) {
        console.warn(`Main file not found: ${mainPath}`);
        return;
      }

      const code = await fs.readFile(mainPath);
      
      // Load the plugin
      await this.loadPlugin(manifest, code);
      console.log(`Loaded external plugin: ${manifest.id} from ${pluginPath}`);
    } catch (error) {
      console.error(`Failed to load plugin from ${pluginPath}:`, error);
    }
  }

  // Install a plugin from a URL or path
  async installPlugin(source: string, workspacePath: string): Promise<boolean> {
    const pluginsDir = await getPluginsDir(workspacePath);
    
    try {
      // Ensure plugins directory exists
      const exists = await fs.pathExists(pluginsDir);
      if (!exists) {
        await fs.createDirectory(pluginsDir);
      }

      // For now, only support loading from local paths
      if (source.startsWith('/') || source.startsWith('.')) {
        // Local path - copy plugin directory
        const pluginName = source.split('/').pop() || 'plugin';
        const destPath = `${pluginsDir}/${pluginName}`;
        
        // This would need a recursive copy function
        console.log(`Would install plugin from ${source} to ${destPath}`);
        return true;
      }

      // URL-based installation would go here
      console.log('URL-based plugin installation not yet implemented');
      return false;
    } catch (error) {
      console.error('Failed to install plugin:', error);
      return false;
    }
  }

  // Uninstall a plugin
  async uninstallPlugin(pluginId: string, workspacePath: string): Promise<boolean> {
    try {
      // Deactivate and unload first
      await this.unloadPlugin(pluginId);
      
      // Note: File deletion would need to be handled carefully
      // For now, just unload the plugin
      console.log(`Plugin ${pluginId} unloaded. Manual deletion may be required.`);
      return true;
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      return false;
    }
  }

  // Execute a registered command
  async executeCommand(commandId: string, ...args: any[]): Promise<any> {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command ${commandId} not found`);
    }
    return command(...args);
  }

  // Register a command
  registerCommand(commandId: string, callback: (...args: any[]) => any): () => void {
    this.commands.set(commandId, callback);
    return () => {
      this.commands.delete(commandId);
    };
  }

  // Emit an event
  emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // Subscribe to an event
  on(event: string, callback: Function): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return () => {
      this.eventListeners.get(event)?.delete(callback);
    };
  }

  private createPluginAPI(pluginId: string): PluginAPI {
    return {
      workspace: {
        get rootPath() {
          return useWorkspaceStore.getState().currentWorkspace?.rootPath || null;
        },
        openFile: async (path: string) => {
          await useEditorStore.getState().openFile(path);
        },
        saveFile: async (path: string) => {
          await useEditorStore.getState().saveFile(path);
        },
        getOpenFiles: () => {
          return useEditorStore.getState().openFiles.map((f) => f.path);
        },
        onDidOpenFile: (callback) => {
          return this.on('file:open', callback);
        },
        onDidSaveFile: (callback) => {
          return this.on('file:save', callback);
        },
      },

      editor: {
        getActiveFile: () => {
          const active = useEditorStore.getState().activeFile;
          return active ? { path: active.path, content: active.content } : null;
        },
        setSelection: (start, end) => {
          this.emit('editor:setSelection', start, end);
        },
        insertText: (text) => {
          this.emit('editor:insertText', text);
        },
        replaceSelection: (text) => {
          this.emit('editor:replaceSelection', text);
        },
        showMessage: (message, type = 'info') => {
          this.emit('ui:showMessage', message, type);
        },
      },

      commands: {
        register: (id, callback) => {
          const fullId = `${pluginId}.${id}`;
          return this.registerCommand(fullId, callback);
        },
        execute: async (id, ...args) => {
          return this.executeCommand(id, ...args);
        },
      },

      ui: {
        showQuickPick: async (items: QuickPickItem[], options?: QuickPickOptions) => {
          return new Promise((resolve) => {
            this.emit('ui:showQuickPick', items, options, resolve);
          });
        },
        showInputBox: async (options?: InputBoxOptions) => {
          return new Promise((resolve) => {
            this.emit('ui:showInputBox', options, resolve);
          });
        },
        showNotification: (message, type = 'info') => {
          this.emit('ui:showNotification', message, type);
        },
        createStatusBarItem: (alignment, priority = 0) => {
          const item: StatusBarItem = {
            text: '',
            tooltip: undefined,
            command: undefined,
            show: () => {
              this.emit('statusBar:show', item);
            },
            hide: () => {
              this.emit('statusBar:hide', item);
            },
            dispose: () => {
              const index = this.statusBarItems.indexOf(item);
              if (index !== -1) {
                this.statusBarItems.splice(index, 1);
              }
              this.emit('statusBar:dispose', item);
            },
          };
          this.statusBarItems.push(item);
          return item;
        },
      },

      storage: {
        get: async (key) => {
          const stored = localStorage.getItem(`plugin:${pluginId}:${key}`);
          return stored ? JSON.parse(stored) : undefined;
        },
        set: async (key, value) => {
          localStorage.setItem(`plugin:${pluginId}:${key}`, JSON.stringify(value));
        },
        remove: async (key) => {
          localStorage.removeItem(`plugin:${pluginId}:${key}`);
        },
      },
    };
  }
}

export const PluginManager = new PluginManagerClass();

// Example built-in plugins
export const BUILT_IN_PLUGINS: { manifest: PluginManifest; code: string }[] = [
  {
    manifest: {
      id: 'openide.word-count',
      name: 'Word Count',
      version: '1.0.0',
      description: 'Shows word count for the current file',
      author: 'OpenCodeBrew',
      main: 'index.js',
    },
    code: `
      let statusItem = null;
      
      function activate(api) {
        statusItem = api.ui.createStatusBarItem('right', 100);
        
        function updateWordCount() {
          const file = api.editor.getActiveFile();
          if (file) {
            const words = file.content.split(/\\s+/).filter(w => w.length > 0).length;
            const chars = file.content.length;
            statusItem.text = \`Words: \${words} | Chars: \${chars}\`;
            statusItem.show();
          } else {
            statusItem.hide();
          }
        }
        
        updateWordCount();
        api.workspace.onDidOpenFile(updateWordCount);
      }
      
      function deactivate() {
        if (statusItem) {
          statusItem.dispose();
        }
      }
    `,
  },
  {
    manifest: {
      id: 'openide.mermaid',
      name: 'Mermaid Diagrams',
      version: '1.0.0',
      description: 'Renders Mermaid diagrams in AI responses and markdown previews. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, and more.',
      author: 'OpenCodeBrew',
      main: 'index.js',
    },
    code: `
      let statusItem = null;
      
      function activate(api) {
        // Register command to show mermaid syntax help
        api.commands.register('showMermaidHelp', () => {
          api.ui.showNotification(
            'Mermaid diagrams are automatically rendered in AI responses. Use code blocks with "mermaid" language tag.',
            'info'
          );
        });
        
        // Create status bar item to indicate mermaid is active
        statusItem = api.ui.createStatusBarItem('right', 50);
        statusItem.text = '◇ Mermaid';
        statusItem.tooltip = 'Mermaid diagram rendering is enabled';
        statusItem.show();
        
        api.ui.showNotification('Mermaid Diagrams plugin activated', 'info');
      }
      
      function deactivate() {
        if (statusItem) {
          statusItem.dispose();
        }
      }
    `,
  },
];
