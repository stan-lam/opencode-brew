import { FolderOpen, FileText, GitBranch, MessageSquare, Clock, Zap, Search, Folder, ExternalLink, RefreshCw } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { dialog, appWindow } from '../../services/tauri';
import { invoke } from '@tauri-apps/api/core';
import styles from './WelcomeTab.module.css';

export function WelcomeTab() {
  const { recentWorkspaces, openFolder, currentWorkspace } = useWorkspaceStore();
  const { setActiveSideTab } = useLayoutStore();

  const handleOpenFolder = async () => {
    console.log('Opening folder dialog...');
    try {
      const folderPath = await dialog.openDirectory();
      console.log('Selected folder:', folderPath);
      if (folderPath) {
        console.log('Calling openFolder...');
        await openFolder(folderPath);
        console.log('openFolder completed');
      }
    } catch (error) {
      console.error('Error in handleOpenFolder:', error);
    }
  };

  const handleOpenRecent = async (path: string) => {
    await openFolder(path);
  };

  const handleOpenInNewWindow = async (path?: string) => {
    try {
      const label = `ide-${Date.now()}`;
      await invoke('open_tool_window', { 
        tool: 'ide', 
        label, 
        title: path ? path.split('/').pop() || 'OpenCodeBrew' : 'OpenCodeBrew' 
      });
    } catch (error) {
      console.error('Error opening new window:', error);
    }
  };

  // If workspace is open, show workspace-specific welcome
  if (currentWorkspace) {
    // Filter out current workspace from recent
    const otherWorkspaces = recentWorkspaces.filter(w => w.rootPath !== currentWorkspace.rootPath);

    return (
      <div className={styles.welcome}>
        <div className={styles.content}>
          <div className={styles.logo}>
            <Folder size={48} strokeWidth={1.5} />
          </div>
          <h1 className={styles.title}>{currentWorkspace.name}</h1>
          <p className={styles.subtitle}>{currentWorkspace.rootPath}</p>

          <div className={styles.sections}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Quick Actions</h2>
              <div className={styles.actions}>
                <button className={styles.action} onClick={() => setActiveSideTab('explorer')}>
                  <Folder size={18} />
                  <span>Browse Files</span>
                </button>
                <button className={styles.action} onClick={() => setActiveSideTab('search')}>
                  <Search size={18} />
                  <span>Search in Files</span>
                </button>
                <button className={styles.action} onClick={() => setActiveSideTab('ai')}>
                  <MessageSquare size={18} />
                  <span>AI Assistant</span>
                </button>
                <button className={styles.action} onClick={() => setActiveSideTab('git')}>
                  <GitBranch size={18} />
                  <span>Source Control</span>
                </button>
              </div>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Switch Project</h2>
              <div className={styles.actions}>
                <button className={styles.action} onClick={handleOpenFolder}>
                  <FolderOpen size={18} />
                  <span>Open Folder...</span>
                </button>
                <button className={styles.action} onClick={() => handleOpenInNewWindow()}>
                  <ExternalLink size={18} />
                  <span>New Window</span>
                </button>
              </div>
              {otherWorkspaces.length > 0 && (
                <div className={styles.recentList}>
                  <h3 className={styles.recentTitle}>Recent Projects</h3>
                  {otherWorkspaces.slice(0, 5).map((workspace) => (
                    <button
                      key={workspace.id}
                      className={styles.recentItem}
                      onClick={() => handleOpenRecent(workspace.rootPath)}
                    >
                      <FileText size={16} />
                      <div className={styles.recentInfo}>
                        <span className={styles.recentName}>{workspace.name}</span>
                        <span className={styles.recentPath}>{workspace.rootPath}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Getting Started</h2>
              <div className={styles.features}>
                <div className={styles.feature}>
                  <Folder size={20} />
                  <div>
                    <h3>Open a file</h3>
                    <p>Click on the Explorer icon or press <kbd>⌘</kbd><kbd>P</kbd> for quick open</p>
                  </div>
                </div>
                <div className={styles.feature}>
                  <MessageSquare size={20} />
                  <div>
                    <h3>Get AI help</h3>
                    <p>Ask questions about your code or get suggestions from AI</p>
                  </div>
                </div>
                <div className={styles.feature}>
                  <GitBranch size={20} />
                  <div>
                    <h3>Manage changes</h3>
                    <p>Track your changes with Git or use the local history</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.shortcuts}>
            <span><kbd>⌘</kbd><kbd>O</kbd> Open Folder</span>
            <span><kbd>⌘</kbd><kbd>P</kbd> Quick Open</span>
            <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd> Search Files</span>
            <span><kbd>F5</kbd> Run Project</span>
          </div>
        </div>
      </div>
    );
  }

  // No workspace open - show full welcome screen
  return (
    <div className={styles.welcome}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <Zap size={48} strokeWidth={1.5} />
        </div>
        <h1 className={styles.title}>Welcome to OpenCodeBrew</h1>
        <p className={styles.subtitle}>
          A powerful IDE with AI assistance, local history, and seamless CLI integration
        </p>

        <div className={styles.sections}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Start</h2>
            <div className={styles.actions}>
              <button className={styles.action} onClick={handleOpenFolder}>
                <FolderOpen size={18} />
                <span>Open Folder</span>
              </button>
              <button className={styles.action} onClick={() => setActiveSideTab('git')}>
                <GitBranch size={18} />
                <span>Clone Repository</span>
              </button>
            </div>
          </section>

          {recentWorkspaces.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Recent</h2>
              <div className={styles.recentList}>
                {recentWorkspaces.slice(0, 5).map((workspace) => (
                  <button
                    key={workspace.id}
                    className={styles.recentItem}
                    onClick={() => handleOpenRecent(workspace.rootPath)}
                  >
                    <FileText size={16} />
                    <div className={styles.recentInfo}>
                      <span className={styles.recentName}>{workspace.name}</span>
                      <span className={styles.recentPath}>{workspace.rootPath}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Features</h2>
            <div className={styles.features}>
              <div className={styles.feature}>
                <MessageSquare size={20} />
                <div>
                  <h3>AI Assistant</h3>
                  <p>Chat with AI using Ollama, Claude, or OpenAI</p>
                </div>
              </div>
              <div className={styles.feature}>
                <Clock size={20} />
                <div>
                  <h3>Local History</h3>
                  <p>Track and restore file changes automatically</p>
                </div>
              </div>
              <div className={styles.feature}>
                <GitBranch size={20} />
                <div>
                  <h3>Git Integration</h3>
                  <p>Full GitHub and GitLab support built-in</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className={styles.shortcuts}>
          <span><kbd>⌘</kbd><kbd>O</kbd> Open Folder</span>
          <span><kbd>⌘</kbd><kbd>P</kbd> Quick Open</span>
          <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>A</kbd> AI Chat</span>
        </div>
      </div>
    </div>
  );
}
