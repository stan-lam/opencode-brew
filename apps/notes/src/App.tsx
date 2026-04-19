import { useEffect } from 'react';
import { useNotesStore } from './store/notesStore';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { EmptyState } from './components/EmptyState';
import styles from './App.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function App() {
  const { 
    activeConversationId, 
    setWorkspaces, 
    setActiveWorkspace,
    workspaces,
    activeWorkspaceId,
  } = useNotesStore();

  useEffect(() => {
    const initDatabase = async () => {
      try {
        const invoke = await getInvoke();
        await invoke('init_notes_db');
        
        const loadedWorkspaces = await invoke('list_workspaces');
        setWorkspaces(loadedWorkspaces as any[]);
        
        // Set default workspace if none selected
        if (!activeWorkspaceId && (loadedWorkspaces as any[]).length > 0) {
          setActiveWorkspace((loadedWorkspaces as any[])[0].id);
        }
      } catch (error) {
        console.error('Failed to initialize notes database:', error);
      }
    };

    initDatabase();
  }, []);

  return (
    <div className={styles.container}>
      <Sidebar />
      <main className={styles.main}>
        {activeConversationId ? (
          <ChatPanel />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

export default App;
