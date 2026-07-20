import { useState, useCallback, useEffect } from 'react';
import { X, X as XIcon, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, Layers, Sparkles } from 'lucide-react';
import { useAssistantStore, Agent, Action, TriggerType, ActionType, WorkflowStage, CombineStrategy, getAgentStages, NotificationSettings } from '../store/assistantStore';
import { WorkflowStageEditor } from './WorkflowStageEditor';
import { TemplateGallery } from './TemplateGallery';
import { TemplateWizard } from './TemplateWizard';
import { AgentTemplate } from '../types/AgentTemplate';
import styles from './AgentBuilder.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Human-readable descriptions for each frequency preset
const FREQUENCIES = [
  { value: 'every_n_seconds', label: 'Every N seconds', desc: 'Runs every specified seconds', cron: 'Interval (seconds)' },
  { value: 'every_n_minutes', label: 'Every N minutes', desc: 'Runs every specified minutes', cron: 'Interval (minutes)' },
  { value: 'hourly', label: 'Hourly', desc: 'Runs every hour', cron: 'Minute of hour' },
  { value: 'every_n_hours', label: 'Every N hours', desc: 'Runs every specified hours', cron: 'Minute of hour, Interval' },
  { value: 'daily', label: 'Daily', desc: 'Runs once per day', cron: 'Time of day' },
  { value: 'every_n_days', label: 'Every N days', desc: 'Runs every specified days', cron: 'Time of day, Interval' },
  { value: 'weekly', label: 'Weekly', desc: 'Runs once per week', cron: 'Day + Time of day' },
  { value: 'monthly', label: 'Monthly', desc: 'Runs once per month', cron: 'Day of month + Time of day' },
  { value: 'custom', label: 'Custom', desc: 'Manual cron expression', cron: 'Expression' },
] as const;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_MODELS: Record<string, string[]> = {
  ollama: ['llama3', 'llama3.1', 'codellama', 'mistral', 'mixtral', 'phi3', 'gemma2', 'qwen2'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  copilot: [
    'auto',
    'claude-haiku-4.5',
    'claude-opus-4.5',
    'claude-sonnet-4.5',
    'claude-sonnet-4.6',
    'gpt-5-mini',
    'gpt-5.3-codex',
  ],
  custom: [],
};

const COPILOT_MODEL_LABELS: Record<string, string> = {
  auto: 'Auto (Variable)',
  'claude-haiku-4.5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4.5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6 - Medium - 264K',
  'gpt-5-mini': 'GPT-5 mini - Medium - 192K',
  'gpt-5.3-codex': 'GPT-5.3-Codex - Medium - 400K',
};

const formatModelLabel = (provider: string, model: string) => {
  if (provider === 'copilot') {
    return COPILOT_MODEL_LABELS[model] ?? model;
  }
  return model;
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  email: {
    enabled: false,
    from: '',
    to: '',
    subject: '',
    smtpUsername: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    useTls: true,
    password: '',
  },
  slack: {
    enabled: false,
    webhookUrl: '',
    channel: '',
    username: '',
  },
  discord: {
    enabled: false,
    webhookUrl: '',
    username: '',
    avatarUrl: '',
  },
};

const cloneNotificationSettings = (settings: NotificationSettings): NotificationSettings => ({
  email: { ...settings.email },
  slack: { ...settings.slack },
  discord: { ...settings.discord },
});

export function AgentBuilder() {
  const { 
    isEditing, 
    getSelectedAgent, 
    setIsCreating, 
    setIsEditing, 
    addAgent, 
    updateAgent: updateAgentInStore 
  } = useAssistantStore();
  
  const existingAgent = isEditing ? getSelectedAgent() : null;
  
  // Template wizard state
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showTemplateWizard, setShowTemplateWizard] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  
  const [name, setName] = useState(existingAgent?.name || '');
  const [description, setDescription] = useState(existingAgent?.description || '');
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() =>
    cloneNotificationSettings(existingAgent?.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS)
  );
  const [triggerType, setTriggerType] = useState<string>(existingAgent?.trigger.type || 'manual');
  const [cronExpression, setCronExpression] = useState(
    existingAgent?.trigger.type === 'cron' ? existingAgent.trigger.expression || '' : '0 * * * *'
  );
  const [watchPath, setWatchPath] = useState(
    existingAgent?.trigger.type === 'file_watch' ? existingAgent.trigger.path || '' : ''
  );
  const [cronFrequency, setCronFrequency] = useState<string>('custom');
  const [cronHour, setCronHour] = useState<number>(0);
  const [cronMinute, setCronMinute] = useState<number>(0);
  const [cronDayOfWeek, setCronDayOfWeek] = useState<number>(0); // 0=Sun, 6=Sat
  const [cronDayOfMonth, setCronDayOfMonth] = useState<number>(1); // 1-31
  const [cronInterval, setCronInterval] = useState<number>(1); // every N hours/days
  const [cronIntervalSeconds, setCronIntervalSeconds] = useState<number>(10); // every N seconds
  const [cronIntervalMinutes, setCronIntervalMinutes] = useState<number>(1); // every N minutes
  const [customCronExpression, setCustomCronExpression] = useState<string>('0 * * * *');

  // Helper to convert frequency settings to a cron expression
  const frequencyToCron = useCallback((freq: string, hour: number, minute: number, dayOfWeek: number, dayOfMonth: number, interval: number, intervalSeconds: number, intervalMinutes: number): string => {
    switch (freq) {
      case 'every_n_seconds': return `*/${intervalMinutes} * * * *`; // runs every N minutes (scheduler granularity)
      case 'every_n_minutes': return `*/${intervalMinutes} * * * *`;
      case 'hourly': return `${minute} * * * *`;
      case 'every_n_hours': return `${minute} */${interval} * * *`;
      case 'daily': return `${minute} ${hour} * * *`;
      case 'every_n_days': return `${minute} ${hour} */${interval} * *`;
      case 'weekly': return `${minute} ${hour} * * ${dayOfWeek}`;
      case 'monthly': return `${minute} ${hour} ${dayOfMonth} * *`;
      default: return '0 * * * *';
    }
  }, []);

  // Convert cron expression to human-readable format
  const cronToHumanReadable = useCallback((expr: string): string => {
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

    const isSimpleNumber = (field: string): boolean => /^\d+$/.test(field);
    
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
    
    // Hourly with hour range and day range: M H-H * * D-D
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
    
    // Hourly: M * * * *
    if (isSimpleNumber(min) && hour === '*' && dom === '*' && dow === '*') {
      const m = parseInt(min);
      return m === 0 ? 'Every hour' : `Hourly at minute ${m}`;
    }
    
    // Every N hours: M */N * * *
    if (isSimpleNumber(min) && hour.startsWith('*/') && dom === '*' && dow === '*') {
      const interval = parseInt(hour.slice(2));
      return `Every ${interval} hours at minute ${min}`;
    }
    
    // Weekly: M H * * D (single day)
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && isSimpleNumber(dow)) {
      const h = parseInt(hour);
      const m = parseInt(min);
      const d = parseInt(dow);
      const dayName = dayNames[d] || `day ${d}`;
      return `Every ${dayName} at ${formatTime(h, m)}`;
    }
    
    // Weekdays/specific days at specific time
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
  }, []);

  // Convert an existing cron expression to frequency settings for UI display
  const cronToFrequency = useCallback((expr: string): { frequency: string; hour: number; minute: number; dayOfWeek: number; dayOfMonth: number; interval: number; intervalSeconds: number; intervalMinutes: number } => {
    const parts = expr.trim().split(/\s+/);
    const defaultCustom = { frequency: 'custom', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    
    if (parts.length !== 5) return defaultCustom;
    const [min, hour, dom, month, dow] = parts;

    // Helper to check if a field is a simple number (no ranges, lists, steps, or wildcards)
    const isSimpleNumber = (field: string): boolean => /^\d+$/.test(field);
    
    // If any field contains complex patterns (ranges like 6-14, lists like 1,3,5, etc.), use custom
    const hasComplexPattern = (field: string): boolean => 
      field.includes('-') || field.includes(',') || (field.includes('/') && !field.startsWith('*/'));

    // Check for complex patterns in hour or dow that we can't represent in simple UI
    if (hasComplexPattern(hour) || hasComplexPattern(dow) || hasComplexPattern(dom)) {
      return defaultCustom;
    }

    // Detect every N minutes: */N in minute field (e.g., */5 * * * *)
    if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*') {
      return { frequency: 'every_n_minutes', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1, interval: parseInt(min.slice(2)) || 1, intervalSeconds: 10, intervalMinutes: parseInt(min.slice(2)) || 1 };
    }
    // Detect hourly pattern: specific minute, * in all other fields
    if (isSimpleNumber(min) && hour === '*' && dom === '*' && dow === '*') {
      return { frequency: 'hourly', hour: 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect every N hours: specific minute, */N in hour
    if (isSimpleNumber(min) && hour.startsWith('*/') && dom === '*' && dow === '*') {
      return { frequency: 'every_n_hours', hour: 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: parseInt(hour.slice(2)) || 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect daily: specific hour and minute, * in dom/dow
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && dow === '*') {
      return { frequency: 'daily', hour: parseInt(hour), minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect every N days: specific hour/minute, */N in dom
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom.startsWith('*/') && dow === '*') {
      return { frequency: 'every_n_days', hour: parseInt(hour), minute: parseInt(min), dayOfWeek: 0, dayOfMonth: parseInt(dom.slice(2)) || 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect weekly: specific hour/minute/dow, * in dom/month
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && month === '*' && isSimpleNumber(dow)) {
      return { frequency: 'weekly', hour: parseInt(hour), minute: parseInt(min), dayOfWeek: parseInt(dow), dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect monthly: specific hour/minute/dom, * in dow
    if (isSimpleNumber(min) && isSimpleNumber(hour) && isSimpleNumber(dom) && dow === '*') {
      return { frequency: 'monthly', hour: parseInt(hour), minute: parseInt(min), dayOfWeek: 0, dayOfMonth: parseInt(dom), interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    return defaultCustom;
  }, []);

  // Sync frequency settings from existing cron expression
  useEffect(() => {
    if (triggerType === 'cron' && existingAgent?.trigger.expression) {
      const parsed = cronToFrequency(existingAgent.trigger.expression);
      setCronFrequency(parsed.frequency);
      setCronHour(parsed.hour);
      setCronMinute(parsed.minute);
      setCronDayOfWeek(parsed.dayOfWeek);
      setCronDayOfMonth(parsed.dayOfMonth);
      setCronInterval(parsed.interval);
      setCronIntervalSeconds(parsed.intervalSeconds);
      setCronIntervalMinutes(parsed.intervalMinutes);
      // Also update custom expression if it's custom
      if (parsed.frequency === 'custom' && existingAgent?.trigger.expression) {
        setCustomCronExpression(existingAgent.trigger.expression);
      }
    }
  }, [existingAgent?.trigger.expression, triggerType, cronToFrequency]);

  // Use stages-based workflow (migrate from legacy actions if needed)
  const [stages, setStages] = useState<WorkflowStage[]>(() => {
    if (existingAgent) {
      return getAgentStages(existingAgent);
    }
    return [];
  });

  const updateEmailSettings = useCallback((updates: Partial<NotificationSettings['email']>) => {
    setNotificationSettings((prev) => ({
      ...prev,
      email: {
        ...prev.email,
        ...updates,
      },
    }));
  }, []);

  const updateSlackSettings = useCallback((updates: Partial<NotificationSettings['slack']>) => {
    setNotificationSettings((prev) => ({
      ...prev,
      slack: {
        ...prev.slack,
        ...updates,
      },
    }));
  }, []);

  const updateDiscordSettings = useCallback((updates: Partial<NotificationSettings['discord']>) => {
    setNotificationSettings((prev) => ({
      ...prev,
      discord: {
        ...prev.discord,
        ...updates,
      },
    }));
  }, []);

  const handleClose = () => {
    if (isEditing) {
      setIsEditing(false);
    } else {
      setIsCreating(false);
    }
  };

  // Stage management
  const handleAddStage = () => {
    const newStage: WorkflowStage = {
      id: generateId(),
      name: `Stage ${stages.length + 1}`,
      actions: [{
        id: generateId(),
        name: 'New Action',
        action_type: { type: 'cli', command: '', args: [] },
        order: 0,
        on_error: 'continue',
      }],
      combineStrategy: 'first_success',
      order: stages.length,
    };
    setStages([...stages, newStage]);
  };

  const handleRemoveStage = (stageId: string) => {
    setStages(stages.filter((s) => s.id !== stageId));
  };

  const handleUpdateStage = (stageId: string, updates: Partial<WorkflowStage>) => {
    setStages(stages.map((s) => s.id === stageId ? { ...s, ...updates } : s));
  };

  const handleMoveStageUp = (stageIndex: number) => {
    if (stageIndex === 0) return;
    const newStages = [...stages];
    [newStages[stageIndex - 1], newStages[stageIndex]] = [newStages[stageIndex], newStages[stageIndex - 1]];
    newStages.forEach((s, i) => s.order = i);
    setStages(newStages);
  };

  const handleMoveStageDown = (stageIndex: number) => {
    if (stageIndex >= stages.length - 1) return;
    const newStages = [...stages];
    [newStages[stageIndex], newStages[stageIndex + 1]] = [newStages[stageIndex + 1], newStages[stageIndex]];
    newStages.forEach((s, i) => s.order = i);
    setStages(newStages);
  };

  // Legacy action handlers (for ActionEditor compatibility)
  const handleAddAction = () => {
    // Add a new stage with a single action
    handleAddStage();
  };

  const handleRemoveAction = (id: string) => {
    // Find and remove action from its stage
    setStages(stages.map((stage) => ({
      ...stage,
      actions: stage.actions.filter((a) => a.id !== id),
    })).filter((stage) => stage.actions.length > 0));
  };

  const handleUpdateAction = (id: string, updates: Partial<Action>) => {
    setStages(stages.map((stage) => ({
      ...stage,
      actions: stage.actions.map((a) => a.id === id ? { ...a, ...updates } : a),
    })));
  };

  // Validation helper for actions
  const validateAction = (action: Action): string[] => {
    const errors: string[] = [];
    const at = action.action_type;
    
    switch (at.type) {
      case 'cli':
        if (!at.command?.trim()) errors.push(`"${action.name}": Command is required`);
        break;
      case 'api':
        if (!at.url?.trim()) errors.push(`"${action.name}": URL is required`);
        if (at.auth_type === 'basic') {
          if (!at.auth_username?.trim()) errors.push(`"${action.name}": Username is required for Basic Auth`);
          if (!at.auth_password?.trim()) errors.push(`"${action.name}": Password is required for Basic Auth`);
        }
        if (at.auth_type === 'bearer' && !at.auth_bearer_token?.trim()) {
          errors.push(`"${action.name}": Bearer token is required`);
        }
        if (at.auth_type === 'api_key') {
          if (!at.auth_api_key_name?.trim()) errors.push(`"${action.name}": API key header name is required`);
          if (!at.auth_api_key_value?.trim()) errors.push(`"${action.name}": API key value is required`);
        }
        break;
      case 'ai_prompt':
        if (!at.prompt?.trim()) errors.push(`"${action.name}": Prompt is required`);
        if (at.model_settings) {
          if (at.model_settings.provider === 'openai' && !at.model_settings.openaiKey?.trim()) {
            errors.push(`"${action.name}": OpenAI API key is required (or uncheck custom model settings to use global)`);
          }
          if (at.model_settings.provider === 'anthropic' && !at.model_settings.anthropicKey?.trim()) {
            errors.push(`"${action.name}": Anthropic API key is required (or uncheck custom model settings to use global)`);
          }
          if (at.model_settings.provider === 'custom') {
            if (!at.model_settings.customBaseUrl?.trim()) {
              errors.push(`"${action.name}": Custom API base URL is required`);
            }
          }
        }
        break;
      case 'save_file':
        if (!at.path?.trim()) errors.push(`"${action.name}": File path is required`);
        break;
      case 'send_email':
        if (!at.from?.trim()) errors.push(`"${action.name}": From email is required`);
        if (!at.to?.trim()) errors.push(`"${action.name}": To email is required`);
        if (!at.smtp_host?.trim()) errors.push(`"${action.name}": SMTP host is required`);
        if (!at.password?.trim()) errors.push(`"${action.name}": SMTP password is required`);
        break;
      case 'send_slack':
        if (!at.webhook_url?.trim()) errors.push(`"${action.name}": Slack webhook URL is required`);
        if (!at.message?.trim()) errors.push(`"${action.name}": Message is required`);
        break;
      case 'send_discord':
        if (!at.webhook_url?.trim()) errors.push(`"${action.name}": Discord webhook URL is required`);
        if (!at.content?.trim()) errors.push(`"${action.name}": Content is required`);
        break;
      case 'mcp':
        if (!at.server_id?.trim()) errors.push(`"${action.name}": MCP server ID is required`);
        if (!at.tool_name?.trim()) errors.push(`"${action.name}": Tool name is required`);
        break;
    }
    return errors;
  };

  const handleSave = async () => {
    // Validate agent name
    if (!name.trim()) {
      alert('Please enter an agent name');
      return;
    }

    // Validate all actions
    const validationErrors: string[] = [];
    stages.forEach((stage) => {
      stage.actions.forEach((action) => {
        validationErrors.push(...validateAction(action));
      });
    });

    if (validationErrors.length > 0) {
      alert(`Please fix the following issues:\n\n${validationErrors.join('\n')}`);
      return;
    }

    const trigger: TriggerType = { type: triggerType as any };
    if (triggerType === 'cron') {
      trigger.expression = cronFrequency === 'custom' ? customCronExpression : frequencyToCron(cronFrequency, cronHour, cronMinute, cronDayOfWeek, cronDayOfMonth, cronInterval, cronIntervalSeconds, cronIntervalMinutes);
    } else if (triggerType === 'file_watch') {
      trigger.path = watchPath;
      trigger.events = ['create', 'modify', 'delete'];
    } else if (triggerType === 'webhook') {
      trigger.path = `/webhook/${generateId()}`;
    }

    try {
      const invoke = await getInvoke();
      
      // Flatten stages to actions for backward compatibility
      const flatActions: Action[] = stages.flatMap((stage, stageIndex) =>
        stage.actions.map((action, actionIndex) => ({
          ...action,
          order: stageIndex * 100 + actionIndex,
        }))
      );
      
      // Convert stages to backend format (camelCase to snake_case for combineStrategy)
      const backendStages = stages.map(stage => ({
        ...stage,
        combine_strategy: stage.combineStrategy,
      }));
      
      if (isEditing && existingAgent) {
        await invoke('update_agent', {
          id: existingAgent.id,
          name,
          description: description || null,
          trigger,
          actions: flatActions,
          stages: backendStages,
          enabled: existingAgent.enabled,
          notificationSettings,
        });
        updateAgentInStore({
          ...existingAgent,
          name,
          description: description || undefined,
          trigger,
          stages,
          actions: flatActions,
          notificationSettings,
          updated_at: new Date().toISOString(),
        });
        setIsEditing(false);
      } else {
        const newAgent = await invoke('create_agent', {
          name,
          description: description || null,
          trigger,
          actions: flatActions,
          stages: backendStages,
          notificationSettings,
        }) as Agent;
        // Add stages to the returned agent for proper state management
        addAgent({ ...newAgent, stages, notificationSettings });
        setIsCreating(false);
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  };

  // Template handlers
  const handleSelectTemplate = (template: AgentTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateGallery(false);
    setShowTemplateWizard(true);
  };

  const handleTemplateComplete = async (agentData: Omit<Agent, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const invoke = await getInvoke();
      
      // Prepare stages for backend
      const backendStages = agentData.stages.map(stage => ({
        ...stage,
        combine_strategy: stage.combineStrategy,
      }));
      
      // Flatten actions for the legacy API
      const flatActions = agentData.stages.flatMap(stage => stage.actions);
      
      const resolvedNotificationSettings = cloneNotificationSettings(
        agentData.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS
      );
      const newAgent = await invoke('create_agent', {
        name: agentData.name,
        description: agentData.description || null,
        trigger: agentData.trigger,
        actions: flatActions,
        stages: backendStages,
        notificationSettings: resolvedNotificationSettings,
      }) as Agent;
      
      // Add the agent with stages
      addAgent({ ...newAgent, stages: agentData.stages, notificationSettings: resolvedNotificationSettings });
      
      setShowTemplateWizard(false);
      setSelectedTemplate(null);
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create agent from template:', error);
      alert('Failed to create agent. Please try again.');
    }
  };

  return (
    <div className={styles.container}>
      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <TemplateGallery
          onClose={() => setShowTemplateGallery(false)}
          onSelectTemplate={handleSelectTemplate}
        />
      )}
      
      {/* Template Wizard Modal */}
      {showTemplateWizard && selectedTemplate && (
        <TemplateWizard
          template={selectedTemplate}
          onClose={() => {
            setShowTemplateWizard(false);
            setSelectedTemplate(null);
          }}
          onComplete={handleTemplateComplete}
        />
      )}
      
      <div className={styles.header}>
        <h2>{isEditing ? 'Edit Agent' : 'Create Agent'}</h2>
        <button onClick={handleClose} className={styles.closeBtn}>
          <X size={20} />
        </button>
      </div>

      <div className={styles.content}>
        {/* Template shortcut for new agents */}
        {!isEditing && (
          <button
            className={styles.templateBtn}
            onClick={() => setShowTemplateGallery(true)}
          >
            <Sparkles size={18} />
            Create from Template
          </button>
        )}
        
        <div className={styles.field}>
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            className={styles.textarea}
            rows={2}
          />
        </div>

        <div className={styles.field}>
          <label>Trigger</label>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
            className={styles.select}
          >
            <option value="manual">Manual</option>
            <option value="cron">Cron Schedule</option>
            <option value="file_watch">File Watch</option>
            <option value="webhook">Webhook</option>
          </select>
        </div>

        {triggerType === 'cron' && (
          <div className={styles.field}>
            <label>Schedule</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Frequency preset selector */}
              <select
                value={cronFrequency}
                onChange={(e) => {
                  setCronFrequency(e.target.value);
                  // Reset to sensible defaults when switching presets
                  if (e.target.value === 'every_n_seconds') { setCronIntervalSeconds(10); }
                  if (e.target.value === 'every_n_minutes') { setCronIntervalMinutes(1); }
                  if (e.target.value === 'hourly') { setCronInterval(1); }
                  if (e.target.value === 'every_n_hours') { setCronInterval(1); }
                  if (e.target.value === 'every_n_days') { setCronInterval(1); }
                }}
                className={styles.select}
              >
                {FREQUENCIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label} — {f.desc}</option>
                ))}
              </select>

              {/* Preview of the generated cron expression with human-readable format */}
              {(() => {
                const cronExpr = cronFrequency === 'custom' 
                  ? customCronExpression 
                  : frequencyToCron(cronFrequency, cronHour, cronMinute, cronDayOfWeek, cronDayOfMonth, cronInterval, cronIntervalSeconds, cronIntervalMinutes);
                const humanReadable = cronToHumanReadable(cronExpr);
                return (
                  <div style={{
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    fontSize: '13px',
                  }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: '4px' }}>
                      {humanReadable}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: '12px' }}>
                      {cronExpr}
                    </div>
                  </div>
                );
              })()}

              {/* Dynamic form fields based on frequency type */}

              {/* Every N seconds: interval in seconds */}
              {cronFrequency === 'every_n_seconds' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>Every</label>
                  <input
                    type="number"
                    min={1}
                    max={59}
                    value={cronIntervalSeconds}
                    onChange={(e) => setCronIntervalSeconds(Math.min(59, Math.max(1, parseInt(e.target.value) || 1)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>seconds</label>
                  <span className={styles.hint}>Scheduler polls at minute granularity (approx. {cronIntervalSeconds}s)</span>
                </div>
              )}

              {/* Every N minutes: interval in minutes */}
              {cronFrequency === 'every_n_minutes' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>Every</label>
                  <input
                    type="number"
                    min={1}
                    max={59}
                    value={cronIntervalMinutes}
                    onChange={(e) => setCronIntervalMinutes(Math.min(59, Math.max(1, parseInt(e.target.value) || 1)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>minutes</label>
                </div>
              )}

              {/* Hourly: pick minute of each hour */}
              {cronFrequency === 'hourly' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>At minute</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>past the hour</label>
                </div>
              )}

              {/* Every N hours: pick interval and minute */}
              {cronFrequency === 'every_n_hours' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>Every</label>
                  <input
                    type="number"
                    min={1}
                    max={23}
                    value={cronInterval}
                    onChange={(e) => setCronInterval(parseInt(e.target.value) || 1)}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>hours at minute</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>past the hour</label>
                </div>
              )}

              {cronFrequency === 'daily' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>At</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cronHour}
                    onChange={(e) => setCronHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>:</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>AM/PM</label>
                  <label className={styles.advancedLabel} style={{ color: 'var(--text-secondary)' }}>
                    {cronHour === 0 ? '12:00 AM' : cronHour < 12 ? `${cronHour}:00 AM` : cronHour === 12 ? '12:00 PM' : `${cronHour - 12}:00 PM`}
                  </label>
                </div>
              )}

              {cronFrequency === 'every_n_days' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label className={styles.advancedLabel}>Every</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={cronInterval === 1 ? 1 : cronInterval}
                    onChange={(e) => setCronInterval(parseInt(e.target.value) || 1)}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>days at</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cronHour}
                    onChange={(e) => setCronHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>:</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                </div>
              )}

              {cronFrequency === 'weekly' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className={styles.advancedLabel}>On</label>
                  <select
                    value={cronDayOfWeek}
                    onChange={(e) => setCronDayOfWeek(parseInt(e.target.value))}
                    className={styles.select}
                    style={{ width: '100px' }}
                  >
                    {DAY_NAMES.map((day, i) => (
                      <option key={day} value={i}>{day}</option>
                    ))}
                  </select>
                  <label className={styles.advancedLabel}>at</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cronHour}
                    onChange={(e) => setCronHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>:</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                </div>
              )}

              {cronFrequency === 'monthly' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className={styles.advancedLabel}>On day</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={cronDayOfMonth}
                    onChange={(e) => setCronDayOfMonth(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>at</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cronHour}
                    onChange={(e) => setCronHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                  <label className={styles.advancedLabel}>:</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className={styles.input}
                    style={{ width: '80px' }}
                  />
                </div>
              )}

              {cronFrequency === 'custom' && (
                <div>
                  <label className={styles.advancedLabel}>Cron Expression</label>
                  <textarea
                    value={customCronExpression}
                    onChange={(e) => setCustomCronExpression(e.target.value)}
                    placeholder="0 9 * * * (minute hour day-of-month month day-of-week)"
                    className={styles.textarea}
                    rows={2}
                  />
                  <span className={styles.hint}>Format: minute hour day-of-month month day-of-week. e.g., "0 9 * * *" for daily at 9am</span>
                </div>
              )}
            </div>
          </div>
        )}

        {triggerType === 'file_watch' && (
          <div className={styles.field}>
            <label>Watch Path</label>
            <input
              type="text"
              value={watchPath}
              onChange={(e) => setWatchPath(e.target.value)}
              placeholder="/path/to/watch"
              className={styles.input}
            />
          </div>
        )}

        <div className={styles.notificationsSection}>
          <div className={styles.notificationsHeader}>
            <label>Notifications</label>
            <span className={styles.hint}>Used as defaults when sending execution output.</span>
          </div>

          <div className={styles.notificationCard}>
            <label className={styles.notificationToggle}>
              <input
                type="checkbox"
                checked={notificationSettings.email.enabled}
                onChange={(e) => updateEmailSettings({ enabled: e.target.checked })}
              />
              Email
            </label>
            {notificationSettings.email.enabled && (
              <div className={styles.notificationFields}>
                <div className={styles.notificationRow}>
                  <label>From</label>
                  <input
                    type="email"
                    value={notificationSettings.email.from}
                    onChange={(e) => updateEmailSettings({ from: e.target.value })}
                    placeholder="you@example.com"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>To</label>
                  <input
                    type="email"
                    value={notificationSettings.email.to}
                    onChange={(e) => updateEmailSettings({ to: e.target.value })}
                    placeholder="team@example.com"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>Subject</label>
                  <input
                    type="text"
                    value={notificationSettings.email.subject}
                    onChange={(e) => updateEmailSettings({ subject: e.target.value })}
                    placeholder="Execution output"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>SMTP host</label>
                  <input
                    type="text"
                    value={notificationSettings.email.smtpHost}
                    onChange={(e) => updateEmailSettings({ smtpHost: e.target.value })}
                    placeholder="smtp.gmail.com"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>SMTP username (optional)</label>
                  <input
                    type="text"
                    value={notificationSettings.email.smtpUsername}
                    onChange={(e) => updateEmailSettings({ smtpUsername: e.target.value })}
                    placeholder="you@example.com"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationInline}>
                  <div className={styles.notificationRow}>
                    <label>SMTP port</label>
                    <input
                      type="number"
                      value={notificationSettings.email.smtpPort}
                      onChange={(e) => updateEmailSettings({ smtpPort: Number(e.target.value) || 0 })}
                      className={styles.input}
                    />
                  </div>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={notificationSettings.email.useTls}
                      onChange={(e) => updateEmailSettings({ useTls: e.target.checked })}
                    />
                    Use TLS
                  </label>
                </div>
                <div className={styles.notificationRow}>
                  <label>Password / app key</label>
                  <input
                    type="password"
                    value={notificationSettings.email.password}
                    onChange={(e) => updateEmailSettings({ password: e.target.value })}
                    placeholder="App password"
                    className={styles.input}
                  />
                </div>
              </div>
            )}
          </div>

          <div className={styles.notificationCard}>
            <label className={styles.notificationToggle}>
              <input
                type="checkbox"
                checked={notificationSettings.slack.enabled}
                onChange={(e) => updateSlackSettings({ enabled: e.target.checked })}
              />
              Slack
            </label>
            {notificationSettings.slack.enabled && (
              <div className={styles.notificationFields}>
                <div className={styles.notificationRow}>
                  <label>Webhook URL</label>
                  <input
                    type="text"
                    value={notificationSettings.slack.webhookUrl}
                    onChange={(e) => updateSlackSettings({ webhookUrl: e.target.value })}
                    placeholder="https://hooks.slack.com/services/..."
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>Channel</label>
                  <input
                    type="text"
                    value={notificationSettings.slack.channel}
                    onChange={(e) => updateSlackSettings({ channel: e.target.value })}
                    placeholder="#alerts"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>Username (optional)</label>
                  <input
                    type="text"
                    value={notificationSettings.slack.username}
                    onChange={(e) => updateSlackSettings({ username: e.target.value })}
                    placeholder="OpenCodeAssistant"
                    className={styles.input}
                  />
                </div>
              </div>
            )}
          </div>

          <div className={styles.notificationCard}>
            <label className={styles.notificationToggle}>
              <input
                type="checkbox"
                checked={notificationSettings.discord.enabled}
                onChange={(e) => updateDiscordSettings({ enabled: e.target.checked })}
              />
              Discord
            </label>
            {notificationSettings.discord.enabled && (
              <div className={styles.notificationFields}>
                <div className={styles.notificationRow}>
                  <label>Webhook URL</label>
                  <input
                    type="text"
                    value={notificationSettings.discord.webhookUrl}
                    onChange={(e) => updateDiscordSettings({ webhookUrl: e.target.value })}
                    placeholder="https://discord.com/api/webhooks/..."
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>Username (optional)</label>
                  <input
                    type="text"
                    value={notificationSettings.discord.username}
                    onChange={(e) => updateDiscordSettings({ username: e.target.value })}
                    placeholder="OpenCodeAssistant"
                    className={styles.input}
                  />
                </div>
                <div className={styles.notificationRow}>
                  <label>Avatar URL (optional)</label>
                  <input
                    type="text"
                    value={notificationSettings.discord.avatarUrl}
                    onChange={(e) => updateDiscordSettings({ avatarUrl: e.target.value })}
                    placeholder="https://..."
                    className={styles.input}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.actionsSection}>
          <div className={styles.actionsHeader}>
            <label>
              <Layers size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Workflow Stages
            </label>
            <button onClick={handleAddStage} className={styles.addActionBtn}>
              <Plus size={16} />
              Add Stage
            </button>
          </div>

          <p className={styles.hint} style={{ marginBottom: '16px' }}>
            Stages run sequentially. Actions within a stage run in parallel.
          </p>

          {stages.map((stage, index) => (
            <WorkflowStageEditor
              key={stage.id}
              stage={stage}
              stageIndex={index}
              onUpdate={(updates) => handleUpdateStage(stage.id, updates)}
              onRemove={() => handleRemoveStage(stage.id)}
              onMoveUp={() => handleMoveStageUp(index)}
              onMoveDown={() => handleMoveStageDown(index)}
              canMoveUp={index > 0}
              canMoveDown={index < stages.length - 1}
              renderActionEditor={(action, actionIndex, onUpdate, onRemove) => (
                <ActionEditor
                  action={action}
                  index={actionIndex}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                />
              )}
            />
          ))}

          {stages.length === 0 && (
            <div className={styles.noActions}>
              <p>No workflow stages added yet</p>
              <button onClick={handleAddStage} className={styles.addActionBtn} style={{ marginTop: '12px' }}>
                <Plus size={16} />
                Add Your First Stage
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <button onClick={handleClose} className={styles.cancelBtn}>
          Cancel
        </button>
        <button onClick={handleSave} className={styles.saveBtn}>
          {isEditing ? 'Save Changes' : 'Create Agent'}
        </button>
      </div>
    </div>
  );
}

interface ActionEditorProps {
  action: Action;
  index: number;
  onUpdate: (updates: Partial<Action>) => void;
  onRemove: () => void;
}

function ActionEditor({ action, index, onUpdate, onRemove }: ActionEditorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchOllamaModels = useCallback(async (baseUrl: string) => {
    setLoadingModels(true);
    try {
      const invoke = await getInvoke();
      const models = await invoke< Array<{ name: string }> >('list_ollama_models', { baseUrl });
      setAvailableModels(models.map(m => m.name));
    } catch (err) {
      console.error('Failed to fetch Ollama models:', err);
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // Load models whenever ai_prompt action with Ollama is visible
  useEffect(() => {
    if (action.action_type.type !== 'ai_prompt') return;
    const settings = (action.action_type as any).model_settings;
    if (!settings?.provider) return;
    if (settings.provider === 'ollama') {
      fetchOllamaModels(settings.ollamaUrl || 'http://localhost:11434');
    } else if (DEFAULT_MODELS[settings.provider]) {
      // For non-Ollama providers, use built-in defaults (same as launcher)
      setAvailableModels(DEFAULT_MODELS[settings.provider]);
    }
  }, [action.action_type.type, action.action_type.model_settings?.provider, action.action_type.model_settings?.ollamaUrl, fetchOllamaModels]);

  const handleTypeChange = (type: string) => {
    let newActionType: ActionType;
    switch (type) {
      case 'cli':
        newActionType = { type: 'cli', command: '', args: [] };
        break;
      case 'api':
        newActionType = {
          type: 'api', method: 'GET', url: '', headers: {},
          auth_type: 'none', content_type: 'application/json', body_type: 'raw',
          follow_redirects: true,
        };
        break;
      case 'mcp':
        newActionType = { type: 'mcp', server_id: '', tool_name: '', arguments: {} };
        break;
      case 'ai_prompt':
        newActionType = { type: 'ai_prompt', prompt: '', system_prompt: '', model_settings: undefined };
        break;
      case 'save_file':
        newActionType = { type: 'save_file', path: '', content: '{{previous_output}}', append: false };
        break;
      case 'send_email':
        newActionType = { type: 'send_email', from: '', to: '', subject: '', body: '', smtp_host: 'smtp.gmail.com', smtp_port: 587, use_tls: true, password: '' };
        break;
      case 'send_slack':
        newActionType = { type: 'send_slack', webhook_url: '', channel: '', message: '', username: '' };
        break;
      case 'send_discord':
        newActionType = { type: 'send_discord', webhook_url: '', content: '', username: '', avatar_url: '' };
        break;
      default:
        return;
    }
    onUpdate({ action_type: newActionType });
    setShowAdvanced(false);
  };

  return (
    <div className={styles.actionEditor}>
      <div className={styles.actionHeader}>
        <span className={styles.actionIndex}>{index + 1}</span>
        <input
          type="text"
          value={action.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className={styles.actionNameInput}
          placeholder="Action name"
        />
        <button onClick={onRemove} className={styles.removeActionBtn}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className={styles.actionFields}>
        <select
          value={action.action_type.type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className={styles.select}
        >
          <option value="cli">CLI Command</option>
          <option value="api">API Call</option>
          <option value="mcp">MCP Tool</option>
          <option value="ai_prompt">AI Prompt</option>
          <option value="save_file">Save to File</option>
          <option value="send_email">Send Email</option>
          <option value="send_slack">Send Slack Message</option>
          <option value="send_discord">Send Discord Message</option>
        </select>

        {action.action_type.type === 'cli' && (
          <div className={styles.actionFieldGroup}>
            <label>Command <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input
              type="text"
              value={action.action_type.command || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, command: e.target.value }
              })}
              placeholder="e.g., npm run build"
              className={`${styles.input} ${!action.action_type.command?.trim() ? styles.inputError : ''}`}
            />
          </div>
        )}

        {action.action_type.type === 'api' && (
          <>
            <div className={styles.actionFieldGroup}>
              <label>URL <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <div className={styles.actionFieldRow}>
                <select
                  value={action.action_type.method || 'GET'}
                  onChange={(e) => onUpdate({
                    action_type: { ...action.action_type, method: e.target.value }
                  })}
                  className={styles.select}
                  style={{ width: '100px' }}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
                <input
                  type="url"
                  value={action.action_type.url || ''}
                  onChange={(e) => onUpdate({
                    action_type: { ...action.action_type, url: e.target.value }
                  })}
                  placeholder="https://api.example.com/endpoint"
                  className={`${styles.input} ${!action.action_type.url?.trim() ? styles.inputError : ''}`}
                />
              </div>
            </div>

            <button
              className={styles.advancedToggle}
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className={styles.advancedSection}>
                {/* Auth */}
                <div style={{ marginBottom: '12px' }}>
                  <label className={styles.advancedLabel}>Authentication</label>
                  <select
                    value={action.action_type.auth_type || 'none'}
                    onChange={(e) => onUpdate({
                      action_type: { ...action.action_type, auth_type: e.target.value as any }
                    })}
                    className={styles.select}
                  >
                    <option value="none">None</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="api_key">API Key (Header)</option>
                  </select>
                </div>

                {(action.action_type.auth_type || 'none') === 'basic' && (
                  <div className={styles.advancedSection}>
                    <label className={styles.advancedLabel}>Username</label>
                    <input
                      type="text"
                      value={action.action_type.auth_username || ''}
                      onChange={(e) => onUpdate({
                        action_type: { ...action.action_type, auth_username: e.target.value }
                      })}
                      placeholder="Username"
                      className={styles.input}
                    />
                    <label className={styles.advancedLabel}>Password</label>
                    <input
                      type="password"
                      value={action.action_type.auth_password || ''}
                      onChange={(e) => onUpdate({
                        action_type: { ...action.action_type, auth_password: e.target.value }
                      })}
                      placeholder="Password"
                      className={styles.input}
                    />
                  </div>
                )}

                {(action.action_type.auth_type || 'none') === 'bearer' && (
                  <div className={styles.advancedSection}>
                    <label className={styles.advancedLabel}>Bearer Token</label>
                    <input
                      type="password"
                      value={action.action_type.auth_bearer_token || ''}
                      onChange={(e) => onUpdate({
                        action_type: { ...action.action_type, auth_bearer_token: e.target.value }
                      })}
                      placeholder="sk-... or token"
                      className={styles.input}
                    />
                  </div>
                )}

                {(action.action_type.auth_type || 'none') === 'api_key' && (
                  <div className={styles.advancedSection}>
                    <label className={styles.advancedLabel}>Header Name</label>
                    <input
                      type="text"
                      value={action.action_type.auth_api_key_name || ''}
                      onChange={(e) => onUpdate({
                        action_type: { ...action.action_type, auth_api_key_name: e.target.value }
                      })}
                      placeholder="X-API-Key"
                      className={styles.input}
                    />
                    <label className={styles.advancedLabel}>API Key Value</label>
                    <input
                      type="password"
                      value={action.action_type.auth_api_key_value || ''}
                      onChange={(e) => onUpdate({
                        action_type: { ...action.action_type, auth_api_key_value: e.target.value }
                      })}
                      placeholder="Your API key"
                      className={styles.input}
                    />
                  </div>
                )}

                {/* Request Settings */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid var(--bg-tertiary)` }}>
                  <label className={styles.advancedLabel}>Content-Type</label>
                  <select
                    value={action.action_type.content_type || 'application/json'}
                    onChange={(e) => onUpdate({
                      action_type: { ...action.action_type, content_type: e.target.value }
                    })}
                    className={styles.select}
                  >
                    <option value="application/json">application/json</option>
                    <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                    <option value="text/plain">text/plain</option>
                    <option value="multipart/form-data">multipart/form-data</option>
                    <option value="application/xml">application/xml</option>
                  </select>
                </div>

                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid var(--bg-tertiary)` }}>
                  <label className={styles.advancedLabel}>Body Type</label>
                  <select
                    value={action.action_type.body_type || 'raw'}
                    onChange={(e) => onUpdate({
                      action_type: { ...action.action_type, body_type: e.target.value as any }
                    })}
                    className={styles.select}
                  >
                    <option value="raw">Raw</option>
                    <option value="json">JSON (formatted)</option>
                    <option value="form_data">Form Data</option>
                  </select>
                </div>

                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid var(--bg-tertiary)` }}>
                  <label className={styles.advancedLabel}>Follow Redirects</label>
                  <select
                    value={String((action.action_type as any).follow_redirects ?? true)}
                    onChange={(e) => onUpdate({
                      action_type: { ...action.action_type, follow_redirects: e.target.value === 'true' }
                    })}
                    className={styles.select}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>

                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid var(--bg-tertiary)` }}>
                  <label className={styles.advancedLabel}>Timeout (seconds)</label>
                  <input
                    type="number"
                    value={(action.action_type as any).timeout_seconds || ''}
                    onChange={(e) => onUpdate({
                      action_type: {
                        ...action.action_type,
                        timeout_seconds: e.target.value ? parseFloat(e.target.value) : undefined
                      }
                    })}
                    placeholder="30 (use global)"
                    className={styles.input}
                    style={{ width: '120px' }}
                  />
                </div>

                {/* Custom Headers */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid var(--bg-tertiary)` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label className={styles.advancedLabel}>Custom Headers</label>
                    <button
                      onClick={() => {
                        const existing = (action.action_type as any).headers || {};
                        const entries: [string, string][] = Object.entries(existing).map(([k, v]) => [k, String(v)]);
                        entries.push(['', '']);
                        onUpdate({
                          action_type: {
                            ...action.action_type,
                            headers: Object.fromEntries(entries) as Record<string, string>,
                          }
                        });
                      }}
                      style={{
                        padding: '2px 8px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: 'var(--button-bg)',
                        border: '1px solid var(--button-border)',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                  {(() => {
                    const headers = Object.entries((action.action_type as any).headers || {});
                    if (headers.length === 0) {
                      return <p className={styles.hint}>No custom headers added.</p>;
                    }
                    return headers.map(([key, value], i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                        <input
                          type="text"
                          value={key}
                          onChange={(e) => {
                            const newHeaders = { ...((action.action_type as any).headers || {}) };
                            const entries: [string, string][] = Object.entries(newHeaders).map(([k, v]) => [k, String(v)]);
                            entries[i] = [e.target.value, entries[i][1]];
                            onUpdate({
                              action_type: {
                                ...action.action_type,
                                headers: Object.fromEntries(entries) as Record<string, string>,
                              }
                            });
                          }}
                          placeholder="Header name (e.g., X-Custom-Header)"
                          className={styles.input}
                          style={{ flex: 1 }}
                        />
                        <input
                          type="text"
                          value={String(value)}
                          onChange={(e) => {
                            const newHeaders = { ...((action.action_type as any).headers || {}) };
                            const entries: [string, string][] = Object.entries(newHeaders).map(([k, v]) => [k, String(v)]);
                            entries[i] = [entries[i][0], e.target.value];
                            onUpdate({
                              action_type: {
                                ...action.action_type,
                                headers: Object.fromEntries(entries) as Record<string, string>,
                              }
                            });
                          }}
                          placeholder="Value"
                          className={styles.input}
                          style={{ flex: 1 }}
                        />
                        <button
                          onClick={() => {
                            const newHeaders = { ...((action.action_type as any).headers || {}) };
                            delete newHeaders[key];
                            onUpdate({
                              action_type: {
                                ...action.action_type,
                                headers: newHeaders,
                              }
                            });
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            background: 'transparent',
                            border: '1px solid var(--button-border)',
                            borderRadius: '4px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Remove header"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* Request Body */}
            <div className={styles.actionFieldGroup}>
              <label>Request Body</label>
              <textarea
                value={action.action_type.body || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, body: e.target.value }
                })}
                placeholder={`Request body (use {{previous_output}} for variables)...`}
                className={styles.textarea}
                rows={4}
                style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre', overflowX: 'auto' }}
              />
              <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}. Supports JSON, form data, or plain text.</p>
            </div>
          </>
        )}

        {action.action_type.type === 'ai_prompt' && (
          <>
            <div className={styles.actionFieldGroup}>
              <label>Prompt <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <textarea
                value={action.action_type.prompt || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, prompt: e.target.value }
                })}
                placeholder="Enter your prompt... (use {{previous_output}} to include previous action's result)"
                className={`${styles.textarea} ${!action.action_type.prompt?.trim() ? styles.inputError : ''}`}
                rows={3}
              />
              <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}, {'{{time}}'}</p>
            </div>
            
            <button 
              className={styles.advancedToggle}
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced Settings
            </button>
            
            {showAdvanced && (
              <div className={styles.advancedSection}>
                <label className={styles.advancedLabel}>System Prompt (Optional)</label>
                <textarea
                  value={action.action_type.system_prompt || ''}
                  onChange={(e) => onUpdate({
                    action_type: { ...action.action_type, system_prompt: e.target.value }
                  })}
                  placeholder="Custom system prompt to guide the AI's behavior and response format..."
                  className={styles.textarea}
                  rows={3}
                />
                <p className={styles.hint}>
                  The system prompt sets the AI's role and instructions. Example: "You are a financial analyst.
                  Always respond with bullet points and include sources."
                </p>

                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={(action.action_type as any).model_settings !== undefined && (action.action_type as any).model_settings?.model !== ''}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onUpdate({
                          action_type: {
                            ...action.action_type,
                            model_settings: {
                              provider: 'ollama',
                              model: '',
                              temperature: 0.7,
                              maxTokens: 4096,
                            }
                          }
                        });
                      } else {
                        onUpdate({
                          action_type: {
                            ...action.action_type,
                            model_settings: undefined
                          }
                        });
                      }
                    }}
                  />
                  Use custom model settings for this action
                </label>

                {(action.action_type as any).model_settings && (
                  <div className={styles.advancedSection}>
                    <label className={styles.advancedLabel}>AI Provider</label>
                    <select
                      value={(action.action_type as any).model_settings.provider || 'ollama'}
                      onChange={async (e) => {
                        const newProvider = e.target.value as string;
                        const currentSettings = (action.action_type as any).model_settings || {};
                        const currentModel = currentSettings.model;
                        const providerModels = DEFAULT_MODELS[newProvider] || [];
                        const newModel = providerModels.length > 0 && !providerModels.includes(currentModel)
                          ? providerModels[0]
                          : currentModel;
                        onUpdate({
                          action_type: {
                            ...action.action_type,
                            model_settings: {
                              ...currentSettings,
                              provider: newProvider,
                              model: newModel,
                            }
                          }
                        });
                        if (newProvider === 'ollama') {
                          const ollamaUrl = currentSettings.ollamaUrl || 'http://localhost:11434';
                          await fetchOllamaModels(ollamaUrl);
                        }
                      }}
                      className={styles.select}
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="copilot">GitHub Copilot</option>
                      <option value="custom">Custom API</option>
                    </select>

                    <label className={styles.advancedLabel}>Model</label>
                    {(() => {
                      const provider = (action.action_type as any).model_settings.provider || 'ollama';
                      const liveModels = (availableModels ?? []).filter(Boolean) as string[];
                      const builtInModels = (DEFAULT_MODELS[provider] || []).filter(Boolean) as string[];
                      const mergedModels = provider === 'ollama'
                        ? (liveModels.length > 0 ? liveModels : builtInModels)
                        : builtInModels;
                      const currentModels = [...new Set(mergedModels)];
                      const selectedModel = (action.action_type as any).model_settings?.model;
                      const isValidModel = selectedModel && currentModels.includes(selectedModel);
                      const effectiveValue = isValidModel ? selectedModel : (currentModels[0] || '');
                      return currentModels.length > 0 ? (
                        <select
                          value={effectiveValue}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                model: e.target.value
                              }
                            }
                          })}
                          className={styles.select}
                          disabled={loadingModels}
                        >
                          {currentModels.map((model) => (
                            <option key={model} value={model}>
                              {formatModelLabel(provider, model)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={selectedModel || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                model: e.target.value
                              }
                            }
                          })}
                          placeholder={loadingModels ? "Loading models..." : "Enter model name"}
                          className={styles.input}
                          disabled={loadingModels}
                        />
                      );
                    })()}
                    {((action.action_type as any).model_settings.provider || 'ollama') === 'ollama' && loadingModels && (
                      <p className={styles.hint}>Fetching Ollama models...</p>
                    )}
                    {((action.action_type as any).model_settings.provider || 'ollama') === 'ollama' &&
                      (availableModels?.length === 0 && !loadingModels) && (
                      <p className={styles.hint}>No models found. Make sure Ollama is running.</p>
                    )}
                    {((action.action_type as any).model_settings.provider || 'ollama') === 'ollama' && !loadingModels && (
                      <button
                        onClick={async () => {
                          const ollamaUrl = (action.action_type as any).model_settings?.ollamaUrl || 'http://localhost:11434';
                          await fetchOllamaModels(ollamaUrl);
                        }}
                        disabled={loadingModels}
                        title="Refresh models"
                        style={{
                          marginTop: '4px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: 'var(--button-bg)',
                          border: '1px solid var(--button-border)',
                          borderRadius: '4px',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <RefreshCw size={14} />
                        Refresh
                      </button>
                    )}

                    <label className={styles.advancedLabel}>Temperature (0-1)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={(action.action_type as any).model_settings.temperature ?? 0.7}
                      onChange={(e) => onUpdate({
                        action_type: {
                          ...action.action_type,
                          model_settings: {
                            ...((action.action_type as any).model_settings || {}),
                            temperature: parseFloat(e.target.value) || 0.7
                          }
                        }
                      })}
                      className={styles.input}
                      style={{ width: '80px' }}
                    />

                    <label className={styles.advancedLabel}>Max Tokens</label>
                    <input
                      type="number"
                      min="1"
                      value={(action.action_type as any).model_settings.maxTokens ?? 4096}
                      onChange={(e) => onUpdate({
                        action_type: {
                          ...action.action_type,
                          model_settings: {
                            ...((action.action_type as any).model_settings || {}),
                            maxTokens: parseInt(e.target.value) || 4096
                          }
                        }
                      })}
                      className={styles.input}
                      style={{ width: '100px' }}
                    />

                    {((action.action_type as any).model_settings.provider || 'ollama') === 'ollama' && (
                      <>
                        <label className={styles.advancedLabel}>Ollama URL</label>
                        <input
                          type="text"
                          value={(action.action_type as any).model_settings.ollamaUrl || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                ollamaUrl: e.target.value
                              }
                            }
                          })}
                          placeholder="http://127.0.0.1:11434 (leaves blank to use global)"
                          className={styles.input}
                        />
                      </>
                    )}

                    {((action.action_type as any).model_settings.provider || 'ollama') === 'openai' && (
                      <>
                        <label className={styles.advancedLabel}>OpenAI API Key</label>
                        <input
                          type="password"
                          value={(action.action_type as any).model_settings.openaiKey || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                openaiKey: e.target.value
                              }
                            }
                          })}
                          placeholder="sk-... (leaves blank to use global)"
                          className={styles.input}
                        />
                      </>
                    )}

                    {((action.action_type as any).model_settings.provider || 'ollama') === 'anthropic' && (
                      <>
                        <label className={styles.advancedLabel}>Anthropic API Key</label>
                        <input
                          type="password"
                          value={(action.action_type as any).model_settings.anthropicKey || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                anthropicKey: e.target.value
                              }
                            }
                          })}
                          placeholder="sk-ant-... (leaves blank to use global)"
                          className={styles.input}
                        />
                      </>
                    )}

                    {((action.action_type as any).model_settings.provider || 'ollama') === 'custom' && (
                      <>
                        <label className={styles.advancedLabel}>Base URL</label>
                        <input
                          type="text"
                          value={(action.action_type as any).model_settings.customBaseUrl || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                customBaseUrl: e.target.value
                              }
                            }
                          })}
                          placeholder="https://api.example.com (leaves blank to use global)"
                          className={styles.input}
                        />
                        <label className={styles.advancedLabel}>API Key</label>
                        <input
                          type="password"
                          value={(action.action_type as any).model_settings.customApiKey || ''}
                          onChange={(e) => onUpdate({
                            action_type: {
                              ...action.action_type,
                              model_settings: {
                                ...((action.action_type as any).model_settings || {}),
                                customApiKey: e.target.value
                              }
                            }
                          })}
                          placeholder="API key (leaves blank to use global)"
                          className={styles.input}
                        />
                      </>
                    )}

                    <p className={styles.hint}>
                      Leave model/settings blank to fall back to global settings. Only the provider field is required.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {action.action_type.type === 'save_file' && (
          <>
            <div className={styles.actionFieldGroup}>
              <label>File Path <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input
                type="text"
                value={(action.action_type as any).path || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, path: e.target.value }
                })}
                placeholder="e.g., ~/Documents/output.txt"
                className={`${styles.input} ${!(action.action_type as any).path?.trim() ? styles.inputError : ''}`}
              />
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Content</label>
              <textarea
                value={(action.action_type as any).content || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, content: e.target.value }
                })}
                placeholder="Content to save (use {{previous_output}} to save previous action's result)"
                className={styles.textarea}
                rows={2}
              />
              <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}, {'{{datetime}}'}</p>
            </div>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={(action.action_type as any).append || false}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, append: e.target.checked }
                })}
              />
              Append to file (instead of overwrite)
            </label>
          </>
        )}

        {action.action_type.type === 'send_email' && (
          <>
            <input
              type="email"
              value={(action.action_type as any).from || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, from: e.target.value }
              })}
              placeholder="From email (e.g., you@gmail.com)"
              className={styles.input}
            />
            <input
              type="email"
              value={(action.action_type as any).to || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, to: e.target.value }
              })}
              placeholder="To email"
              className={styles.input}
            />
            <input
              type="text"
              value={(action.action_type as any).subject || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, subject: e.target.value }
              })}
              placeholder="Subject"
              className={styles.input}
            />
            <textarea
              value={(action.action_type as any).body || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, body: e.target.value }
              })}
              placeholder="Email body (use {{previous_output}} to include previous action's result)"
              className={styles.textarea}
              rows={3}
            />
            <input
              type="text"
              value={(action.action_type as any).smtp_host || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, smtp_host: e.target.value }
              })}
              placeholder="SMTP host (e.g., smtp.gmail.com)"
              className={styles.input}
            />
            <input
              type="number"
              value={(action.action_type as any).smtp_port || 587}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, smtp_port: parseInt(e.target.value) || 587 }
              })}
              placeholder="Port"
              className={styles.input}
              style={{ width: '80px' }}
            />
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={(action.action_type as any).use_tls || false}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, use_tls: e.target.checked }
                })}
              />
              Use TLS
            </label>
            <input
              type="password"
              value={(action.action_type as any).password || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, password: e.target.value }
              })}
              placeholder="SMTP password / app key"
              className={styles.input}
            />
            <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}</p>
          </>
        )}

        {action.action_type.type === 'send_slack' && (
          <>
            <div className={styles.actionFieldGroup}>
              <label>Webhook URL <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input
                type="url"
                value={(action.action_type as any).webhook_url || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, webhook_url: e.target.value }
                })}
                placeholder="https://hooks.slack.com/..."
                className={`${styles.input} ${!(action.action_type as any).webhook_url?.trim() ? styles.inputError : ''}`}
              />
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Channel</label>
              <input
                type="text"
                value={(action.action_type as any).channel || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, channel: e.target.value }
                })}
                placeholder="#general or @user"
                className={styles.input}
              />
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Message <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <textarea
                value={(action.action_type as any).message || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, message: e.target.value }
                })}
                placeholder="Message (use {{previous_output}} to include previous action's result)"
                className={`${styles.textarea} ${!(action.action_type as any).message?.trim() ? styles.inputError : ''}`}
                rows={3}
              />
              <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}</p>
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Bot Username</label>
              <input
                type="text"
                value={(action.action_type as any).username || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, username: e.target.value }
                })}
                placeholder="Optional"
                className={styles.input}
              />
            </div>
          </>
        )}

        {action.action_type.type === 'send_discord' && (
          <>
            <div className={styles.actionFieldGroup}>
              <label>Webhook URL <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input
                type="url"
                value={(action.action_type as any).webhook_url || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, webhook_url: e.target.value }
                })}
                placeholder="https://discord.com/api/webhooks/..."
                className={`${styles.input} ${!(action.action_type as any).webhook_url?.trim() ? styles.inputError : ''}`}
              />
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Content <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <textarea
                value={(action.action_type as any).content || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, content: e.target.value }
                })}
                placeholder="Message content (use {{previous_output}} to include previous action's result)"
                className={`${styles.textarea} ${!(action.action_type as any).content?.trim() ? styles.inputError : ''}`}
                rows={3}
              />
              <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}</p>
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Bot Username</label>
              <input
                type="text"
                value={(action.action_type as any).username || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, username: e.target.value }
                })}
                placeholder="Optional"
                className={styles.input}
              />
            </div>
            <div className={styles.actionFieldGroup}>
              <label>Avatar URL</label>
              <input
                type="url"
                value={(action.action_type as any).avatar_url || ''}
                onChange={(e) => onUpdate({
                  action_type: { ...action.action_type, avatar_url: e.target.value }
                })}
                placeholder="Optional"
                className={styles.input}
              />
            </div>
          </>
        )}

        <select
          value={action.on_error}
          onChange={(e) => onUpdate({ on_error: e.target.value as any })}
          className={styles.select}
          style={{ width: '120px' }}
        >
          <option value="stop">Stop on error</option>
          <option value="continue">Continue</option>
          <option value="retry">Retry</option>
        </select>
      </div>
    </div>
  );
}
