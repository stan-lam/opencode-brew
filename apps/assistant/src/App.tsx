import { useEffect } from 'react';
import { useAssistantStore, Agent, ExecutionLog } from './store/assistantStore';
import { AgentList } from './components/AgentList';
import { AgentDetail } from './components/AgentDetail';
import { AgentBuilder } from './components/AgentBuilder';
import { ExecutionHistory } from './components/ExecutionHistory';
import { Bot, History, Plus } from 'lucide-react';
import styles from './App.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function App() {
  const {
    view,
    selectedAgentId,
    isCreating,
    isEditing,
    setAgents,
    setExecutions,
    setView,
    setIsCreating,
  } = useAssistantStore();

  useEffect(() => {
    const initDatabase = async () => {
      try {
        const invoke = await getInvoke();
        await invoke('init_scheduler_db');
        
        const agents = await invoke('list_agents');
        setAgents(agents as Agent[]);
        
        const executions = await invoke('list_executions', { agentId: null, limit: 50 });
        setExecutions(executions as ExecutionLog[]);
      } catch (error) {
        console.error('Failed to initialize scheduler database:', error);
      }
    };

    initDatabase();
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Bot size={24} />
          <h1>OpenCodeAssistant</h1>
        </div>
        <nav className={styles.nav}>
          <button
            className={`${styles.navBtn} ${view === 'agents' ? styles.active : ''}`}
            onClick={() => setView('agents')}
          >
            <Bot size={18} />
            <span>Agents</span>
          </button>
          <button
            className={`${styles.navBtn} ${view === 'history' ? styles.active : ''}`}
            onClick={() => setView('history')}
          >
            <History size={18} />
            <span>History</span>
          </button>
        </nav>
        <div className={styles.actions}>
          <button 
            className={styles.newAgentBtn}
            onClick={() => setIsCreating(true)}
          >
            <Plus size={18} />
            <span>New Agent</span>
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {view === 'agents' ? (
          <div className={styles.agentsLayout}>
            <AgentList />
            <div className={styles.detailPanel}>
              {isCreating || isEditing ? (
                <AgentBuilder />
              ) : selectedAgentId ? (
                <AgentDetail />
              ) : (
                <div className={styles.emptyDetail}>
                  <Bot size={48} className={styles.emptyIcon} />
                  <p>Select an agent or create a new one</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <ExecutionHistory />
        )}
      </main>
    </div>
  );
}

export default App;
