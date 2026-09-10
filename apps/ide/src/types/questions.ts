/**
 * Types for the Cursor-like AskQuestion system
 * Enables agents to ask structured questions and block until user responds
 */

// Question option that users can select
export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  icon?: string;
}

// Question categories for organizing and styling
export type QuestionCategory = 
  | 'scope'      // In/out of scope, MVP vs full
  | 'technical'  // Framework, architecture, patterns
  | 'business'   // Priority, timeline, constraints
  | 'risk'       // Security, data, external APIs
  | 'priority'   // Feature ordering
  | 'project-setup'; // New project configuration

// A single structured question
export interface StructuredQuestion {
  id: string;
  title?: string;
  prompt: string;
  options: QuestionOption[];
  allowMultiple?: boolean;  // Allow selecting multiple options
  allowCustom?: boolean;    // Allow free-text "Other" option
  required?: boolean;       // Must be answered to proceed
  category?: QuestionCategory;
  defaultValue?: string | string[];
}

// Batch of questions to ask together
export interface QuestionBatch {
  id: string;
  questions: StructuredQuestion[];
  blocking: boolean;        // If true, agent waits for all answers
  category?: QuestionCategory;
  title?: string;
  description?: string;
}

// User's answer to a question
export interface QuestionAnswer {
  questionId: string;
  value: string | string[];
  customValue?: string;     // If user selected "Other" with custom input
  answeredAt: string;
}

// State of the question queue
export interface QuestionQueueState {
  currentBatch: QuestionBatch | null;
  answers: Record<string, QuestionAnswer>;
  isBlocking: boolean;
  pendingBatches: QuestionBatch[];
  completedBatches: string[];
}

// Workflow context types for Dev Team mode
export type WorkflowContext = 
  | 'new-project'   // Creating a new project from scratch
  | 'new-feature'   // Adding a feature to existing codebase
  | 'bug-fix'       // Fixing a bug or issue
  | 'refactor'      // Improving existing code
  | 'pr-review';    // Review existing PR/commit/changes

// Dev Team workflow stage
export interface DevTeamStage {
  id: string;
  name: string;
  agent: string;  // Agent ID to use for this stage
  status: 'pending' | 'in-progress' | 'completed' | 'skipped' | 'failed';
  blocking: boolean;  // Requires user checkpoint
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

// Full Dev Team workflow state
export interface DevTeamWorkflow {
  id: string;
  context: WorkflowContext;
  title: string;
  stages: DevTeamStage[];
  currentStageIndex: number;
  requirements?: RequirementsDocument;
  architecture?: ArchitectureDocument;
  tasks?: TaskList;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
}

// Requirements document produced by TPM agent
export interface RequirementsDocument {
  goal: string;
  inScope: string[];
  outOfScope: string[];
  userAnswers: Record<string, string | string[]>;
  acceptanceCriteria: AcceptanceCriterion[];
  risks: Risk[];
  assumptions: string[];
  handoff: {
    readyFor: string;
    riskLevel: 'low' | 'medium' | 'high';
    notes?: string;
  };
}

// Single acceptance criterion
export interface AcceptanceCriterion {
  id: string;  // AC-001, AC-002, etc.
  title: string;
  scenario: string;
  action: string;
  expected: string;
  mustNot?: string;
  verification: string;
  priority: 'required' | 'important' | 'optional';
}

// Risk identified during requirements gathering
export interface Risk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
}

// Architecture document produced by Architect agent
export interface ArchitectureDocument {
  summary: string;
  decisions: ArchitectureDecision[];
  components: Component[];
  dataFlow?: string;  // Mermaid diagram
  apiContracts?: ApiContract[];
}

// Architecture Decision Record (ADR)
export interface ArchitectureDecision {
  id: string;  // ADR-001, etc.
  title: string;
  context: string;
  decision: string;
  consequences: {
    positive: string[];
    negative: string[];
  };
  alternatives: string[];
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
}

// System component
export interface Component {
  name: string;
  description: string;
  responsibilities: string[];
  dependencies: string[];
  technology?: string;
}

// API contract
export interface ApiContract {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  description: string;
  requestSchema?: string;
  responseSchema?: string;
}

// Task list produced by Planner agent
export interface TaskList {
  phases: TaskPhase[];
  totalTasks: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

// Phase of tasks
export interface TaskPhase {
  id: string;
  name: string;
  description: string;
  tasks: Task[];
  order: number;
}

// Individual task
export interface Task {
  id: string;
  title: string;
  description: string;
  filePath?: string;
  dependencies: string[];  // Task IDs this depends on
  complexity: 'low' | 'medium' | 'high';
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  assignedTo?: string;  // Agent ID
}

// Parsed question from XML in agent response
export interface ParsedQuestionBatch {
  questions: StructuredQuestion[];
  blocking: boolean;
  category?: QuestionCategory;
}
