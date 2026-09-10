import React from 'react';
import {
  Play,
  Pause,
  Square,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  SkipForward,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { useWorkflowOrchestratorStore } from '../../store/workflowOrchestratorStore';
import type { AgentState, AgentStatus } from '../../types/workflow';
import styles from './WorkflowProgress.module.css';

const STATUS_ICONS: Record<AgentStatus, React.ReactNode> = {
  'idle': <Circle size={14} />,
  'running': <Clock size={14} className={styles.spinning} />,
  'waiting_input': <Clock size={14} />,
  'completed': <CheckCircle2 size={14} />,
  'failed': <AlertCircle size={14} />,
  'skipped': <SkipForward size={14} />,
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  'idle': '#666',
  'running': '#6366f1',
  'waiting_input': '#f59e0b',
  'completed': '#22c55e',
  'failed': '#ef4444',
  'skipped': '#888',
};

interface AgentRowProps {
  agent: AgentState;
  onRetry?: () => void;
  onSkip?: () => void;
}

const AgentRow: React.FC<AgentRowProps> = ({ agent, onRetry, onSkip }) => {
  const { config, status, error } = agent;

  return (
    <div className={`${styles.agentRow} ${styles[`status_${status}`]}`}>
      <div className={styles.agentIcon} style={{ color: STATUS_COLORS[status] }}>
        {STATUS_ICONS[status]}
      </div>
      <div className={styles.agentInfo}>
        <span className={styles.agentName}>{config.name}</span>
        {error && <span className={styles.agentError}>{error}</span>}
      </div>
      <div className={styles.agentActions}>
        {status === 'failed' && onRetry && (
          <button className={styles.actionButton} onClick={onRetry} title="Retry">
            <RefreshCw size={12} />
          </button>
        )}
        {status === 'idle' && config.optional && onSkip && (
          <button className={styles.actionButton} onClick={onSkip} title="Skip">
            <SkipForward size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

export const WorkflowProgress: React.FC = () => {
  const {
    currentExecution,
    pauseWorkflow,
    resumeWorkflow,
    cancelWorkflow,
    retryAgent,
    skipAgent,
    templates,
  } = useWorkflowOrchestratorStore();

  if (!currentExecution) {
    return null;
  }

  const template = templates.find(t => t.id === currentExecution.templateId);
  const agents = Object.values(currentExecution.agents);
  const isPaused = currentExecution.status === 'paused';
  const isFailed = currentExecution.status === 'failed';
  const isActive = currentExecution.status === 'in_progress' || currentExecution.status === 'planning';

  return (
    <div className={styles.workflowProgress}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Dev Team Workflow</span>
          <span className={`${styles.statusBadge} ${styles[`badge_${currentExecution.status}`]}`}>
            {currentExecution.status.replace('_', ' ')}
          </span>
        </div>
        <div className={styles.headerActions}>
          {isActive && (
            <button className={styles.controlButton} onClick={pauseWorkflow} title="Pause">
              <Pause size={14} />
            </button>
          )}
          {isPaused && (
            <button className={styles.controlButton} onClick={resumeWorkflow} title="Resume">
              <Play size={14} />
            </button>
          )}
          <button 
            className={`${styles.controlButton} ${styles.cancelButton}`} 
            onClick={cancelWorkflow} 
            title="Cancel"
          >
            <Square size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className={styles.progressSection}>
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill} 
            style={{ width: `${currentExecution.progress}%` }}
          />
        </div>
        <span className={styles.progressText}>{currentExecution.progress}%</span>
      </div>

      {/* Current stage */}
      <div className={styles.stageInfo}>
        <span className={styles.stageLabel}>Current Stage:</span>
        <span className={styles.stageName}>{currentExecution.currentStage}</span>
      </div>

      {/* Agent list */}
      <div className={styles.agentList}>
        {agents.map((agent) => (
          <AgentRow
            key={agent.config.id}
            agent={agent}
            onRetry={agent.status === 'failed' ? () => retryAgent(agent.config.id) : undefined}
            onSkip={agent.config.optional && agent.status === 'idle' ? () => skipAgent(agent.config.id) : undefined}
          />
        ))}
      </div>

      {/* Affected files */}
      {currentExecution.affectedFiles.length > 0 && (
        <div className={styles.filesSection}>
          <div className={styles.filesHeader}>
            <span>Files Modified ({currentExecution.affectedFiles.length})</span>
            <ChevronRight size={14} />
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowProgress;
