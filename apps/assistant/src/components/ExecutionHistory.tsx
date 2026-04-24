import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, Clock, ChevronRight, RefreshCw } from 'lucide-react';
import { useAssistantStore, ExecutionLog, ActionLog } from '../store/assistantStore';
import styles from './ExecutionHistory.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

const REFRESH_INTERVAL = 3000; // auto-refresh every 3 seconds

export function ExecutionHistory() {
  const { executions, agents, setExecutions } = useAssistantStore();
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [executionDetails, setExecutionDetails] = useState<{
    execution: ExecutionLog;
    actions: ActionLog[];
  } | null>(null);

  const loadExecutions = async () => {
    try {
      const invoke = await getInvoke();
      const result = await invoke('list_executions', { agentId: null, limit: 100 });
      setExecutions(result as ExecutionLog[]);
    } catch (error) {
      console.error('Failed to load executions:', error);
    }
  };

  const loadExecutionDetails = async (id: string) => {
    try {
      const invoke = await getInvoke();
      const [execution, actions] = await invoke('get_execution_details', { executionId: id }) as [ExecutionLog, ActionLog[]];
      setExecutionDetails({ execution, actions });
    } catch (error) {
      console.error('Failed to load execution details:', error);
    }
  };

  // Auto-refresh execution list periodically
  useEffect(() => {
    loadExecutions();
    const interval = setInterval(loadExecutions, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh selected execution details (catches status changes like running -> success/failed)
  useEffect(() => {
    if (!selectedExecution) {
      setExecutionDetails(null);
      return;
    }
    loadExecutionDetails(selectedExecution);
    const interval = setInterval(() => loadExecutionDetails(selectedExecution), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedExecution]);

  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || 'Unknown Agent';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={16} className={styles.statusSuccess} />;
      case 'failed':
        return <XCircle size={16} className={styles.statusFailed} />;
      case 'running':
        return <Loader2 size={16} className={styles.statusRunning} />;
      default:
        return <Clock size={16} className={styles.statusPending} />;
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'Running...';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <h2>Execution History</h2>
          <button onClick={loadExecutions} className={styles.refreshBtn}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className={styles.listContent}>
          {(() => {
            const uniqueExecutions = [...new Map(executions.map(e => [e.id, e])).values()];
            return uniqueExecutions.length === 0 ? (
              <div className={styles.empty}>
                <Clock size={32} />
                <p>No executions yet</p>
              </div>
            ) : (
              uniqueExecutions.map((exec) => (
                <button
                  key={`exec-${exec.id}`}
                  className={`${styles.item} ${selectedExecution === exec.id ? styles.selected : ''}`}
                  onClick={() => setSelectedExecution(exec.id)}
                >
                  <div className={styles.itemHeader}>
                    {getStatusIcon(exec.status)}
                    <span className={styles.agentName}>{getAgentName(exec.agent_id)}</span>
                    <ChevronRight size={16} className={styles.chevron} />
                  </div>
                  <div className={styles.itemMeta}>
                    <span>{formatTime(exec.started_at)}</span>
                    <span>{formatDuration(exec.started_at, exec.finished_at)}</span>
                  </div>
                </button>
              ))
            );
          })()}
        </div>
      </div>

      <div className={styles.detail}>
        {executionDetails ? (
          <>
            <div className={styles.detailHeader}>
              <div>
                <h3>{getAgentName(executionDetails.execution.agent_id)}</h3>
                <span className={`${styles.statusBadge} ${styles[executionDetails.execution.status]}`}>
                  {executionDetails.execution.status}
                </span>
              </div>
              <div className={styles.detailMeta}>
                <span>Started: {formatTime(executionDetails.execution.started_at)}</span>
                <span>Duration: {formatDuration(executionDetails.execution.started_at, executionDetails.execution.finished_at)}</span>
                <span>Trigger: {executionDetails.execution.trigger_type}</span>
              </div>
            </div>

            <div className={styles.actionLogs}>
              <h4>Actions</h4>
              {executionDetails.actions.map((action) => (
                <div key={`act-${action.id}`} className={`${styles.actionLog} ${styles[action.status]}`}>
                  <div className={styles.actionLogHeader}>
                    {getStatusIcon(action.status)}
                    <span className={styles.actionName}>{action.action_name}</span>
                    <span className={styles.actionDuration}>
                      {formatDuration(action.started_at, action.finished_at)}
                    </span>
                  </div>
                  {action.output && (
                    <pre className={styles.output}>{action.output}</pre>
                  )}
                  {action.error && (
                    <pre className={styles.error}>{action.error}</pre>
                  )}
                </div>
              ))}
            </div>

            {executionDetails.execution.output && (
              <div className={styles.fullOutput}>
                <h4>Full Output</h4>
                <pre>{executionDetails.execution.output}</pre>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <Clock size={48} />
            <p>Select an execution to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
