import { create } from 'zustand';

export interface TriggerType {
  type: 'cron' | 'file_watch' | 'webhook' | 'manual';
  expression?: string;
  path?: string;
  events?: string[];
}

export interface ActionType {
  type: 'cli' | 'api' | 'mcp' | 'ai_prompt' | 'save_file';
  command?: string;
  args?: string[];
  cwd?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  server_id?: string;
  tool_name?: string;
  arguments?: Record<string, any>;
  prompt?: string;
  model?: string;
  system_prompt?: string;
  // save_file specific
  path?: string;
  content?: string;
  append?: boolean;
}

export interface Action {
  id: string;
  name: string;
  action_type: ActionType;
  order: number;
  timeout_seconds?: number;
  on_error: 'stop' | 'continue' | 'retry';
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  trigger: TriggerType;
  actions: Action[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExecutionLog {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  trigger_type: string;
  output?: string;
  error?: string;
}

export interface ActionLog {
  id: string;
  execution_id: string;
  action_id: string;
  action_name: string;
  started_at: string;
  finished_at?: string;
  status: string;
  output?: string;
  error?: string;
}

interface AssistantState {
  agents: Agent[];
  executions: ExecutionLog[];
  selectedAgentId: string | null;
  selectedExecutionId: string | null;
  isCreating: boolean;
  isEditing: boolean;
  view: 'agents' | 'history';

  setAgents: (agents: Agent[]) => void;
  setExecutions: (executions: ExecutionLog[]) => void;
  selectAgent: (id: string | null) => void;
  selectExecution: (id: string | null) => void;
  setIsCreating: (creating: boolean) => void;
  setIsEditing: (editing: boolean) => void;
  setView: (view: 'agents' | 'history') => void;
  
  addAgent: (agent: Agent) => void;
  updateAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  addExecution: (execution: ExecutionLog) => void;

  getSelectedAgent: () => Agent | undefined;
  getSelectedExecution: () => ExecutionLog | undefined;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  agents: [],
  executions: [],
  selectedAgentId: null,
  selectedExecutionId: null,
  isCreating: false,
  isEditing: false,
  view: 'agents',

  setAgents: (agents) => set({ agents }),
  setExecutions: (executions) => set({ executions }),
  selectAgent: (id) => set({ selectedAgentId: id, isEditing: false }),
  selectExecution: (id) => set({ selectedExecutionId: id }),
  setIsCreating: (creating) => set({ isCreating: creating, selectedAgentId: null }),
  setIsEditing: (editing) => set({ isEditing: editing }),
  setView: (view) => set({ view }),

  addAgent: (agent) => set((state) => ({
    agents: [...state.agents, agent],
  })),

  updateAgent: (agent) => set((state) => ({
    agents: state.agents.map((a) => a.id === agent.id ? agent : a),
  })),

  removeAgent: (id) => set((state) => ({
    agents: state.agents.filter((a) => a.id !== id),
    selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
  })),

  addExecution: (execution) => set((state) => ({
    executions: [execution, ...state.executions],
  })),

  getSelectedAgent: () => {
    const { agents, selectedAgentId } = get();
    return agents.find((a) => a.id === selectedAgentId);
  },

  getSelectedExecution: () => {
    const { executions, selectedExecutionId } = get();
    return executions.find((e) => e.id === selectedExecutionId);
  },
}));
