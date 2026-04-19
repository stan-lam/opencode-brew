import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
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
        newActionType = { type: 'ai_prompt', prompt: '' };
        break;
      case 'save_file':
        newActionType = { type: 'save_file', path: '', content: '{{previous_output}}', append: false };
        break;
      default:
        return;
    }
    onUpdate({ action_type: newActionType });
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
