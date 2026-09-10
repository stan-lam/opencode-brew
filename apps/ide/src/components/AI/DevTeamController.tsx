/**
 * DevTeamController
 * 
 * Main controller component for the Dev Team workflow mode.
 * Handles workflow lifecycle, checkpoint management, and UI integration.
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  Users,
  Play,
  Rocket,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  GitPullRequest,
} from 'lucide-react';
import { useWorkflowOrchestratorStore } from '../../store/workflowOrchestratorStore';
import { useQuestionStore } from '../../store/questionStore';
import { useAIStore } from '../../store/aiStore';
import { CheckpointCard } from './CheckpointCard';
import { WorkflowProgress } from './WorkflowProgress';
import { QuestionQueue } from './QuestionQueue';
import { PRReviewInput, type PRReviewData } from './PRReviewInput';
import type { WorkflowContext } from '../../types/questions';
import type { WorkflowEvent, AgentType } from '../../types/workflow';
import styles from './DevTeamController.module.css';

interface DevTeamControllerProps {
  onStartWorkflow?: (templateId: string, context: WorkflowContext) => void;
  onExecuteAgent?: (agentId: AgentType, promptPath: string, userRequest: string) => Promise<void>;
}

const WORKFLOW_CONTEXTS: { id: WorkflowContext; name: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'new-feature',
    name: 'New Feature',
    description: 'Full development lifecycle with architecture review',
    icon: <Rocket size={20} />,
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Streamlined workflow for fixing bugs',
    icon: <AlertCircle size={20} />,
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: 'Code improvement with quality focus',
    icon: <CheckCircle2 size={20} />,
  },
  {
    id: 'new-project',
    name: 'New Project',
    description: 'Complete project setup from scratch',
    icon: <Users size={20} />,
  },
  {
    id: 'pr-review',
    name: 'PR Review',
    description: 'Multi-agent code review for PRs and commits',
    icon: <GitPullRequest size={20} />,
  },
];

export const DevTeamController: React.FC<DevTeamControllerProps> = ({ onStartWorkflow, onExecuteAgent }) => {
  const {
    currentExecution,
    startWorkflow,
    approveCheckpoint,
    rejectCheckpoint,
    getPendingCheckpoint,
    addEventListener,
    templates,
  } = useWorkflowOrchestratorStore();

  const { batches } = useQuestionStore();
  const { activeConversation } = useAIStore();
  
  const [selectedContext, setSelectedContext] = useState<WorkflowContext>('new-feature');
  const [isStarting, setIsStarting] = useState(false);
  const [prReviewData, setPrReviewData] = useState<PRReviewData | null>(null);

  const pendingCheckpoint = currentExecution ? getPendingCheckpoint() : null;
  const hasActiveQuestions = batches.length > 0;
  const isPrReviewContext = selectedContext === 'pr-review';

  // Subscribe to workflow events (agent execution is handled in AIPanel)
  useEffect(() => {
    const unsubscribe = addEventListener((event: WorkflowEvent) => {
      console.log('[DevTeamController] Workflow event:', event.type, event);
      
      switch (event.type) {
        case 'WORKFLOW_STARTED':
          setIsStarting(false);
          break;
        case 'WORKFLOW_COMPLETED':
          // Show completion notification
          break;
        case 'WORKFLOW_FAILED':
          setIsStarting(false);
          break;
        case 'CHECKPOINT_REACHED':
          // UI automatically shows checkpoint via pendingCheckpoint
          break;
        // Note: AGENT_STARTED is handled in AIPanel to ensure execution
        // happens even when DevTeamController is not mounted
      }
    });

    return unsubscribe;
  }, [addEventListener]);

  const handleStartWorkflow = useCallback(() => {
    if (!activeConversation) return;
    
    // For PR review, require the data to be loaded first
    if (selectedContext === 'pr-review' && !prReviewData) {
      return;
    }

    setIsStarting(true);
    
    // Find the appropriate template for the context
    let templateId: string;
    if (selectedContext === 'pr-review') {
      templateId = 'pr-review';
    } else if (selectedContext === 'bug-fix') {
      templateId = 'quick-fix';
    } else {
      templateId = 'full-development';
    }
    
    // For PR review, use the prepared prompt as the user request
    const userRequest = selectedContext === 'pr-review' && prReviewData 
      ? prReviewData.prompt 
      : '';
    
    // Start the workflow
    startWorkflow(templateId, userRequest, selectedContext, activeConversation.id);
    
    if (onStartWorkflow) {
      onStartWorkflow(templateId, selectedContext);
    }
  }, [selectedContext, activeConversation, startWorkflow, onStartWorkflow, prReviewData]);

  const handlePrReviewDataReady = useCallback((data: PRReviewData) => {
    setPrReviewData(data);
  }, []);

  // Clear PR review data when context changes
  useEffect(() => {
    if (selectedContext !== 'pr-review') {
      setPrReviewData(null);
    }
  }, [selectedContext]);

  const handleApproveCheckpoint = useCallback((checkpointId: string, feedback?: string, answers?: Record<string, string>) => {
    approveCheckpoint(checkpointId, feedback, answers);
  }, [approveCheckpoint]);

  const handleRejectCheckpoint = useCallback((checkpointId: string, feedback: string) => {
    rejectCheckpoint(checkpointId, feedback);
  }, [rejectCheckpoint]);

  // If no active workflow, show the start interface
  if (!currentExecution) {
    return (
      <div className={styles.devTeamController}>
        <div className={styles.startSection}>
          <div className={styles.startHeader}>
            <Users size={24} className={styles.headerIcon} />
            <div>
              <h3 className={styles.headerTitle}>Dev Team Mode</h3>
              <p className={styles.headerSubtitle}>
                AI agents collaborate to build your feature
              </p>
            </div>
          </div>

          <div className={styles.contextSelector}>
            <label className={styles.selectorLabel}>What are you building?</label>
            <div className={styles.contextOptions}>
              {WORKFLOW_CONTEXTS.map((ctx) => (
                <button
                  key={ctx.id}
                  className={`${styles.contextOption} ${selectedContext === ctx.id ? styles.contextSelected : ''}`}
                  onClick={() => setSelectedContext(ctx.id)}
                >
                  <span className={styles.contextIcon}>{ctx.icon}</span>
                  <span className={styles.contextInfo}>
                    <span className={styles.contextName}>{ctx.name}</span>
                    <span className={styles.contextDescription}>{ctx.description}</span>
                  </span>
                  {selectedContext === ctx.id && (
                    <CheckCircle2 size={16} className={styles.contextCheck} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* PR Review Input */}
          {isPrReviewContext && (
            <PRReviewInput 
              onDataReady={handlePrReviewDataReady} 
              disabled={isStarting}
            />
          )}

          {/* PR Review Data Summary */}
          {isPrReviewContext && prReviewData && (
            <div className={styles.prDataSummary}>
              <div className={styles.prDataHeader}>
                <CheckCircle2 size={14} className={styles.prDataIcon} />
                <span>Changes loaded</span>
              </div>
              <div className={styles.prDataDetails}>
                {prReviewData.source === 'pr' && prReviewData.metadata.prNumber && (
                  <span>PR #{prReviewData.metadata.prNumber}: {prReviewData.metadata.prTitle}</span>
                )}
                {prReviewData.source === 'commit' && prReviewData.metadata.commitHash && (
                  <span>Commit {prReviewData.metadata.commitHash.slice(0, 7)}: {prReviewData.metadata.commitMessage}</span>
                )}
                {prReviewData.source === 'local' && (
                  <span>{prReviewData.metadata.fileCount} files with uncommitted changes</span>
                )}
                {prReviewData.truncated && (
                  <span className={styles.prDataWarning}>(truncated)</span>
                )}
              </div>
            </div>
          )}

          {/* Workflow Preview */}
          {!isPrReviewContext && (
            <div className={styles.workflowPreview}>
              <div className={styles.previewHeader}>
                <Clock size={14} />
                <span>Workflow Preview</span>
              </div>
              <div className={styles.previewStages}>
                {selectedContext === 'bug-fix' ? (
                  <>
                    <span className={styles.previewStage}>Requirements</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Development</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Verification</span>
                  </>
                ) : (
                  <>
                    <span className={styles.previewStage}>Requirements</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Architecture</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>TDD</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Development</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Review</span>
                    <ChevronRight size={12} />
                    <span className={styles.previewStage}>Verification</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* PR Review Workflow Preview */}
          {isPrReviewContext && prReviewData && (
            <div className={styles.workflowPreview}>
              <div className={styles.previewHeader}>
                <Clock size={14} />
                <span>Review Workflow</span>
              </div>
              <div className={styles.previewStages}>
                <span className={styles.previewStage}>Code Review</span>
                <ChevronRight size={12} />
                <span className={styles.previewStage}>Security</span>
                <ChevronRight size={12} />
                <span className={styles.previewStage}>Performance</span>
                <ChevronRight size={12} />
                <span className={styles.previewStage}>Verdict</span>
              </div>
            </div>
          )}

          <button
            className={styles.startButton}
            onClick={handleStartWorkflow}
            disabled={isStarting || !activeConversation || (isPrReviewContext && !prReviewData)}
          >
            {isStarting ? (
              <>
                <Clock size={18} className={styles.spinning} />
                Starting...
              </>
            ) : isPrReviewContext ? (
              <>
                <GitPullRequest size={18} />
                {prReviewData ? 'Start Multi-Agent Review' : 'Fetch Changes First'}
              </>
            ) : (
              <>
                <Play size={18} />
                Start Dev Team Workflow
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Active workflow - show progress and any pending checkpoints/questions
  return (
    <div className={styles.devTeamController}>
      {/* Workflow Progress */}
      <WorkflowProgress />

      {/* Pending Questions (from TPM or other agents) */}
      {hasActiveQuestions && <QuestionQueue />}

      {/* Pending Checkpoint */}
      {pendingCheckpoint && (
        <CheckpointCard
          checkpoint={pendingCheckpoint}
          onApprove={handleApproveCheckpoint}
          onReject={handleRejectCheckpoint}
        />
      )}
    </div>
  );
};

export default DevTeamController;
