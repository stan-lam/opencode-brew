import { useState } from 'react';
import { Play, Edit, Trash2, Clock, FileText, Globe, Terminal, Loader2, CheckCircle, XCircle, History, Mail, MessageSquare, Layers, Zap } from 'lucide-react';
import { useAssistantStore, ExecutionLog, getAgentStages } from '../store/assistantStore';
import styles from './AgentDetail.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

export function AgentDetail() {
  const { getSelectedAgent, setIsEditing, removeAgent, addExecution, setView } = useAssistantStore();
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ status: 'success' | 'failed' | 'error'; message: string; timestamp: Date } | null>(null);
  
  const agent = getSelectedAgent();
  
  if (!agent) return null;

  const handleRun = async () => {
    setIsRunning(true);
    setLastResult(null);
    try {
      const invoke = await getInvoke();
      console.log('[AgentDetail] Executing agent:', agent.id);
      const result = await invoke('execute_agent', { agentId: agent.id }) as ExecutionLog;
      console.log('[AgentDetail] Execution result:', result);
      addExecution(result);
      
      setLastResult({
        status: result.status as 'success' | 'failed',
        message: result.status === 'success' 
          ? `Agent completed successfully in ${formatDuration(result.started_at, result.finished_at)}`
          : `Agent failed: ${result.error || 'Unknown error'}`,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('[AgentDetail] Failed to execute agent:', error);
      setLastResult({
        status: 'error',
        message: `Failed to execute: ${error}`,
        timestamp: new Date(),
      });
    } finally {
      setIsRunning(false);
    }
  };

  const formatDuration = (start: string, end?: string | null) => {
    if (!end) return '0ms';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const dismissResult = () => setLastResult(null);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${agent.name}"?`)) return;
    
    try {
      const invoke = await getInvoke();
      await invoke('delete_agent', { id: agent.id });
      removeAgent(agent.id);
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  const getTriggerDescription = () => {
    switch (agent.trigger.type) {
      case 'cron':
        return `Runs on schedule: ${agent.trigger.expression}`;
      case 'file_watch':
        return `Watches: ${agent.trigger.path}`;
      case 'webhook':
        return `Webhook: ${agent.trigger.path}`;
      default:
        return 'Manual trigger';
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'cli':
        return <Terminal size={16} />;
      case 'api':
        return <Globe size={16} />;
      case 'send_email':
        return <Mail size={16} />;
      case 'send_slack':
        return <MessageSquare size={16} />;
      case 'send_discord':
        return <MessageSquare size={16} />;
      default:
        return <FileText size={16} />;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h2>{agent.name}</h2>
          {agent.description && <p>{agent.description}</p>}
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.runBtn}
            onClick={handleRun}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 size={18} className={styles.spinner} /> : <Play size={18} />}
            {isRunning ? 'Running...' : 'Run Now'}
          </button>
          <button className={styles.editBtn} onClick={() => setIsEditing(true)}>
            <Edit size={18} />
          </button>
          <button className={styles.deleteBtn} onClick={handleDelete}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Running indicator */}
      {isRunning && (
        <div className={styles.runningBanner}>
          <Loader2 size={16} className={styles.spinner} />
          <span>Executing agent actions...</span>
        </div>
      )}

      {/* Result notification */}
      {lastResult && (
        <div className={`${styles.resultBanner} ${styles[lastResult.status]}`}>
          <div className={styles.resultContent}>
            {lastResult.status === 'success' ? (
              <CheckCircle size={18} />
            ) : (
              <XCircle size={18} />
            )}
            <span>{lastResult.message}</span>
          </div>
          <div className={styles.resultActions}>
            <button 
              className={styles.viewHistoryBtn}
              onClick={() => setView('history')}
            >
              <History size={14} />
              View History
            </button>
            <button 
              className={styles.dismissBtn}
              onClick={dismissResult}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        <section className={styles.section}>
          <h3>Trigger</h3>
          <div className={styles.triggerCard}>
            <Clock size={20} />
            <div>
              <span className={styles.triggerType}>{agent.trigger.type}</span>
              <p>{getTriggerDescription()}</p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3>
            <Layers size={18} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Workflow Stages ({getAgentStages(agent).length})
          </h3>
          <div className={styles.stagesList}>
            {getAgentStages(agent).map((stage, stageIndex) => (
              <div key={stage.id} className={styles.stageCard}>
                <div className={styles.stageHeader}>
                  <div className={styles.stageNumber}>{stageIndex + 1}</div>
                  <span className={styles.stageName}>{stage.name}</span>
                  {stage.actions.length > 1 && (
                    <span className={styles.parallelBadge}>
                      <Zap size={12} />
                      {stage.actions.length} parallel
                    </span>
                  )}
                </div>
                <div className={stage.actions.length > 1 ? styles.parallelActions : styles.sequentialActions}>
                  {stage.actions.map((action, actionIndex) => (
                    <div key={action.id} className={styles.actionCard}>
                      <div className={styles.actionIcon}>
                        {getActionIcon(action.action_type.type)}
                      </div>
                      <div className={styles.actionInfo}>
                        <span className={styles.actionName}>{action.name}</span>
                        <span className={styles.actionType}>{action.action_type.type.toUpperCase()}</span>
                      </div>
                      <span className={styles.onError}>{action.on_error}</span>
                    </div>
                  ))}
                </div>
                {stageIndex < getAgentStages(agent).length - 1 && (
                  <div className={styles.stageConnector}>↓</div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
