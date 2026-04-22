import { useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAssistantStore, Agent, Action, TriggerType, ActionType } from '../store/assistantStore';
import styles from './AgentBuilder.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

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
      trigger.expression = cronExpression;
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
            <label>Cron Expression</label>
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 * * * *"
              className={styles.input}
            />
            <span className={styles.hint}>e.g., "0 9 * * *" for daily at 9am</span>
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
  
  const handleTypeChange = (type: string) => {
    let newActionType: ActionType;
    switch (type) {
      case 'cli':
        newActionType = { type: 'cli', command: '', args: [] };
        break;
      case 'api':
        newActionType = { type: 'api', method: 'GET', url: '', headers: {} };
        break;
      case 'mcp':
        newActionType = { type: 'mcp', server_id: '', tool_name: '', arguments: {} };
        break;
      case 'ai_prompt':
        newActionType = { type: 'ai_prompt', prompt: '', system_prompt: '' };
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
            </select>
            <input
              type="text"
              value={action.action_type.url || ''}
              onChange={(e) => onUpdate({
                action_type: { ...action.action_type, url: e.target.value }
              })}
              placeholder="URL"
              className={styles.input}
            />
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
