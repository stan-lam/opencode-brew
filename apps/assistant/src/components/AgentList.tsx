import { Bot, Clock, FileText, Globe, Play, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAssistantStore, Agent } from '../store/assistantStore';
import styles from './AgentList.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

export function AgentList() {
  const { agents, selectedAgentId, selectAgent, updateAgent } = useAssistantStore();

  const handleToggleAgent = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const invoke = await getInvoke();
      await invoke('toggle_agent', { id: agent.id, enabled: !agent.enabled });
      updateAgent({ ...agent, enabled: !agent.enabled });
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    }
  };

  const getTriggerIcon = (type: string) => {
    switch (type) {
      case 'cron':
        return <Clock size={14} />;
      case 'file_watch':
        return <FileText size={14} />;
      case 'webhook':
        return <Globe size={14} />;
      default:
        return <Play size={14} />;
    }
  };

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <h2>Agents</h2>
        <span className={styles.count}>{agents.length}</span>
      </div>
      <div className={styles.items}>
        {agents.length === 0 ? (
          <div className={styles.empty}>
            <Bot size={32} />
            <p>No agents yet</p>
            <span>Create your first agent to automate tasks</span>
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className={`${styles.item} ${selectedAgentId === agent.id ? styles.selected : ''}`}
              onClick={() => selectAgent(agent.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && selectAgent(agent.id)}
            >
              <div className={styles.itemHeader}>
                <span className={styles.itemName}>{agent.name}</span>
                <button
                  className={styles.toggleBtn}
                  onClick={(e) => handleToggleAgent(agent, e)}
                  title={agent.enabled ? 'Disable' : 'Enable'}
                >
                  {agent.enabled ? (
                    <ToggleRight size={20} className={styles.toggleOn} />
                  ) : (
                    <ToggleLeft size={20} className={styles.toggleOff} />
                  )}
                </button>
              </div>
              {agent.description && (
                <p className={styles.itemDescription}>{agent.description}</p>
              )}
              <div className={styles.itemMeta}>
                <span className={styles.triggerBadge}>
                  {getTriggerIcon(agent.trigger.type)}
                  {agent.trigger.type}
                </span>
                <span className={styles.actionCount}>
                  {agent.actions?.length ?? agent.stages?.reduce((acc, s) => acc + s.actions.length, 0) ?? 0} action{(agent.actions?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
