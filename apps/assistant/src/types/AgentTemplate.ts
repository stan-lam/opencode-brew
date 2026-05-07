import { Agent, TriggerType, WorkflowStage, Action, ActionType, CombineStrategy } from '../store/assistantStore';

export type TemplateCategory = 'travel' | 'finance' | 'productivity' | 'monitoring' | 'custom';

export type TemplateInputType = 'text' | 'date' | 'datetime' | 'select' | 'multiselect' | 'number' | 'textarea' | 'checkbox' | 'range' | 'filepath';

export interface TemplateInputOption {
  value: string;
  label: string;
  icon?: string;
}

export interface DependsOnCondition {
  field: string;
  value?: any;
  notValue?: any;
  operator?: 'equals' | 'notEquals' | 'greaterThan' | 'includes';
}

export interface TemplateInput {
  id: string;
  label: string;
  type: TemplateInputType;
  required: boolean;
  options?: TemplateInputOption[];
  placeholder?: string;
  defaultValue?: any;
  group?: string;
  helpText?: string;
  min?: number;
  max?: number;
  step?: number;
  dependsOn?: DependsOnCondition | DependsOnCondition[];
  fileFilters?: { name: string; extensions: string[] }[];
  fileDialogTitle?: string;
}

export interface TemplateInputGroup {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  inputs: TemplateInput[];
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  icon: string;
  category: TemplateCategory;
  tags?: string[];
  inputGroups: TemplateInputGroup[];
  generateAgent: (config: Record<string, any>) => Omit<Agent, 'id' | 'created_at' | 'updated_at'>;
  previewDescription?: (config: Record<string, any>) => string;
}

export interface WizardState {
  currentStep: number;
  config: Record<string, any>;
  isValid: boolean;
  errors: Record<string, string>;
}

export type { Agent, TriggerType, WorkflowStage, Action, ActionType, CombineStrategy };
