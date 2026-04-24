import { useState, useCallback, useEffect } from 'react';
import { X, X as XIcon, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useAssistantStore, Agent, Action, TriggerType, ActionType } from '../store/assistantStore';
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
  copilot: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'claude-3.5-sonnet'],
  custom: [],
};

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
  
  const [name, setName] = useState(existingAgent?.name || '');
  const [description, setDescription] = useState(existingAgent?.description || '');
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

  // Convert an existing cron expression to frequency settings for UI display
  const cronToFrequency = useCallback((expr: string): { frequency: string; hour: number; minute: number; dayOfWeek: number; dayOfMonth: number; interval: number; intervalSeconds: number; intervalMinutes: number } => {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return { frequency: 'custom', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    const [min, hour, dom, month, dow] = parts;

    // Detect every N minutes: */N in minute field (e.g., */5 * * * *)
    if (min.startsWith('*/')) {
      return { frequency: 'every_n_minutes', hour: 0, minute: 0, dayOfWeek: 0, dayOfMonth: 1, interval: parseInt(min.slice(2)) || 1, intervalSeconds: 10, intervalMinutes: parseInt(min.slice(2)) || 1 };
    }
    // Detect hourly pattern: minute < 59, * */* in hour, */1 in dom/dow
    if (min !== '59' && hour === '*' && dom === '*' && dow === '*') {
      return { frequency: 'hourly', hour: 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect every N hours: minute < 59, */N in hour
    if (min !== '59' && hour.startsWith('*/')) {
      return { frequency: 'every_n_hours', hour: 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: parseInt(hour.slice(2)) || 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect daily: specific hour, * in dom/dow
    if (dom === '*' && dow === '*') {
      return { frequency: 'daily', hour: parseInt(hour) || 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect every N days: specific hour, */N in dom
    if (dom.startsWith('*/') && dow === '*') {
      return { frequency: 'every_n_days', hour: parseInt(hour) || 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: parseInt(dom.slice(2)) || 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect weekly: specific hour, * */* in month/dom, specific day of week
    if (month === '*' && dom === '*') {
      return { frequency: 'weekly', hour: parseInt(hour) || 0, minute: parseInt(min), dayOfWeek: parseInt(dow), dayOfMonth: 1, interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    // Detect monthly: specific hour, specific dom
    if (dom !== '*' && month !== '*') {
      return { frequency: 'monthly', hour: parseInt(hour) || 0, minute: parseInt(min), dayOfWeek: 0, dayOfMonth: parseInt(dom), interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
    }
    return { frequency: 'custom', hour: parseInt(hour) || 0, minute: parseInt(min), dayOfWeek: parseInt(dow), dayOfMonth: parseInt(dom), interval: 1, intervalSeconds: 10, intervalMinutes: 1 };
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

  const [actions, setActions] = useState<Action[]>(existingAgent?.actions || []);

  const handleClose = () => {
    if (isEditing) {
      setIsEditing(false);
    } else {
      setIsCreating(false);
    }
  };

  const handleAddAction = () => {
    const newAction: Action = {
      id: generateId(),
      name: 'New Action',
      action_type: { type: 'cli', command: '', args: [] },
      order: actions.length,
      on_error: 'stop',
    };
    setActions([...actions, newAction]);
  };

  const handleRemoveAction = (id: string) => {
    setActions(actions.filter((a) => a.id !== id));
  };

  const handleUpdateAction = (id: string, updates: Partial<Action>) => {
    setActions(actions.map((a) => a.id === id ? { ...a, ...updates } : a));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter an agent name');
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
      
      if (isEditing && existingAgent) {
        await invoke('update_agent', {
          id: existingAgent.id,
          name,
          description: description || null,
          trigger,
          actions,
          enabled: existingAgent.enabled,
        });
        updateAgentInStore({
          ...existingAgent,
          name,
          description: description || undefined,
          trigger,
          actions,
          updated_at: new Date().toISOString(),
        });
        setIsEditing(false);
      } else {
        const newAgent = await invoke('create_agent', {
          name,
          description: description || null,
          trigger,
          actions,
        }) as Agent;
        addAgent(newAgent);
        setIsCreating(false);
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>{isEditing ? 'Edit Agent' : 'Create Agent'}</h2>
        <button onClick={handleClose} className={styles.closeBtn}>
          <X size={20} />
        </button>
      </div>

      <div className={styles.content}>
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

              {/* Preview of the generated cron expression */}
              <div style={{
                padding: '6px 10px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: 'var(--text-secondary)',
              }}>
                Cron: <span style={{ color: 'var(--text-primary)' }}>{frequencyToCron(cronFrequency, cronHour, cronMinute, cronDayOfWeek, cronDayOfMonth, cronInterval, cronIntervalSeconds, cronIntervalMinutes)}</span>
              </div>

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

        <div className={styles.actionsSection}>
          <div className={styles.actionsHeader}>
            <label>Actions</label>
            <button onClick={handleAddAction} className={styles.addActionBtn}>
              <Plus size={16} />
              Add Action
            </button>
          </div>

          {actions.map((action, index) => (
            <ActionEditor
              key={action.id}
              action={action}
              index={index}
              onUpdate={(updates) => handleUpdateAction(action.id, updates)}
              onRemove={() => handleRemoveAction(action.id)}
            />
          ))}

          {actions.length === 0 && (
            <p className={styles.noActions}>No actions added yet</p>
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
          <input
            type="text"
            value={action.action_type.command || ''}
            onChange={(e) => onUpdate({
              action_type: { ...action.action_type, command: e.target.value }
            })}
            placeholder="Command (e.g., npm run build)"
            className={styles.input}
          />
        )}

        {action.action_type.type === 'api' && (
          <>
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
              className={styles.input}
            />

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
                        const entries = Object.entries(existing);
                        entries.push(['', '']);
                        onUpdate({
                          action_type: {
                            ...action.action_type,
                            headers: Object.fromEntries(entries),
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
                            const entries = Object.entries(newHeaders);
                            entries[i] = [e.target.value, entries[i][1]];
                            onUpdate({
                              action_type: {
                                ...action.action_type,
                                headers: Object.fromEntries(entries),
                              }
                            });
                          }}
                          placeholder="Header name (e.g., X-Custom-Header)"
                          className={styles.input}
                          style={{ flex: 1 }}
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => {
                            const newHeaders = { ...((action.action_type as any).headers || {}) };
                            const entries = Object.entries(newHeaders);
                            entries[i] = [entries[i][0], e.target.value];
                            onUpdate({
                              action_type: {
                                ...action.action_type,
                                headers: Object.fromEntries(entries),
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
          </>
        )}

        {action.action_type.type === 'ai_prompt' && (
          <>
            <textarea
              value={action.action_type.prompt || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, prompt: e.target.value }
              })}
              placeholder="Enter your prompt... (use {{previous_output}} to include previous action's result)"
              className={styles.textarea}
              rows={2}
            />
            <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}, {'{{time}}'}</p>
            
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
                          {currentModels.map(model => (
                            <option key={model} value={model}>{model}</option>
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
            <input
              type="text"
              value={(action.action_type as any).path || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, path: e.target.value }
              })}
              placeholder="File path (e.g., ~/Documents/output.txt)"
              className={styles.input}
            />
            <textarea
              value={(action.action_type as any).content || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, content: e.target.value }
              })}
              placeholder="Content to save (use {{previous_output}} to save previous action's result)"
              className={styles.textarea}
              rows={2}
            />
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
            <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}, {'{{datetime}}'}</p>
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
            <input
              type="url"
              value={(action.action_type as any).webhook_url || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, webhook_url: e.target.value }
              })}
              placeholder="Slack Webhook URL (https://hooks.slack.com/...)"
              className={styles.input}
            />
            <input
              type="text"
              value={(action.action_type as any).channel || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, channel: e.target.value }
              })}
              placeholder="Channel (e.g., #general or @user)"
              className={styles.input}
            />
            <textarea
              value={(action.action_type as any).message || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, message: e.target.value }
              })}
              placeholder="Message (use {{previous_output}} to include previous action's result)"
              className={styles.textarea}
              rows={3}
            />
            <input
              type="text"
              value={(action.action_type as any).username || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, username: e.target.value }
              })}
              placeholder="Bot username (optional)"
              className={styles.input}
            />
            <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}</p>
          </>
        )}

        {action.action_type.type === 'send_discord' && (
          <>
            <input
              type="url"
              value={(action.action_type as any).webhook_url || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, webhook_url: e.target.value }
              })}
              placeholder="Discord Webhook URL (https://discord.com/api/webhooks/...)"
              className={styles.input}
            />
            <textarea
              value={(action.action_type as any).content || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, content: e.target.value }
              })}
              placeholder="Message content (use {{previous_output}} to include previous action's result)"
              className={styles.textarea}
              rows={3}
            />
            <input
              type="text"
              value={(action.action_type as any).username || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, username: e.target.value }
              })}
              placeholder="Bot username (optional)"
              className={styles.input}
            />
            <input
              type="url"
              value={(action.action_type as any).avatar_url || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, avatar_url: e.target.value }
              })}
              placeholder="Avatar URL (optional)"
              className={styles.input}
            />
            <p className={styles.hint}>Variables: {'{{previous_output}}'}, {'{{output_1}}'}, {'{{date}}'}</p>
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
