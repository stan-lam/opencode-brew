/**
 * Workflow Orchestrator Store
 * 
 * Manages the execution of multi-agent development workflows,
 * handling agent sequencing, checkpoints, and handoff documents.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AgentType,
  AgentState,
  AgentStatus,
  WorkflowExecution,
  WorkflowTemplate,
  WorkflowCheckpoint,
  CheckpointState,
  HandoffDocument,
  HandoffDocumentType,
  WorkflowAction,
  WorkflowEvent,
  DEFAULT_AGENT_CONFIGS,
  DEFAULT_CHECKPOINTS,
} from '../types/workflow';
import type { WorkflowContext } from '../types/questions';
import type { WorkflowStageName } from '../types/workflow';

// ============================================================================
// Store State Interface
// ============================================================================

interface WorkflowOrchestratorState {
  // Current execution
  currentExecution: WorkflowExecution | null;
  
  // Execution history
  executionHistory: WorkflowExecution[];
  
  // Available templates
  templates: WorkflowTemplate[];
  
  // Event listeners
  eventListeners: ((event: WorkflowEvent) => void)[];
  
  // Actions
  startWorkflow: (templateId: string, userRequest: string, context: WorkflowContext, conversationId: string) => void;
  pauseWorkflow: () => void;
  resumeWorkflow: () => void;
  cancelWorkflow: () => void;
  completeWorkflow: () => void;
  
  // Agent management
  startAgent: (agentId: AgentType) => void;
  completeAgent: (agentId: AgentType, output: HandoffDocument) => void;
  failAgent: (agentId: AgentType, error: string) => void;
  skipAgent: (agentId: AgentType) => void;
  retryAgent: (agentId: AgentType) => void;
  
  // Checkpoint management
  reachCheckpoint: (checkpointId: string, document: HandoffDocument) => void;
  approveCheckpoint: (checkpointId: string, feedback?: string, answers?: Record<string, string>) => void;
  rejectCheckpoint: (checkpointId: string, feedback: string) => void;
  
  // Document management
  addDocument: (document: HandoffDocument) => void;
  updateDocument: (type: HandoffDocumentType, updates: Partial<HandoffDocument>) => void;
  getDocument: (type: HandoffDocumentType) => HandoffDocument | null;
  getLatestDocument: () => HandoffDocument | null;
  
  // Stage management
  advanceStage: () => void;
  setStage: (stage: WorkflowStageName) => void;
  
  // Progress tracking
  updateProgress: () => void;
  addAffectedFile: (filePath: string) => void;
  
  // Event handling
  addEventListener: (listener: (event: WorkflowEvent) => void) => () => void;
  emitEvent: (event: WorkflowEvent) => void;
  
  // Queries
  getCurrentAgent: () => AgentState | null;
  getNextAgent: () => AgentType | null;
  getPendingCheckpoint: () => CheckpointState | null;
  isWorkflowActive: () => boolean;
  canProceed: () => boolean;
  
  // Persistence
  clearHistory: () => void;
  loadExecution: (executionId: string) => void;
}

// ============================================================================
// Default Templates
// ============================================================================

const DEFAULT_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'full-development',
    name: 'Full Development Workflow',
    description: 'Complete development lifecycle with all agents and checkpoints',
    context: 'new-feature',
    agents: [
      {
        id: 'tpm',
        name: 'TPM Agent',
        description: 'Gathers requirements through structured questions',
        promptPath: 'config/prompts/dev-team-mode.md',
        inputType: 'user-request',
        outputType: 'requirements',
        requiresCheckpoint: true,
        dependencies: [],
        optional: false,
        weight: 15,
      },
      {
        id: 'architect',
        name: 'Architect Agent',
        description: 'Designs system architecture',
        promptPath: 'config/prompts/agents/architect.md',
        inputType: 'requirements',
        outputType: 'architecture',
        requiresCheckpoint: true,
        dependencies: ['tpm'],
        optional: false,
        weight: 20,
      },
      {
        id: 'tdd-guide',
        name: 'TDD Guide Agent',
        description: 'Creates tests before implementation',
        promptPath: 'config/prompts/agents/tdd-guide.md',
        inputType: 'architecture',
        outputType: 'task-list',
        requiresCheckpoint: false,
        dependencies: ['architect'],
        optional: false,
        weight: 15,
      },
      {
        id: 'developer',
        name: 'Developer Agent',
        description: 'Implements the code',
        promptPath: 'config/prompts/agent-mode.md',
        inputType: 'task-list',
        outputType: 'task-list',
        requiresCheckpoint: false,
        dependencies: ['tdd-guide'],
        optional: false,
        weight: 25,
      },
      {
        id: 'code-reviewer',
        name: 'Code Reviewer Agent',
        description: 'Reviews code quality',
        promptPath: 'config/prompts/agents/code-reviewer.md',
        inputType: 'task-list',
        outputType: 'code-review',
        requiresCheckpoint: false,
        dependencies: ['developer'],
        optional: false,
        weight: 10,
      },
      {
        id: 'security-reviewer',
        name: 'Security Reviewer Agent',
        description: 'Checks for vulnerabilities',
        promptPath: 'config/prompts/agents/security-reviewer.md',
        inputType: 'code-review',
        outputType: 'security-review',
        requiresCheckpoint: false,
        dependencies: ['code-reviewer'],
        optional: true,
        weight: 5,
      },
      {
        id: 'verification',
        name: 'Verification Agent',
        description: 'Final verification',
        promptPath: 'config/prompts/agents/verification.md',
        inputType: 'security-review',
        outputType: 'verification-report',
        requiresCheckpoint: true,
        dependencies: ['security-reviewer'],
        optional: false,
        weight: 5,
      },
    ],
    checkpoints: [
      {
        id: 'requirements-review',
        name: 'Requirements Review',
        afterAgent: 'tpm',
        documentType: 'requirements',
        required: true,
      },
      {
        id: 'architecture-review',
        name: 'Architecture Review',
        afterAgent: 'architect',
        documentType: 'architecture',
        required: true,
      },
      {
        id: 'final-verification',
        name: 'Final Verification',
        afterAgent: 'verification',
        documentType: 'verification-report',
        required: true,
      },
    ],
    stages: [
      'requirements',
      'architecture',
      'planning',
      'development',
      'code-review',
      'security-review',
      'verification',
      'complete',
    ],
  },
  {
    id: 'quick-fix',
    name: 'Quick Bug Fix',
    description: 'Streamlined workflow for bug fixes',
    context: 'bug-fix',
    agents: [
      {
        id: 'tpm',
        name: 'TPM Agent',
        description: 'Gathers bug details',
        promptPath: 'config/prompts/dev-team-mode.md',
        inputType: 'user-request',
        outputType: 'requirements',
        requiresCheckpoint: false,
        dependencies: [],
        optional: false,
        weight: 20,
      },
      {
        id: 'developer',
        name: 'Developer Agent',
        description: 'Implements the fix',
        promptPath: 'config/prompts/agent-mode.md',
        inputType: 'requirements',
        outputType: 'task-list',
        requiresCheckpoint: false,
        dependencies: ['tpm'],
        optional: false,
        weight: 50,
      },
      {
        id: 'verification',
        name: 'Verification Agent',
        description: 'Verifies the fix',
        promptPath: 'config/prompts/agents/verification.md',
        inputType: 'task-list',
        outputType: 'verification-report',
        requiresCheckpoint: true,
        dependencies: ['developer'],
        optional: false,
        weight: 30,
      },
    ],
    checkpoints: [
      {
        id: 'final-verification',
        name: 'Final Verification',
        afterAgent: 'verification',
        documentType: 'verification-report',
        required: true,
      },
    ],
    stages: [
      'requirements',
      'development',
      'verification',
      'complete',
    ],
  },
  {
    id: 'pr-review',
    name: 'PR Review',
    description: 'Multi-agent review of pull requests, commits, or local changes',
    context: 'pr-review',
    agents: [
      {
        id: 'code-reviewer',
        name: 'Code Reviewer Agent',
        description: 'Reviews code quality, style, and maintainability',
        promptPath: 'config/prompts/agents/pr-code-reviewer.md',
        inputType: 'user-request',
        outputType: 'code-review',
        requiresCheckpoint: false,
        dependencies: [],
        optional: false,
        weight: 35,
      },
      {
        id: 'security-reviewer',
        name: 'Security Reviewer Agent',
        description: 'Checks for security vulnerabilities and OWASP Top 10',
        promptPath: 'config/prompts/agents/security-reviewer.md',
        inputType: 'code-review',
        outputType: 'security-review',
        requiresCheckpoint: false,
        dependencies: ['code-reviewer'],
        optional: false,
        weight: 30,
      },
      {
        id: 'performance-optimizer',
        name: 'Performance Optimizer Agent',
        description: 'Analyzes performance implications and optimization opportunities',
        promptPath: 'config/prompts/agents/performance-optimizer.md',
        inputType: 'security-review',
        outputType: 'performance-review',
        requiresCheckpoint: false,
        dependencies: ['security-reviewer'],
        optional: true,
        weight: 20,
      },
      {
        id: 'verification',
        name: 'Verification Agent',
        description: 'Generates combined review report with verdict',
        promptPath: 'config/prompts/agents/verification.md',
        inputType: 'performance-review',
        outputType: 'verification-report',
        requiresCheckpoint: true,
        dependencies: ['performance-optimizer'],
        optional: false,
        weight: 15,
      },
    ],
    checkpoints: [
      {
        id: 'review-verdict',
        name: 'Review Verdict',
        afterAgent: 'verification',
        documentType: 'verification-report',
        required: true,
      },
    ],
    stages: [
      'code-review',
      'security-review',
      'performance-review',
      'verification',
      'complete',
    ],
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function createInitialAgentStates(agents: WorkflowTemplate['agents']): Record<AgentType, AgentState> {
  const states: Partial<Record<AgentType, AgentState>> = {};
  
  for (const config of agents) {
    states[config.id] = {
      config,
      status: 'idle',
      input: null,
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
      messageIds: [],
    };
  }
  
  return states as Record<AgentType, AgentState>;
}

function createInitialCheckpointStates(checkpoints: WorkflowCheckpoint[]): Record<string, CheckpointState> {
  const states: Record<string, CheckpointState> = {};
  
  for (const checkpoint of checkpoints) {
    states[checkpoint.id] = {
      checkpoint,
      status: 'pending',
      document: null,
      feedback: null,
      answers: {},
      reachedAt: null,
      resolvedAt: null,
    };
  }
  
  return states;
}

function calculateProgress(agents: Record<AgentType, AgentState>): number {
  const agentList = Object.values(agents);
  if (agentList.length === 0) return 0;
  
  let totalWeight = 0;
  let completedWeight = 0;
  
  for (const agent of agentList) {
    totalWeight += agent.config.weight;
    if (agent.status === 'completed' || agent.status === 'skipped') {
      completedWeight += agent.config.weight;
    } else if (agent.status === 'running') {
      completedWeight += agent.config.weight * 0.5; // 50% for running
    }
  }
  
  return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useWorkflowOrchestratorStore = create<WorkflowOrchestratorState>()(
  persist(
    (set, get) => ({
      currentExecution: null,
      executionHistory: [],
      templates: DEFAULT_TEMPLATES,
      eventListeners: [],

      // Start a new workflow
      startWorkflow: (templateId, userRequest, context, conversationId) => {
        const template = get().templates.find(t => t.id === templateId);
        if (!template) {
          console.error(`Template not found: ${templateId}`);
          return;
        }

        const execution: WorkflowExecution = {
          id: `workflow-${Date.now()}`,
          templateId,
          userRequest,
          context,
          currentStage: template.stages[0],
          status: 'planning',
          agents: createInitialAgentStates(template.agents),
          checkpoints: createInitialCheckpointStates(template.checkpoints),
          documents: [],
          conversationId,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: null,
          progress: 0,
          affectedFiles: [],
        };

        set({ currentExecution: execution });
        get().emitEvent({ type: 'WORKFLOW_STARTED', execution });
        
        // Start the first agent after a small delay to allow React to re-render
        // This ensures the DevTeamController component has mounted and subscribed to events
        const firstAgent = template.agents[0];
        if (firstAgent) {
          setTimeout(() => {
            get().startAgent(firstAgent.id);
          }, 100);
        }
      },

      pauseWorkflow: () => {
        const execution = get().currentExecution;
        if (!execution) return;

        set({
          currentExecution: {
            ...execution,
            status: 'paused',
            updatedAt: Date.now(),
          },
        });
      },

      resumeWorkflow: () => {
        const execution = get().currentExecution;
        if (!execution || execution.status !== 'paused') return;

        set({
          currentExecution: {
            ...execution,
            status: 'in_progress',
            updatedAt: Date.now(),
          },
        });
      },

      cancelWorkflow: () => {
        const execution = get().currentExecution;
        if (!execution) return;

        const finalExecution: WorkflowExecution = {
          ...execution,
          status: 'cancelled',
          updatedAt: Date.now(),
          completedAt: Date.now(),
        };

        set(state => ({
          currentExecution: null,
          executionHistory: [...state.executionHistory, finalExecution],
        }));

        get().emitEvent({ type: 'WORKFLOW_CANCELLED' });
      },

      // Agent management
      startAgent: (agentId) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const agentState = execution.agents[agentId];
        if (!agentState) return;

        // Get input from previous agent
        const inputDoc = get().getLatestDocument();

        set({
          currentExecution: {
            ...execution,
            status: 'in_progress',
            agents: {
              ...execution.agents,
              [agentId]: {
                ...agentState,
                status: 'running',
                input: inputDoc,
                startedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'AGENT_STARTED', agentId });
      },

      completeAgent: (agentId, output) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const agentState = execution.agents[agentId];
        if (!agentState) return;

        // Add document
        get().addDocument(output);

        // Update agent state
        set({
          currentExecution: {
            ...get().currentExecution!,
            agents: {
              ...get().currentExecution!.agents,
              [agentId]: {
                ...agentState,
                status: 'completed',
                output,
                completedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().updateProgress();
        get().emitEvent({ type: 'AGENT_COMPLETED', agentId, output });

        // Check for checkpoint
        const template = get().templates.find(t => t.id === execution.templateId);
        const checkpoint = template?.checkpoints.find(c => c.afterAgent === agentId);
        
        if (checkpoint) {
          get().reachCheckpoint(checkpoint.id, output);
        } else {
          // Auto-advance to next agent
          const nextAgent = get().getNextAgent();
          if (nextAgent) {
            get().startAgent(nextAgent);
          } else {
            // Workflow complete
            get().completeWorkflow();
          }
        }
      },

      failAgent: (agentId, error) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const agentState = execution.agents[agentId];
        if (!agentState) return;

        set({
          currentExecution: {
            ...execution,
            status: 'failed',
            agents: {
              ...execution.agents,
              [agentId]: {
                ...agentState,
                status: 'failed',
                error,
                completedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'AGENT_FAILED', agentId, error });
      },

      skipAgent: (agentId) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const agentState = execution.agents[agentId];
        if (!agentState || !agentState.config.optional) return;

        set({
          currentExecution: {
            ...execution,
            agents: {
              ...execution.agents,
              [agentId]: {
                ...agentState,
                status: 'skipped',
                completedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().updateProgress();
        
        // Move to next agent
        const nextAgent = get().getNextAgent();
        if (nextAgent) {
          get().startAgent(nextAgent);
        }
      },

      retryAgent: (agentId) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const agentState = execution.agents[agentId];
        if (!agentState) return;

        set({
          currentExecution: {
            ...execution,
            status: 'in_progress',
            agents: {
              ...execution.agents,
              [agentId]: {
                ...agentState,
                status: 'idle',
                error: null,
                startedAt: null,
                completedAt: null,
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().startAgent(agentId);
      },

      // Checkpoint management
      reachCheckpoint: (checkpointId, document) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const checkpointState = execution.checkpoints[checkpointId];
        if (!checkpointState) return;

        set({
          currentExecution: {
            ...execution,
            status: 'paused',
            checkpoints: {
              ...execution.checkpoints,
              [checkpointId]: {
                ...checkpointState,
                status: 'awaiting_approval',
                document,
                reachedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'CHECKPOINT_REACHED', checkpointId, document });
      },

      approveCheckpoint: (checkpointId, feedback, answers) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const checkpointState = execution.checkpoints[checkpointId];
        if (!checkpointState) return;

        set({
          currentExecution: {
            ...execution,
            status: 'in_progress',
            checkpoints: {
              ...execution.checkpoints,
              [checkpointId]: {
                ...checkpointState,
                status: 'approved',
                feedback: feedback || null,
                answers: answers || {},
                resolvedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'CHECKPOINT_APPROVED', checkpointId });

        // Advance to next agent
        const nextAgent = get().getNextAgent();
        if (nextAgent) {
          get().startAgent(nextAgent);
        } else {
          get().completeWorkflow();
        }
      },

      rejectCheckpoint: (checkpointId, feedback) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const checkpointState = execution.checkpoints[checkpointId];
        if (!checkpointState) return;

        set({
          currentExecution: {
            ...execution,
            checkpoints: {
              ...execution.checkpoints,
              [checkpointId]: {
                ...checkpointState,
                status: 'rejected',
                feedback,
                resolvedAt: Date.now(),
              },
            },
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'CHECKPOINT_REJECTED', checkpointId, feedback });

        // Retry the agent that produced this checkpoint
        const checkpoint = checkpointState.checkpoint;
        get().retryAgent(checkpoint.afterAgent);
      },

      // Document management
      addDocument: (document) => {
        const execution = get().currentExecution;
        if (!execution) return;

        set({
          currentExecution: {
            ...execution,
            documents: [...execution.documents, document],
            updatedAt: Date.now(),
          },
        });
      },

      updateDocument: (type, updates) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const docIndex = execution.documents.findIndex(d => d.type === type);
        if (docIndex === -1) return;

        const updatedDocs = [...execution.documents];
        updatedDocs[docIndex] = {
          ...updatedDocs[docIndex],
          ...updates,
          version: updatedDocs[docIndex].version + 1,
        } as HandoffDocument;

        set({
          currentExecution: {
            ...execution,
            documents: updatedDocs,
            updatedAt: Date.now(),
          },
        });
      },

      getDocument: (type) => {
        const execution = get().currentExecution;
        if (!execution) return null;

        return execution.documents.find(d => d.type === type) || null;
      },

      getLatestDocument: () => {
        const execution = get().currentExecution;
        if (!execution || execution.documents.length === 0) return null;

        return execution.documents[execution.documents.length - 1];
      },

      // Stage management
      advanceStage: () => {
        const execution = get().currentExecution;
        if (!execution) return;

        const template = get().templates.find(t => t.id === execution.templateId);
        if (!template) return;

        const currentIndex = template.stages.indexOf(execution.currentStage);
        if (currentIndex === -1 || currentIndex >= template.stages.length - 1) return;

        const nextStage = template.stages[currentIndex + 1];
        const previousStage = execution.currentStage;

        set({
          currentExecution: {
            ...execution,
            currentStage: nextStage,
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'STAGE_CHANGED', stage: nextStage, previousStage });
      },

      setStage: (stage) => {
        const execution = get().currentExecution;
        if (!execution) return;

        const previousStage = execution.currentStage;

        set({
          currentExecution: {
            ...execution,
            currentStage: stage,
            updatedAt: Date.now(),
          },
        });

        get().emitEvent({ type: 'STAGE_CHANGED', stage, previousStage });
      },

      // Progress tracking
      updateProgress: () => {
        const execution = get().currentExecution;
        if (!execution) return;

        const progress = calculateProgress(execution.agents);

        set({
          currentExecution: {
            ...execution,
            progress,
            updatedAt: Date.now(),
          },
        });
      },

      addAffectedFile: (filePath) => {
        const execution = get().currentExecution;
        if (!execution) return;

        if (!execution.affectedFiles.includes(filePath)) {
          set({
            currentExecution: {
              ...execution,
              affectedFiles: [...execution.affectedFiles, filePath],
              updatedAt: Date.now(),
            },
          });
        }
      },

      // Event handling
      addEventListener: (listener) => {
        set(state => ({
          eventListeners: [...state.eventListeners, listener],
        }));

        return () => {
          set(state => ({
            eventListeners: state.eventListeners.filter(l => l !== listener),
          }));
        };
      },

      emitEvent: (event) => {
        const listeners = get().eventListeners;
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            console.error('Error in workflow event listener:', error);
          }
        }
      },

      // Queries
      getCurrentAgent: () => {
        const execution = get().currentExecution;
        if (!execution) return null;

        const runningAgent = Object.values(execution.agents).find(a => a.status === 'running');
        return runningAgent || null;
      },

      getNextAgent: () => {
        const execution = get().currentExecution;
        if (!execution) return null;

        const template = get().templates.find(t => t.id === execution.templateId);
        if (!template) return null;

        // Find the first agent that hasn't been completed/skipped and has all dependencies met
        for (const agentConfig of template.agents) {
          const agentState = execution.agents[agentConfig.id];
          if (!agentState) continue;

          // Skip if already completed or running
          if (agentState.status === 'completed' || agentState.status === 'skipped' || agentState.status === 'running') {
            continue;
          }

          // Check dependencies
          const dependenciesMet = agentConfig.dependencies.every(depId => {
            const depState = execution.agents[depId];
            return depState && (depState.status === 'completed' || depState.status === 'skipped');
          });

          if (dependenciesMet) {
            return agentConfig.id;
          }
        }

        return null;
      },

      getPendingCheckpoint: () => {
        const execution = get().currentExecution;
        if (!execution) return null;

        const pending = Object.values(execution.checkpoints).find(
          c => c.status === 'awaiting_approval'
        );
        return pending || null;
      },

      isWorkflowActive: () => {
        const execution = get().currentExecution;
        return execution !== null && 
          (execution.status === 'planning' || execution.status === 'in_progress' || execution.status === 'paused');
      },

      canProceed: () => {
        const execution = get().currentExecution;
        if (!execution) return false;

        // Check if waiting for checkpoint approval
        const pendingCheckpoint = get().getPendingCheckpoint();
        if (pendingCheckpoint) return false;

        return execution.status === 'in_progress';
      },

      // Internal helper
      completeWorkflow: () => {
        const execution = get().currentExecution;
        if (!execution) return;

        const finalExecution: WorkflowExecution = {
          ...execution,
          status: 'completed',
          currentStage: 'complete',
          progress: 100,
          updatedAt: Date.now(),
          completedAt: Date.now(),
        };

        set(state => ({
          currentExecution: null,
          executionHistory: [...state.executionHistory, finalExecution],
        }));

        get().emitEvent({ type: 'WORKFLOW_COMPLETED', execution: finalExecution });
      },

      // Persistence
      clearHistory: () => {
        set({ executionHistory: [] });
      },

      loadExecution: (executionId) => {
        const execution = get().executionHistory.find(e => e.id === executionId);
        if (execution) {
          set({ currentExecution: { ...execution, status: 'paused' } });
        }
      },
    }),
    {
      name: 'opencodebrew-workflow-orchestrator',
      partialize: (state) => ({
        executionHistory: state.executionHistory.slice(-10), // Keep last 10 executions
        // NOTE: Don't persist templates - always use latest code defaults
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<WorkflowOrchestratorState>;
        return {
          ...currentState,
          executionHistory: persisted?.executionHistory ?? [],
          // Always use DEFAULT_TEMPLATES from code, not persisted templates
          templates: DEFAULT_TEMPLATES,
        };
      },
    }
  )
);

// Export types for use in components
export type { WorkflowOrchestratorState };
