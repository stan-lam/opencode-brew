import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, Clock, ChevronRight, RefreshCw, Layers, Zap } from 'lucide-react';
import { useAssistantStore, ExecutionLog, ActionLog } from '../store/assistantStore';
import styles from './ExecutionHistory.module.css';

interface GroupedActions {
  stageName: string;
  stageIndex: number;
  actions: ActionLog[];
  isParallel: boolean;
}

// Group actions by stage based on output patterns
function groupActionsByStage(actions: ActionLog[], output?: string | null): GroupedActions[] {
  if (!output) {
    // No output to parse, return each action as its own "stage"
    return actions.map((action, idx) => ({
      stageName: `Step ${idx + 1}`,
      stageIndex: idx,
      actions: [action],
      isParallel: false,
    }));
  }
  
  // Parse stages from output (format: "=== Stage N: Name ===")
  const stageMatches = output.matchAll(/=== Stage (\d+): (.+?) ===/g);
  const stageInfo: { index: number; name: string }[] = [];
  for (const match of stageMatches) {
    stageInfo.push({ index: parseInt(match[1]) - 1, name: match[2] });
  }
  
  if (stageInfo.length === 0) {
    // No stage info found, return each action as its own stage
    return actions.map((action, idx) => ({
      stageName: `Step ${idx + 1}`,
      stageIndex: idx,
      actions: [action],
      isParallel: false,
    }));
  }
  
  // Group actions by stage
  const groups: GroupedActions[] = [];
  let currentActionIdx = 0;
  
  for (const stage of stageInfo) {
    // Count actions in this stage by looking at output
    const stageOutputStart = output.indexOf(`=== Stage ${stage.index + 1}:`);
    const nextStageStart = output.indexOf(`=== Stage ${stage.index + 2}:`);
    const stageSection = nextStageStart > 0 
      ? output.slice(stageOutputStart, nextStageStart)
      : output.slice(stageOutputStart);
    
    // Count [action_name] patterns in this stage section
    const actionMatches = stageSection.match(/\[([^\]]+)\] (Success|Error):/g) || [];
    const actionsInStage = Math.max(1, actionMatches.length);
    
    const stageActions = actions.slice(currentActionIdx, currentActionIdx + actionsInStage);
    if (stageActions.length > 0) {
      groups.push({
        stageName: stage.name,
        stageIndex: stage.index,
        actions: stageActions,
        isParallel: stageActions.length > 1,
      });
    }
    currentActionIdx += actionsInStage;
  }
  
  // Add any remaining actions
  if (currentActionIdx < actions.length) {
    const remaining = actions.slice(currentActionIdx);
    groups.push({
      stageName: `Step ${groups.length + 1}`,
      stageIndex: groups.length,
      actions: remaining,
      isParallel: remaining.length > 1,
    });
  }
  
  return groups;
}

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
              <h4>
                <Layers size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Workflow Stages
              </h4>
              {groupActionsByStage(executionDetails.actions, executionDetails.execution.output).map((group) => (
                <div key={`stage-${group.stageIndex}`} className={styles.stageGroup}>
                  <div className={styles.stageGroupHeader}>
                    <span className={styles.stageNumber}>{group.stageIndex + 1}</span>
                    <span className={styles.stageName}>{group.stageName}</span>
                    {group.isParallel && (
                      <span className={styles.parallelBadge}>
                        <Zap size={12} />
                        {group.actions.length} parallel
                      </span>
                    )}
                  </div>
                  <div className={group.isParallel ? styles.parallelActionsContainer : styles.sequentialActionsContainer}>
                    {group.actions.map((action) => (
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
