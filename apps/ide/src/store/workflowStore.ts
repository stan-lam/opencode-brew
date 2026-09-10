import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DevTeamWorkflow,
  DevTeamStage,
  WorkflowContext,
  RequirementsDocument,
  ArchitectureDocument,
  TaskList,
} from '../types/questions';

// Default stages for the Dev Team workflow
const DEFAULT_STAGES: Omit<DevTeamStage, 'id'>[] = [
  { name: 'Requirements', agent: 'tpm-agent', status: 'pending', blocking: true },
  { name: 'Architecture', agent: 'architect', status: 'pending', blocking: true },
  { name: 'Planning', agent: 'planner', status: 'pending', blocking: false },
  { name: 'Development', agent: 'developer', status: 'pending', blocking: false },
  { name: 'Code Review', agent: 'code-reviewer', status: 'pending', blocking: false },
  { name: 'Security Review', agent: 'security-reviewer', status: 'pending', blocking: false },
  { name: 'Performance', agent: 'performance-optimizer', status: 'pending', blocking: false },
  { name: 'Verification', agent: 'verification', status: 'pending', blocking: true },
  { name: 'QA', agent: 'qa', status: 'pending', blocking: true },
];

// Simplified stages for bug fix context
const BUG_FIX_STAGES: Omit<DevTeamStage, 'id'>[] = [
  { name: 'Requirements', agent: 'tpm-agent', status: 'pending', blocking: true },
  { name: 'Analysis', agent: 'planner', status: 'pending', blocking: false },
  { name: 'Fix', agent: 'developer', status: 'pending', blocking: false },
  { name: 'Code Review', agent: 'code-reviewer', status: 'pending', blocking: false },
  { name: 'Verification', agent: 'verification', status: 'pending', blocking: true },
];

// Stages for refactoring
const REFACTOR_STAGES: Omit<DevTeamStage, 'id'>[] = [
  { name: 'Requirements', agent: 'tpm-agent', status: 'pending', blocking: true },
  { name: 'Architecture Review', agent: 'architect', status: 'pending', blocking: true },
  { name: 'Planning', agent: 'planner', status: 'pending', blocking: false },
  { name: 'Refactoring', agent: 'developer', status: 'pending', blocking: false },
  { name: 'Code Review', agent: 'code-reviewer', status: 'pending', blocking: false },
  { name: 'Performance', agent: 'performance-optimizer', status: 'pending', blocking: false },
  { name: 'Verification', agent: 'verification', status: 'pending', blocking: true },
];

function getStagesForContext(context: WorkflowContext): DevTeamStage[] {
  let stageTemplates: Omit<DevTeamStage, 'id'>[];
  
  switch (context) {
    case 'bug-fix':
      stageTemplates = BUG_FIX_STAGES;
      break;
    case 'refactor':
      stageTemplates = REFACTOR_STAGES;
      break;
    case 'new-project':
    case 'new-feature':
    default:
      stageTemplates = DEFAULT_STAGES;
  }
  
  return stageTemplates.map((stage, index) => ({
    ...stage,
    id: `stage-${index}-${Date.now()}`,
  }));
}

interface WorkflowStoreState {
  // Current active workflow
  activeWorkflow: DevTeamWorkflow | null;
  
  // History of completed workflows
  workflowHistory: DevTeamWorkflow[];
  
  // Actions
  startWorkflow: (context: WorkflowContext, title: string) => void;
  advanceStage: () => void;
  completeCurrentStage: (output?: string) => void;
  failCurrentStage: (error: string) => void;
  skipCurrentStage: () => void;
  pauseWorkflow: () => void;
  resumeWorkflow: () => void;
  cancelWorkflow: () => void;
  
  // Update workflow data
  setRequirements: (requirements: RequirementsDocument) => void;
  setArchitecture: (architecture: ArchitectureDocument) => void;
  setTasks: (tasks: TaskList) => void;
  
  // Computed
  getCurrentStage: () => DevTeamStage | null;
  getProgress: () => { completed: number; total: number; percentage: number };
  isAtCheckpoint: () => boolean;
}

export const useWorkflowStore = create<WorkflowStoreState>()(
  persist(
    (set, get) => ({
      activeWorkflow: null,
      workflowHistory: [],

      startWorkflow: (context: WorkflowContext, title: string) => {
        const stages = getStagesForContext(context);
        
        const workflow: DevTeamWorkflow = {
          id: `workflow-${Date.now()}`,
          context,
          title,
          stages,
          currentStageIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
        };
        
        // Start the first stage
        workflow.stages[0].status = 'in-progress';
        workflow.stages[0].startedAt = new Date().toISOString();
        
        set({ activeWorkflow: workflow });
      },

      advanceStage: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        const nextIndex = activeWorkflow.currentStageIndex + 1;
        
        if (nextIndex >= activeWorkflow.stages.length) {
          // Workflow complete
          set({
            activeWorkflow: {
              ...activeWorkflow,
              status: 'completed',
              updatedAt: new Date().toISOString(),
            },
          });
          return;
        }
        
        // Update stages
        const updatedStages = [...activeWorkflow.stages];
        updatedStages[nextIndex] = {
          ...updatedStages[nextIndex],
          status: 'in-progress',
          startedAt: new Date().toISOString(),
        };
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            stages: updatedStages,
            currentStageIndex: nextIndex,
            updatedAt: new Date().toISOString(),
          },
        });
      },

      completeCurrentStage: (output?: string) => {
        const { activeWorkflow, advanceStage } = get();
        if (!activeWorkflow) return;
        
        const currentIndex = activeWorkflow.currentStageIndex;
        const updatedStages = [...activeWorkflow.stages];
        
        updatedStages[currentIndex] = {
          ...updatedStages[currentIndex],
          status: 'completed',
          completedAt: new Date().toISOString(),
          output,
        };
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            stages: updatedStages,
            updatedAt: new Date().toISOString(),
          },
        });
        
        // Auto-advance if not at a checkpoint
        if (!updatedStages[currentIndex].blocking) {
          advanceStage();
        }
      },

      failCurrentStage: (error: string) => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        const currentIndex = activeWorkflow.currentStageIndex;
        const updatedStages = [...activeWorkflow.stages];
        
        updatedStages[currentIndex] = {
          ...updatedStages[currentIndex],
          status: 'failed',
          completedAt: new Date().toISOString(),
          error,
        };
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            stages: updatedStages,
            status: 'paused',
            updatedAt: new Date().toISOString(),
          },
        });
      },

      skipCurrentStage: () => {
        const { activeWorkflow, advanceStage } = get();
        if (!activeWorkflow) return;
        
        const currentIndex = activeWorkflow.currentStageIndex;
        const updatedStages = [...activeWorkflow.stages];
        
        updatedStages[currentIndex] = {
          ...updatedStages[currentIndex],
          status: 'skipped',
          completedAt: new Date().toISOString(),
        };
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            stages: updatedStages,
            updatedAt: new Date().toISOString(),
          },
        });
        
        advanceStage();
      },

      pauseWorkflow: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            status: 'paused',
            updatedAt: new Date().toISOString(),
          },
        });
      },

      resumeWorkflow: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow || activeWorkflow.status !== 'paused') return;
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            status: 'active',
            updatedAt: new Date().toISOString(),
          },
        });
      },

      cancelWorkflow: () => {
        const { activeWorkflow, workflowHistory } = get();
        if (!activeWorkflow) return;
        
        const cancelledWorkflow = {
          ...activeWorkflow,
          status: 'cancelled' as const,
          updatedAt: new Date().toISOString(),
        };
        
        set({
          activeWorkflow: null,
          workflowHistory: [...workflowHistory, cancelledWorkflow],
        });
      },

      setRequirements: (requirements: RequirementsDocument) => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            requirements,
            updatedAt: new Date().toISOString(),
          },
        });
      },

      setArchitecture: (architecture: ArchitectureDocument) => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            architecture,
            updatedAt: new Date().toISOString(),
          },
        });
      },

      setTasks: (tasks: TaskList) => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return;
        
        set({
          activeWorkflow: {
            ...activeWorkflow,
            tasks,
            updatedAt: new Date().toISOString(),
          },
        });
      },

      getCurrentStage: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return null;
        
        return activeWorkflow.stages[activeWorkflow.currentStageIndex] || null;
      },

      getProgress: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return { completed: 0, total: 0, percentage: 0 };
        
        const completed = activeWorkflow.stages.filter(
          s => s.status === 'completed' || s.status === 'skipped'
        ).length;
        const total = activeWorkflow.stages.length;
        const percentage = Math.round((completed / total) * 100);
        
        return { completed, total, percentage };
      },

      isAtCheckpoint: () => {
        const { activeWorkflow } = get();
        if (!activeWorkflow) return false;
        
        const currentStage = activeWorkflow.stages[activeWorkflow.currentStageIndex];
        return currentStage?.blocking && currentStage?.status === 'completed';
      },
    }),
    {
      name: 'opencodebrew-workflow-store',
      partialize: (state) => ({
        workflowHistory: state.workflowHistory.slice(-10), // Keep last 10 workflows
      }),
    }
  )
);

// Helper to get context-specific initial prompt for TPM agent
export function getTPMPromptForContext(context: WorkflowContext): string {
  switch (context) {
    case 'new-project':
      return `You are starting a NEW PROJECT. Begin by asking about:
1. Project type (web app, API, CLI, library, mobile)
2. Tech stack preferences
3. Key features for MVP
4. Any constraints or requirements`;
      
    case 'new-feature':
      return `You are adding a NEW FEATURE to an existing codebase. Begin by:
1. Reading relevant existing code to understand patterns
2. Asking about scope (MVP vs full feature)
3. Asking about integration points
4. Identifying potential impacts on existing code`;
      
    case 'bug-fix':
      return `You are investigating a BUG. Begin by asking about:
1. How to reproduce the bug
2. Expected vs actual behavior
3. When the bug started occurring
4. Any recent changes that might be related`;
      
    case 'refactor':
      return `You are planning a REFACTOR. Begin by asking about:
1. What code needs to be refactored
2. Goals of the refactor (performance, maintainability, etc.)
3. Scope boundaries (what should NOT change)
4. Acceptable breaking changes`;
      
    default:
      return '';
  }
}
