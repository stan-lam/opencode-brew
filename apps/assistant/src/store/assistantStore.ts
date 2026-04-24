import { create } from 'zustand';

export interface TriggerType {
  type: 'cron' | 'file_watch' | 'webhook' | 'manual';
  expression?: string;
  path?: string;
  events?: string[];
}

export interface ModelSettings {
  provider: 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  ollamaUrl?: string;
  openaiKey?: string;
  anthropicKey?: string;
  customBaseUrl?: string;
  customApiKey?: string;
}

export interface ApiCallConfig {
  type: 'api';
  // basic info
  method: string;
  url: string;
  // auth
  auth_type: 'none' | 'basic' | 'bearer' | 'api_key';
  auth_username?: string;
  auth_password?: string;
  auth_bearer_token?: string;
  auth_api_key_name?: string;
  auth_api_key_value?: string;
  // content type
  content_type?: string;
  // body type
  body_type?: 'raw' | 'json' | 'form_data';
  // query params
  query_params?: Record<string, string>;
  // network
  follow_redirects?: boolean;
  timeout_seconds?: number;
}

export interface ActionType {
  type: 'cli' | 'api' | 'mcp' | 'ai_prompt' | 'save_file' | 'send_email' | 'send_slack' | 'send_discord';
  // cli
  command?: string;
  args?: string[];
  cwd?: string;
  // api
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  auth_type?: 'none' | 'basic' | 'bearer' | 'api_key';
  auth_username?: string;
  auth_password?: string;
  auth_bearer_token?: string;
  auth_api_key_name?: string;
  auth_api_key_value?: string;
  content_type?: string;
  body_type?: 'raw' | 'json' | 'form_data';
  query_params?: Record<string, string>;
  follow_redirects?: boolean;
  timeout_seconds?: number;
  // mcp
  server_id?: string;
  tool_name?: string;
  arguments?: Record<string, any>;
  // ai_prompt
  prompt?: string;
  system_prompt?: string;
  model_settings?: ModelSettings;
  // save_file
  path?: string;
  content?: string;
  append?: boolean;
  // send_email
  body?: string;
  from?: string;
  to?: string;
  subject?: string;
  smtp_host?: string;
  smtp_port?: number;
  use_tls?: boolean;
  password?: string;
  // send_slack
  webhook_url?: string;
  channel?: string;
  message?: string;
  username?: string;
  // send_discord
  username?: string;
  content?: string;
  avatar_url?: string;
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
