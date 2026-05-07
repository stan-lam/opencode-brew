import { Bot, Clock, FileText, Globe, Play, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAssistantStore, Agent } from '../store/assistantStore';
import styles from './AgentList.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

export function AgentList() {
  const { agents, selectedAgentId, selectAgent, updateAgent } = useAssistantStore();

  const handleToggleAgent = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const invoke = await getInvoke();
      await invoke('toggle_agent', { id: agent.id, enabled: !agent.enabled });
      updateAgent({ ...agent, enabled: !agent.enabled });
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    }
  };

  const getTriggerIcon = (type: string) => {
    switch (type) {
      case 'cron':
        return <Clock size={14} />;
      case 'file_watch':
        return <FileText size={14} />;
      case 'webhook':
        return <Globe size={14} />;
      default:
        return <Play size={14} />;
    }
  };

  const cronToHumanReadable = (expr: string): string => {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    
    const [min, hour, dom, _month, dow] = parts;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    const formatTime = (h: number, m: number): string => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`;
    };

    const formatHour = (h: number): string => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${hour12}${period}`;
    };

    const isSimpleNumber = (field: string): boolean => /^\d+$/.test(field);
    
    const formatDow = (d: string): string => {
      if (d === '1-5') return 'Weekdays';
      if (d === '0,6' || d === '6,0') return 'Weekends';
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

    if (min.startsWith('*/') && hour === '*') {
      const interval = parseInt(min.slice(2));
      return interval === 1 ? 'Every min' : `Every ${interval}min`;
    }
    // Hourly with hour range and day range
    if (isSimpleNumber(min) && hour.includes('-') && dom === '*' && dow !== '*') {
      return `${formatHourRange(hour)} ${formatDow(dow)}`;
    }
    // Hourly with hour range
    if (isSimpleNumber(min) && hour.includes('-') && dom === '*' && dow === '*') {
      return `Hourly ${formatHourRange(hour)}`;
    }
    if (isSimpleNumber(min) && hour === '*' && dom === '*' && dow === '*') {
      return 'Hourly';
    }
    if (isSimpleNumber(min) && hour.startsWith('*/')) {
      const interval = parseInt(hour.slice(2));
      return `Every ${interval}h`;
    }
    // Weekly single day
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && isSimpleNumber(dow)) {
      const d = parseInt(dow);
      return `${dayNames[d] || dow} ${formatTime(parseInt(hour), parseInt(min))}`;
    }
    // Weekdays or day ranges
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && dow !== '*' && !isSimpleNumber(dow)) {
      return `${formatDow(dow)} ${formatTime(parseInt(hour), parseInt(min))}`;
    }
    if (isSimpleNumber(min) && isSimpleNumber(hour) && isSimpleNumber(dom) && dow === '*') {
      const d = parseInt(dom);
      return `${d}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}/mo`;
    }
    if (isSimpleNumber(min) && isSimpleNumber(hour) && dom === '*' && dow === '*') {
      return `Daily ${formatTime(parseInt(hour), parseInt(min))}`;
    }
    return expr;
  };

  const getTriggerLabel = (agent: Agent): string => {
    if (agent.trigger.type === 'cron' && agent.trigger.expression) {
      return cronToHumanReadable(agent.trigger.expression);
    }
    return agent.trigger.type;
  };

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <h2>Agents</h2>
        <span className={styles.count}>{agents.length}</span>
      </div>
      <div className={styles.items}>
        {agents.length === 0 ? (
          <div className={styles.empty}>
            <Bot size={32} />
            <p>No agents yet</p>
            <span>Create your first agent to automate tasks</span>
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className={`${styles.item} ${selectedAgentId === agent.id ? styles.selected : ''}`}
              onClick={() => selectAgent(agent.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && selectAgent(agent.id)}
            >
              <div className={styles.itemHeader}>
                <span className={styles.itemName}>{agent.name}</span>
                <button
                  className={styles.toggleBtn}
                  onClick={(e) => handleToggleAgent(agent, e)}
                  title={agent.enabled ? 'Disable' : 'Enable'}
                >
                  {agent.enabled ? (
                    <ToggleRight size={20} className={styles.toggleOn} />
                  ) : (
                    <ToggleLeft size={20} className={styles.toggleOff} />
                  )}
                </button>
              </div>
              {agent.description && (
                <p className={styles.itemDescription}>{agent.description}</p>
              )}
              <div className={styles.itemMeta}>
                <span className={styles.triggerBadge} title={agent.trigger.type === 'cron' ? agent.trigger.expression : undefined}>
                  {getTriggerIcon(agent.trigger.type)}
                  {getTriggerLabel(agent)}
                </span>
                <span className={styles.actionCount}>
                  {agent.actions?.length ?? agent.stages?.reduce((acc, s) => acc + s.actions.length, 0) ?? 0} action{(agent.actions?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
