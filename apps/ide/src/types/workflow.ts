/**
 * Multi-Agent Workflow Orchestration Types
 * 
 * Defines the structure for orchestrating multiple specialized agents
 * in a sequential or parallel development workflow.
 */

import type { 
  RequirementsDocument, 
  ArchitectureDocument, 
  TaskList,
  WorkflowContext 
} from './questions';

/**
 * Workflow stage names (simple strings for stage tracking)
 */
export type WorkflowStageName = string;

// ============================================================================
// Agent Definition Types
// ============================================================================

/**
 * Available agent types in the Dev Team workflow
 */
export type AgentType = 
  | 'tpm'
  | 'architect'
  | 'tdd-guide'
  | 'developer'
  | 'code-reviewer'
  | 'security-reviewer'
  | 'performance-optimizer'
  | 'verification';

/**
 * Agent execution status
 */
export type AgentStatus = 
  | 'idle'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Configuration for a single agent in the workflow
 */
export interface AgentConfig {
  /** Unique identifier for this agent */
  id: AgentType;
  
  /** Display name */
  name: string;
  
  /** Description of the agent's role */
  description: string;
  
  /** Path to the agent's prompt file */
  promptPath: string;
  
  /** What type of input this agent expects */
  inputType: HandoffDocumentType | 'user-request';
  
  /** What type of output this agent produces */
  outputType: HandoffDocumentType;
  
  /** Whether this agent requires user approval before proceeding */
  requiresCheckpoint: boolean;
  
  /** Agents that must complete before this one can start */
  dependencies: AgentType[];
  
  /** Whether this agent can be skipped */
  optional: boolean;
  
  /** Estimated complexity (for progress indication) */
  weight: number;
}

/**
 * Runtime state of an agent
 */
export interface AgentState {
  /** Agent configuration */
  config: AgentConfig;
  
  /** Current execution status */
  status: AgentStatus;
  
  /** Input document received from previous agent */
  input: HandoffDocument | null;
  
  /** Output document to pass to next agent */
  output: HandoffDocument | null;
  
  /** Error message if failed */
  error: string | null;
  
  /** Timestamp when agent started */
  startedAt: number | null;
  
  /** Timestamp when agent completed */
  completedAt: number | null;
  
  /** Messages exchanged during this agent's execution */
  messageIds: string[];
}

// ============================================================================
// Handoff Document Types
// ============================================================================

/**
 * Types of documents that can be passed between agents
 */
export type HandoffDocumentType = 
  | 'requirements'
  | 'architecture'
  | 'task-list'
  | 'code-review'
  | 'security-review'
  | 'performance-review'
  | 'verification-report';

/**
 * Base interface for all handoff documents
 */
export interface HandoffDocumentBase {
  /** Document type identifier */
  type: HandoffDocumentType;
  
  /** Version of this document (increments on updates) */
  version: number;
  
  /** Agent that created this document */
  createdBy: AgentType;
  
  /** Timestamp when created */
  createdAt: number;
  
  /** Summary for quick reference */
  summary: string;
  
  /** Risk level assessment */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Whether this document has been approved at a checkpoint */
  approved: boolean;
  
  /** Any blocking issues that must be resolved */
  blockingIssues: string[];
}

/**
 * Requirements Document - Output from TPM Agent
 */
export interface RequirementsHandoff extends HandoffDocumentBase {
  type: 'requirements';
  document: RequirementsDocument;
}

/**
 * Architecture Document - Output from Architect Agent
 */
export interface ArchitectureHandoff extends HandoffDocumentBase {
  type: 'architecture';
  document: ArchitectureDocument;
}

/**
 * Task List - Output from Planning/Architect Agent
 */
export interface TaskListHandoff extends HandoffDocumentBase {
  type: 'task-list';
  document: TaskList;
}

/**
 * Code Review Report - Output from Code Reviewer Agent
 */
export interface CodeReviewHandoff extends HandoffDocumentBase {
  type: 'code-review';
  document: CodeReviewReport;
}

/**
 * Security Review Report - Output from Security Reviewer Agent
 */
export interface SecurityReviewHandoff extends HandoffDocumentBase {
  type: 'security-review';
  document: SecurityReviewReport;
}

/**
 * Performance Review Report - Output from Performance Optimizer Agent
 */
export interface PerformanceReviewHandoff extends HandoffDocumentBase {
  type: 'performance-review';
  document: PerformanceReviewReport;
}

/**
 * Verification Report - Output from Verification Agent
 */
export interface VerificationHandoff extends HandoffDocumentBase {
  type: 'verification-report';
  document: VerificationReport;
}

/**
 * Union type of all handoff documents
 */
export type HandoffDocument = 
  | RequirementsHandoff
  | ArchitectureHandoff
  | TaskListHandoff
  | CodeReviewHandoff
  | SecurityReviewHandoff
  | PerformanceReviewHandoff
  | VerificationHandoff;

// ============================================================================
// Review Report Types
// ============================================================================

/**
 * Severity levels for review findings
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * A single finding from a review
 */
export interface ReviewFinding {
  /** Unique ID for this finding */
  id: string;
  
  /** Severity level */
  severity: FindingSeverity;
  
  /** Category of the finding */
  category: string;
  
  /** Short title/summary */
  title: string;
  
  /** Detailed description */
  description: string;
  
  /** File path (if applicable) */
  filePath?: string;
  
  /** Line number (if applicable) */
  lineNumber?: number;
  
  /** Suggested fix */
  suggestedFix?: string;
  
  /** Code snippet showing the issue */
  codeSnippet?: string;
}

/**
 * Code Review Report structure
 */
export interface CodeReviewReport {
  /** Files that were reviewed */
  filesReviewed: string[];
  
  /** All findings */
  findings: ReviewFinding[];
  
  /** Summary counts by severity */
  summaryCounts: Record<FindingSeverity, number>;
  
  /** Overall verdict */
  verdict: 'approve' | 'warning' | 'block';
  
  /** Recommendation text */
  recommendation: string;
}

/**
 * Security Review Report structure
 */
export interface SecurityReviewReport {
  /** Files that were reviewed */
  filesReviewed: string[];
  
  /** Security findings */
  findings: ReviewFinding[];
  
  /** OWASP categories checked */
  owaspChecked: string[];
  
  /** Secrets/credentials found (should always be empty in good code) */
  secretsFound: boolean;
  
  /** npm audit results */
  npmAuditStatus: 'clean' | 'warnings' | 'vulnerabilities';
  
  /** Summary counts by severity */
  summaryCounts: Record<FindingSeverity, number>;
  
  /** Overall verdict */
  verdict: 'pass' | 'warn' | 'fail';
  
  /** Required actions before merge */
  requiredActions: string[];
}

/**
 * Performance Review Report structure
 */
export interface PerformanceReviewReport {
  /** Bundle analysis results */
  bundleAnalysis: {
    totalSize: number;
    gzippedSize: number;
    targetSize: number;
    status: 'pass' | 'warning' | 'fail';
  };
  
  /** Web vitals measurements */
  webVitals: {
    lcp: { value: number; target: number; status: 'good' | 'needs-improvement' | 'poor' };
    fcp: { value: number; target: number; status: 'good' | 'needs-improvement' | 'poor' };
    cls: { value: number; target: number; status: 'good' | 'needs-improvement' | 'poor' };
    tti: { value: number; target: number; status: 'good' | 'needs-improvement' | 'poor' };
  };
  
  /** Performance findings */
  findings: ReviewFinding[];
  
  /** Algorithmic issues found */
  algorithmicIssues: {
    description: string;
    currentComplexity: string;
    suggestedComplexity: string;
    filePath: string;
  }[];
  
  /** Estimated improvements */
  estimatedImprovements: {
    bundleSizeReduction: string;
    lcpImprovement: string;
    memoryReduction: string;
  };
  
  /** Overall score (0-100) */
  overallScore: number;
  
  /** Verdict */
  verdict: 'pass' | 'needs-optimization';
}

/**
 * Verification Report structure
 */
export interface VerificationReport {
  /** Build verification */
  build: {
    status: 'pass' | 'fail';
    duration: number;
    errors: string[];
  };
  
  /** Type check verification */
  typeCheck: {
    status: 'pass' | 'fail';
    errorCount: number;
    errors: string[];
  };
  
  /** Lint verification */
  lint: {
    status: 'pass' | 'warning' | 'fail';
    errorCount: number;
    warningCount: number;
  };
  
  /** Test verification */
  tests: {
    status: 'pass' | 'fail';
    passed: number;
    failed: number;
    skipped: number;
    coverage: number;
    coverageTarget: number;
  };
  
  /** Security verification */
  security: {
    status: 'pass' | 'fail';
    criticalIssues: number;
    highIssues: number;
  };
  
  /** Acceptance criteria verification */
  acceptanceCriteria: {
    id: string;
    description: string;
    status: 'pass' | 'fail' | 'not-tested';
  }[];
  
  /** Overall verdict */
  verdict: 'pass' | 'needs-fixes' | 'fail';
  
  /** Blocking issues */
  blockingIssues: string[];
  
  /** Non-blocking issues */
  nonBlockingIssues: string[];
}

/**
 * Combined Review Report structure for PR Review workflow
 * Aggregates findings from Code, Security, and Performance reviewers
 */
export interface CombinedReviewReport {
  /** Source of the review */
  source: {
    type: 'pr' | 'commit' | 'local';
    prNumber?: number;
    prTitle?: string;
    commitHash?: string;
    commitMessage?: string;
    branch?: string;
    fileCount?: number;
  };
  
  /** Code review section */
  codeReview: {
    findings: ReviewFinding[];
    verdict: 'approve' | 'warning' | 'block';
    summary: string;
  };
  
  /** Security review section */
  securityReview: {
    findings: ReviewFinding[];
    verdict: 'pass' | 'warn' | 'fail';
    owaspChecked: string[];
    secretsFound: boolean;
    summary: string;
  };
  
  /** Performance review section (optional) */
  performanceReview?: {
    findings: ReviewFinding[];
    bundleImpact: 'none' | 'minor' | 'moderate' | 'major';
    complexityIssues: number;
    summary: string;
  };
  
  /** Aggregated summary counts by severity */
  totalCounts: Record<FindingSeverity, number>;
  
  /** Overall verdict for the entire review */
  overallVerdict: 'approve' | 'request-changes' | 'block';
  
  /** Risk assessment */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Executive summary */
  executiveSummary: string;
  
  /** Fix checklist - actionable items */
  fixChecklist: {
    id: string;
    severity: FindingSeverity;
    description: string;
    filePath?: string;
    lineNumber?: number;
    completed: boolean;
  }[];
  
  /** Timestamp of review */
  reviewedAt: number;
  
  /** Estimated effort to address all issues */
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
}

// ============================================================================
// Workflow Orchestration Types
// ============================================================================

/**
 * Checkpoint definition - a point where user approval is required
 */
export interface WorkflowCheckpoint {
  /** Checkpoint ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** After which agent this checkpoint occurs */
  afterAgent: AgentType;
  
  /** What document to present for review */
  documentType: HandoffDocumentType;
  
  /** Whether approval is required to proceed */
  required: boolean;
  
  /** Custom questions to ask at this checkpoint */
  questions?: {
    id: string;
    prompt: string;
    options: { id: string; label: string }[];
  }[];
}

/**
 * Checkpoint state
 */
export interface CheckpointState {
  /** Checkpoint definition */
  checkpoint: WorkflowCheckpoint;
  
  /** Current status */
  status: 'pending' | 'awaiting_approval' | 'approved' | 'rejected' | 'skipped';
  
  /** Document being reviewed */
  document: HandoffDocument | null;
  
  /** User's feedback/comments */
  feedback: string | null;
  
  /** User's answers to checkpoint questions */
  answers: Record<string, string>;
  
  /** Timestamp when checkpoint was reached */
  reachedAt: number | null;
  
  /** Timestamp when checkpoint was resolved */
  resolvedAt: number | null;
}

/**
 * Workflow template definition
 */
export interface WorkflowTemplate {
  /** Template ID */
  id: string;
  
  /** Template name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Workflow context this template is for */
  context: WorkflowContext;
  
  /** Ordered list of agents in this workflow */
  agents: AgentConfig[];
  
  /** Checkpoints in this workflow */
  checkpoints: WorkflowCheckpoint[];
  
  /** Default stage order (simple string names) */
  stages: WorkflowStageName[];
}

/**
 * Active workflow execution state
 */
export interface WorkflowExecution {
  /** Unique execution ID */
  id: string;
  
  /** Template being executed */
  templateId: string;
  
  /** User's original request */
  userRequest: string;
  
  /** Workflow context */
  context: WorkflowContext;
  
  /** Current stage name */
  currentStage: WorkflowStageName;
  
  /** Overall status */
  status: 'planning' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
  
  /** Agent states */
  agents: Record<AgentType, AgentState>;
  
  /** Checkpoint states */
  checkpoints: Record<string, CheckpointState>;
  
  /** All handoff documents produced */
  documents: HandoffDocument[];
  
  /** Conversation ID in AI store */
  conversationId: string;
  
  /** Timestamps */
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  
  /** Progress percentage (0-100) */
  progress: number;
  
  /** Files created/modified during workflow */
  affectedFiles: string[];
}

// ============================================================================
// Agent Orchestrator Actions
// ============================================================================

/**
 * Actions that can be performed on a workflow
 */
export type WorkflowAction =
  | { type: 'START_WORKFLOW'; templateId: string; userRequest: string; context: WorkflowContext }
  | { type: 'PAUSE_WORKFLOW' }
  | { type: 'RESUME_WORKFLOW' }
  | { type: 'CANCEL_WORKFLOW' }
  | { type: 'ADVANCE_STAGE' }
  | { type: 'RETRY_AGENT'; agentId: AgentType }
  | { type: 'SKIP_AGENT'; agentId: AgentType }
  | { type: 'APPROVE_CHECKPOINT'; checkpointId: string; feedback?: string }
  | { type: 'REJECT_CHECKPOINT'; checkpointId: string; feedback: string }
  | { type: 'UPDATE_DOCUMENT'; documentType: HandoffDocumentType; updates: Partial<HandoffDocument> };

/**
 * Events emitted by the workflow orchestrator
 */
export type WorkflowEvent =
  | { type: 'WORKFLOW_STARTED'; execution: WorkflowExecution }
  | { type: 'STAGE_CHANGED'; stage: WorkflowStageName; previousStage: WorkflowStageName }
  | { type: 'AGENT_STARTED'; agentId: AgentType }
  | { type: 'AGENT_COMPLETED'; agentId: AgentType; output: HandoffDocument }
  | { type: 'AGENT_FAILED'; agentId: AgentType; error: string }
  | { type: 'CHECKPOINT_REACHED'; checkpointId: string; document: HandoffDocument }
  | { type: 'CHECKPOINT_APPROVED'; checkpointId: string }
  | { type: 'CHECKPOINT_REJECTED'; checkpointId: string; feedback: string }
  | { type: 'WORKFLOW_COMPLETED'; execution: WorkflowExecution }
  | { type: 'WORKFLOW_FAILED'; error: string }
  | { type: 'WORKFLOW_CANCELLED' };

// ============================================================================
// Default Agent Configurations
// ============================================================================

/**
 * Default configuration for all agents
 */
export const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'tpm',
    name: 'TPM Agent',
    description: 'Technical Program Manager - Gathers requirements through structured questions',
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
    description: 'Designs system architecture and technical approach',
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
    description: 'Creates test specifications before implementation',
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
    description: 'Implements code following the architecture and tests',
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
    description: 'Reviews code quality and maintainability',
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
    description: 'Checks for security vulnerabilities',
    promptPath: 'config/prompts/agents/security-reviewer.md',
    inputType: 'code-review',
    outputType: 'security-review',
    requiresCheckpoint: false,
    dependencies: ['code-reviewer'],
    optional: true,
    weight: 5,
  },
  {
    id: 'performance-optimizer',
    name: 'Performance Optimizer Agent',
    description: 'Analyzes and optimizes performance',
    promptPath: 'config/prompts/agents/performance-optimizer.md',
    inputType: 'security-review',
    outputType: 'performance-review',
    requiresCheckpoint: false,
    dependencies: ['security-reviewer'],
    optional: true,
    weight: 5,
  },
  {
    id: 'verification',
    name: 'Verification Agent',
    description: 'Final verification gate - build, test, lint, security',
    promptPath: 'config/prompts/agents/verification.md',
    inputType: 'performance-review',
    outputType: 'verification-report',
    requiresCheckpoint: true,
    dependencies: ['performance-optimizer'],
    optional: false,
    weight: 5,
  },
];

/**
 * Default checkpoints for the workflow
 */
export const DEFAULT_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: 'requirements-review',
    name: 'Requirements Review',
    afterAgent: 'tpm',
    documentType: 'requirements',
    required: true,
    questions: [
      {
        id: 'requirements-complete',
        prompt: 'Are the requirements complete and accurate?',
        options: [
          { id: 'yes', label: 'Yes, proceed to architecture' },
          { id: 'needs-changes', label: 'No, I have changes' },
        ],
      },
    ],
  },
  {
    id: 'architecture-review',
    name: 'Architecture Review',
    afterAgent: 'architect',
    documentType: 'architecture',
    required: true,
    questions: [
      {
        id: 'architecture-approved',
        prompt: 'Do you approve this architecture?',
        options: [
          { id: 'yes', label: 'Yes, start implementation' },
          { id: 'needs-changes', label: 'No, needs changes' },
        ],
      },
    ],
  },
  {
    id: 'final-verification',
    name: 'Final Verification',
    afterAgent: 'verification',
    documentType: 'verification-report',
    required: true,
    questions: [
      {
        id: 'ready-to-merge',
        prompt: 'Is the code ready to merge?',
        options: [
          { id: 'yes', label: 'Yes, merge it' },
          { id: 'needs-fixes', label: 'No, needs fixes' },
        ],
      },
    ],
  },
];
