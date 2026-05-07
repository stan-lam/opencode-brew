import { useState } from 'react';
import { Play, Edit, Trash2, Clock, FileText, Globe, Terminal, Loader2, CheckCircle, XCircle, History, Mail, MessageSquare, Layers, Zap, AlertTriangle } from 'lucide-react';
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
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

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const invoke = await getInvoke();
      await invoke('delete_agent', { id: agent.id });
      removeAgent(agent.id);
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to delete agent:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const cronToHumanReadable = (expr: string): string => {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    
    const [min, hour, dom, _month, dow] = parts;
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const formatTime = (h: number, m: number): string => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return m === 0 ? `${hour12} ${period}` : `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
    };

    const formatHour = (h: number): string => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${hour12}${period}`;
    };

    // Helper to check if a field is a simple number (no ranges, lists, or wildcards)
    const isSimpleNumber = (field: string): boolean => /^\d+$/.test(field);
    
    // Helper to format day of week ranges/lists
    const formatDow = (d: string): string => {
      if (d === '1-5') return 'weekdays';
      if (d === '0,6' || d === '6,0') return 'weekends';
      if (isSimpleNumber(d)) return dayNames[parseInt(d)] || d;
      if (d.includes('-')) {
        const [start, end] = d.split('-').map(Number);
        return `${dayNames[start]}-${dayNames[end]}`;
      }
      return d;
    };

    // Helper to format hour ranges
    const formatHourRange = (h: string): string => {
      if (h.includes('-')) {
        const [start, end] = h.split('-').map(Number);
        return `${formatHour(start)}-${formatHour(end)}`;
      }
      return formatHour(parseInt(h));
    };

    // Every N minutes: */N * * * *
    if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*') {
      const interval = parseInt(min.slice(2));
      return interval === 1 ? 'Every minute' : `Every ${interval} minutes`;
    }
    
    // Hourly with hour range and day range: M H-H * * D-D (e.g., 0 6-14 * * 1-5)
    if (isSimpleNumber(min) && hour.includes('-') && dom === '*' && dow !== '*') {
      const m = parseInt(min);
      const minStr = m === 0 ? '' : ` at minute ${m}`;
      return `Hourly ${formatHourRange(hour)}${minStr}, ${formatDow(dow)}`;
    }
    
    // Hourly with hour range: M H-H * * *
    if (isSimpleNumber(min) && hour.includes('-') && dom === '*' && dow === '*') {
      const m = parseInt(min);
      const minStr = m === 0 ? '' : ` at minute ${m}`;
      return `Hourly ${formatHourRange(hour)}${minStr}`;
    }
    
    // Hourly: M * * * * (specific minute, every hour)
    if (isSimpleNumber(min) && hour === '*' && dom === '*' && dow === '*') {
      const m = parseInt(min);
      return m === 0 ? 'Every hour' : `Hourly at minute ${m}`;
    }
    
    // Every N hours: M */N * * *
    if (isSimpleNumber(min) && hour.startsWith('*/') && dom === '*' && dow === '*') {
      const interval = parseInt(hour.slice(2));
      return `Every ${interval} hours at minute ${min}`;
    }
    
    // Weekly: M H * * D (specific single day of week, specific single hour)
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && isSimpleNumber(dow)) {
      const h = parseInt(hour);
      const m = parseInt(min);
      const d = parseInt(dow);
      const dayName = dayNames[d] || `day ${d}`;
      return `Every ${dayName} at ${formatTime(h, m)}`;
    }
    
    // Weekdays/specific days at specific time: M H * * D-D or D,D
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && dow !== '*' && !isSimpleNumber(dow)) {
      const h = parseInt(hour);
      const m = parseInt(min);
      return `${formatDow(dow)} at ${formatTime(h, m)}`;
    }
    
    // Monthly: M H D * *
    if (isSimpleNumber(min) && isSimpleNumber(hour) && isSimpleNumber(dom) && dow === '*') {
      const h = parseInt(hour);
      const m = parseInt(min);
      const d = parseInt(dom);
      const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
      return `Monthly on the ${d}${suffix} at ${formatTime(h, m)}`;
    }
    
    // Daily: M H * * *
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && dow === '*') {
      const h = parseInt(hour);
      const m = parseInt(min);
      if (h === 0 && m === 0) return 'Daily at midnight';
      if (h === 12 && m === 0) return 'Daily at noon';
      return `Daily at ${formatTime(h, m)}`;
    }
    
    // Every N days: M H */N * *
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom.startsWith('*/') && dow === '*') {
      const interval = parseInt(dom.slice(2));
      const h = parseInt(hour);
      const m = parseInt(min);
      return `Every ${interval} days at ${formatTime(h, m)}`;
    }
    
    return expr;
  };

  const getTriggerDescription = () => {
    switch (agent.trigger.type) {
      case 'cron':
        const humanReadable = cronToHumanReadable(agent.trigger.expression || '');
        const isCustom = humanReadable === agent.trigger.expression;
        return isCustom 
          ? `Runs on schedule: ${agent.trigger.expression}`
          : `${humanReadable} (${agent.trigger.expression})`;
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
          <button className={styles.deleteBtn} onClick={handleDeleteClick}>
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className={styles.modalOverlay} onClick={handleDeleteCancel}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>
              <AlertTriangle size={32} />
            </div>
            <h3>Delete Agent</h3>
            <p>Are you sure you want to delete <strong>"{agent.name}"</strong>?</p>
            <p className={styles.modalWarning}>
              This will also delete all execution history for this agent. This action cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button 
                className={styles.cancelBtn} 
                onClick={handleDeleteCancel}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button 
                className={styles.confirmDeleteBtn} 
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className={styles.spinner} />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete Agent
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
