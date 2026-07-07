import { useState, useEffect, useMemo } from 'react';
import { Ban, CheckCircle, XCircle, Loader2, Clock, ChevronRight, ChevronDown, RefreshCw, Layers, Zap, Mail, MessageSquare, Send } from 'lucide-react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAssistantStore, ExecutionLog, ActionLog, NotificationSettings } from '../store/assistantStore';
import { MermaidDiagram } from './MermaidDiagram';
import styles from './ExecutionHistory.module.css';

interface GroupedActions {
  stageName: string;
  stageIndex: number;
  actions: ActionLog[];
  isParallel: boolean;
}

interface OutputDeliveryConfig {
  emailEnabled: boolean;
  emailFrom: string;
  emailTo: string;
  emailSubject: string;
  emailSmtpUsername: string;
  smtpHost: string;
  smtpPort: number;
  useTls: boolean;
  smtpPassword: string;
  slackEnabled: boolean;
  slackWebhook: string;
  slackChannel: string;
  slackUsername: string;
  discordEnabled: boolean;
  discordWebhook: string;
  discordUsername: string;
  discordAvatarUrl: string;
}

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

// Group actions by stage based on output patterns
function groupActionsByStage(actions: ActionLog[], output?: string | null): GroupedActions[] {
  if (!output) {
    // No output to parse, return each action as its own "stage"
    return actions.map((action, idx) => ({
      stageName: `Step ${idx + 1}`,
      stageIndex: idx,
      actions: [action],
      isParallel: false,
    }));
  }
  
  // Parse stages from output (format: "=== Stage N: Name ===")
  const stageMatches = output.matchAll(/=== Stage (\d+): (.+?) ===/g);
  const stageInfo: { index: number; name: string }[] = [];
  for (const match of stageMatches) {
    stageInfo.push({ index: parseInt(match[1]) - 1, name: match[2] });
  }
  
  if (stageInfo.length === 0) {
    // No stage info found, return each action as its own stage
    return actions.map((action, idx) => ({
      stageName: `Step ${idx + 1}`,
      stageIndex: idx,
      actions: [action],
      isParallel: false,
    }));
  }
  
  // Group actions by stage
  const groups: GroupedActions[] = [];
  let currentActionIdx = 0;
  
  for (const stage of stageInfo) {
    // Count actions in this stage by looking at output
    const stageOutputStart = output.indexOf(`=== Stage ${stage.index + 1}:`);
    const nextStageStart = output.indexOf(`=== Stage ${stage.index + 2}:`);
    const stageSection = nextStageStart > 0 
      ? output.slice(stageOutputStart, nextStageStart)
      : output.slice(stageOutputStart);
    
    // Count [action_name] patterns in this stage section
    const actionMatches = stageSection.match(/\[([^\]]+)\] (Success|Error):/g) || [];
    const actionsInStage = Math.max(1, actionMatches.length);
    
    const stageActions = actions.slice(currentActionIdx, currentActionIdx + actionsInStage);
    if (stageActions.length > 0) {
      groups.push({
        stageName: stage.name,
        stageIndex: stage.index,
        actions: stageActions,
        isParallel: stageActions.length > 1,
      });
    }
    currentActionIdx += actionsInStage;
  }
  
  // Add any remaining actions
  if (currentActionIdx < actions.length) {
    const remaining = actions.slice(currentActionIdx);
    groups.push({
      stageName: `Step ${groups.length + 1}`,
      stageIndex: groups.length,
      actions: remaining,
      isParallel: remaining.length > 1,
    });
  }
  
  return groups;
}

// Convert scheduler output format to markdown for better rendering
function formatOutputAsMarkdown(output: string): string {
  let result = output;
  
  // Convert stage headers: === Stage N: Name === -> ## Stage N: Name
  result = result.replace(/=== Stage (\d+): (.+?) ===/g, '\n## Stage $1: $2\n');
  
  // Convert action success markers: [Action Name] Success: -> **Action Name** ✓
  result = result.replace(/\[([^\]]+)\] Success:/g, '\n**$1** ✓\n');
  
  // Convert action error markers: [Action Name] Error: -> **Action Name** ✗
  result = result.replace(/\[([^\]]+)\] Error:/g, '\n**$1** ✗\n');
  
  // Clean up multiple newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}

function mapNotificationSettingsToSendConfig(settings?: NotificationSettings): OutputDeliveryConfig {
  const resolved = settings ?? DEFAULT_NOTIFICATION_SETTINGS;
  return {
    emailEnabled: resolved.email.enabled,
    emailFrom: resolved.email.from,
    emailTo: resolved.email.to,
    emailSubject: resolved.email.subject,
    emailSmtpUsername: resolved.email.smtpUsername,
    smtpHost: resolved.email.smtpHost || 'smtp.gmail.com',
    smtpPort: resolved.email.smtpPort || 587,
    useTls: resolved.email.useTls ?? true,
    smtpPassword: resolved.email.password,
    slackEnabled: resolved.slack.enabled,
    slackWebhook: resolved.slack.webhookUrl,
    slackChannel: resolved.slack.channel,
    slackUsername: resolved.slack.username,
    discordEnabled: resolved.discord.enabled,
    discordWebhook: resolved.discord.webhookUrl,
    discordUsername: resolved.discord.username,
    discordAvatarUrl: resolved.discord.avatarUrl,
  };
}

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

const REFRESH_INTERVAL = 3000; // auto-refresh every 3 seconds

export function ExecutionHistory() {
  const { executions, agents, setExecutions } = useAssistantStore();
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null);
  const [executionDetails, setExecutionDetails] = useState<{
    execution: ExecutionLog;
    actions: ActionLog[];
  } | null>(null);
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set([0]));
  const [fullOutputExpanded, setFullOutputExpanded] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showSendOutputModal, setShowSendOutputModal] = useState(false);
  const [isSendingOutput, setIsSendingOutput] = useState(false);
  const [sendOutputError, setSendOutputError] = useState<string | null>(null);
  const [sendOutputSuccess, setSendOutputSuccess] = useState<string | null>(null);
  const [sendConfig, setSendConfig] = useState<OutputDeliveryConfig>(
    mapNotificationSettingsToSendConfig()
  );

  const markdownComponents: Components = useMemo(() => ({
    code({ className, children, ...props }) {
      const match = /language-mermaid/.exec(className || '');
      if (match) {
        return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  }), []);

  const toggleStage = (index: number) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAllStages = (groups: GroupedActions[]) => {
    setExpandedStages(new Set(groups.map((_, i) => i)));
  };

  const loadExecutions = async () => {
    try {
      const invoke = await getInvoke();
      const result = await invoke('list_executions', { agentId: null, limit: 100 });
      setExecutions(result as ExecutionLog[]);
    } catch (error) {
      console.error('Failed to load executions:', error);
    }
  };

  const loadExecutionDetails = async (id: string) => {
    try {
      const invoke = await getInvoke();
      const [execution, actions] = await invoke('get_execution_details', { executionId: id }) as [ExecutionLog, ActionLog[]];
      setExecutionDetails({ execution, actions });
    } catch (error) {
      console.error('Failed to load execution details:', error);
    }
  };

  // Auto-refresh execution list periodically
  useEffect(() => {
    loadExecutions();
    const interval = setInterval(loadExecutions, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh selected execution details (catches status changes like running -> success/failed)
  useEffect(() => {
    if (!selectedExecution) {
      setExecutionDetails(null);
      return;
    }
    loadExecutionDetails(selectedExecution);
    const interval = setInterval(() => loadExecutionDetails(selectedExecution), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedExecution]);

  useEffect(() => {
    setShowSendOutputModal(false);
    setSendOutputError(null);
    setSendOutputSuccess(null);
    if (executionDetails) {
      setSendConfig(
        mapNotificationSettingsToSendConfig(
          getAgentNotificationSettings(executionDetails.execution.agent_id)
        )
      );
    } else {
      setSendConfig(mapNotificationSettingsToSendConfig());
    }
  }, [selectedExecution]);

  const getAgentName = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || 'Unknown Agent';
  };

  const getAgentNotificationSettings = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={16} className={styles.statusSuccess} />;
      case 'failed':
        return <XCircle size={16} className={styles.statusFailed} />;
      case 'running':
        return <Loader2 size={16} className={styles.statusRunning} />;
      case 'cancelled':
        return <Ban size={16} className={styles.statusCancelled} />;
      default:
        return <Clock size={16} className={styles.statusPending} />;
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'Running...';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const buildDefaultEmailSubject = () => {
    if (!executionDetails) return 'Execution output';
    const agentName = getAgentName(executionDetails.execution.agent_id);
    const status = executionDetails.execution.status;
    return `${agentName} execution output (${status})`;
  };

  const buildOutputMessage = () => {
    if (!executionDetails?.execution.output) return '';
    const exec = executionDetails.execution;
    const headerLines = [
      `Agent: ${getAgentName(exec.agent_id)}`,
      `Status: ${exec.status}`,
      `Started: ${formatTime(exec.started_at)}`,
      `Duration: ${formatDuration(exec.started_at, exec.finished_at)}`,
      `Trigger: ${exec.trigger_type}`,
    ];
    const formattedOutput = formatOutputAsMarkdown(exec.output);
    return `${headerLines.join('\n')}\n\n${formattedOutput}`;
  };

  const buildDeliveryPayload = (config: OutputDeliveryConfig) => {
    const errors: string[] = [];
    const outputMessage = buildOutputMessage();
    const payload: {
      email?: {
        from: string;
        to: string;
        subject: string;
        body: string;
        smtpUsername?: string;
        smtpHost: string;
        smtpPort: number;
        useTls: boolean;
        password: string;
      };
      slack?: {
        webhookUrl: string;
        channel: string;
        message: string;
        username?: string;
      };
      discord?: {
        webhookUrl: string;
        content: string;
        username?: string;
        avatarUrl?: string;
      };
    } = {};

    if (config.emailEnabled) {
      if (!config.emailFrom.trim()) errors.push('Email: "From" is required.');
      if (!config.emailTo.trim()) errors.push('Email: "To" is required.');
      if (!config.smtpHost.trim()) errors.push('Email: SMTP host is required.');
      if (!config.smtpPassword.trim()) errors.push('Email: SMTP password is required.');
      const smtpUsername = config.emailSmtpUsername.trim();
      payload.email = {
        from: config.emailFrom,
        to: config.emailTo,
        subject: config.emailSubject.trim() || buildDefaultEmailSubject(),
        body: outputMessage,
        smtpUsername: smtpUsername ? smtpUsername : undefined,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        useTls: config.useTls,
        password: config.smtpPassword,
      };
    }

    if (config.slackEnabled) {
      if (!config.slackWebhook.trim()) errors.push('Slack: webhook URL is required.');
      if (!config.slackChannel.trim()) errors.push('Slack: channel is required.');
      payload.slack = {
        webhookUrl: config.slackWebhook,
        channel: config.slackChannel,
        message: outputMessage,
        username: config.slackUsername.trim() || undefined,
      };
    }

    if (config.discordEnabled) {
      if (!config.discordWebhook.trim()) errors.push('Discord: webhook URL is required.');
      payload.discord = {
        webhookUrl: config.discordWebhook,
        content: outputMessage,
        username: config.discordUsername.trim() || undefined,
        avatarUrl: config.discordAvatarUrl.trim() || undefined,
      };
    }

    if (!payload.email && !payload.slack && !payload.discord) {
      errors.push('Select at least one delivery target.');
    }

    return { payload, errors };
  };

  const openSendOutputModal = (
    useAgentDefaults: boolean = true,
    overrideConfig?: OutputDeliveryConfig,
    preserveStatus: boolean = false,
  ) => {
    if (!executionDetails?.execution.output) return;
    if (!preserveStatus) {
      setSendOutputError(null);
      setSendOutputSuccess(null);
    }
    const baseConfig = overrideConfig
      ?? (useAgentDefaults && executionDetails
        ? mapNotificationSettingsToSendConfig(
          getAgentNotificationSettings(executionDetails.execution.agent_id)
        )
        : sendConfig);
    setSendConfig({
      ...baseConfig,
      emailSubject: baseConfig.emailSubject.trim() ? baseConfig.emailSubject : buildDefaultEmailSubject(),
    });
    setShowSendOutputModal(true);
  };

  const closeSendOutputModal = () => {
    setShowSendOutputModal(false);
    setSendOutputError(null);
    setSendOutputSuccess(null);
  };

  const handleSendOutput = async () => {
    if (!executionDetails?.execution.output) return;
    const { payload, errors } = buildDeliveryPayload(sendConfig);
    if (errors.length > 0) {
      setSendOutputError(errors.join('\n'));
      setSendOutputSuccess(null);
      return;
    }
    await sendOutputPayload(payload, sendConfig);
  };

  const sendOutputPayload = async (
    payload: Record<string, unknown>,
    configForModal?: OutputDeliveryConfig,
  ) => {
    setIsSendingOutput(true);
    setSendOutputError(null);
    setSendOutputSuccess(null);
    try {
      const invoke = await getInvoke();
      const result = await invoke('send_execution_output', { request: payload }) as string[];
      setSendOutputSuccess(result.join(' • '));
    } catch (error) {
      setSendOutputError(`Failed to send output: ${error}`);
      if (!showSendOutputModal) {
        openSendOutputModal(false, configForModal ?? sendConfig, true);
      }
    } finally {
      setIsSendingOutput(false);
    }
  };

  const handleSendOutputClick = async () => {
    if (!executionDetails?.execution.output) return;
    const nextConfig = mapNotificationSettingsToSendConfig(
      getAgentNotificationSettings(executionDetails.execution.agent_id)
    );
    setSendConfig({
      ...nextConfig,
      emailSubject: nextConfig.emailSubject.trim() ? nextConfig.emailSubject : buildDefaultEmailSubject(),
    });
    const { payload, errors } = buildDeliveryPayload(nextConfig);
    if (errors.length > 0) {
      openSendOutputModal(false, nextConfig);
      return;
    }
    await sendOutputPayload(payload, nextConfig);
  };

  const handleCancelExecution = async () => {
    if (!executionDetails) return;
    setIsCancelling(true);
    try {
      const invoke = await getInvoke();
      await invoke('cancel_execution', { executionId: executionDetails.execution.id });
      await loadExecutionDetails(executionDetails.execution.id);
      await loadExecutions();
    } catch (error) {
      console.error('Failed to cancel execution:', error);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <h2>Execution History</h2>
          <button onClick={loadExecutions} className={styles.refreshBtn}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className={styles.listContent}>
          {(() => {
            const uniqueExecutions = [...new Map(executions.map(e => [e.id, e])).values()];
            return uniqueExecutions.length === 0 ? (
              <div className={styles.empty}>
                <Clock size={32} />
                <p>No executions yet</p>
              </div>
            ) : (
              uniqueExecutions.map((exec) => (
                <button
                  key={`exec-${exec.id}`}
                  className={`${styles.item} ${selectedExecution === exec.id ? styles.selected : ''}`}
                  onClick={() => setSelectedExecution(exec.id)}
                >
                  <div className={styles.itemHeader}>
                    {getStatusIcon(exec.status)}
                    <span className={styles.agentName}>{getAgentName(exec.agent_id)}</span>
                    <ChevronRight size={16} className={styles.chevron} />
                  </div>
                  <div className={styles.itemMeta}>
                    <span>{formatTime(exec.started_at)}</span>
                    <span>{formatDuration(exec.started_at, exec.finished_at)}</span>
                  </div>
                </button>
              ))
            );
          })()}
        </div>
      </div>

      <div className={styles.detail}>
        {executionDetails ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderRow}>
                <div>
                  <h3>{getAgentName(executionDetails.execution.agent_id)}</h3>
                  <span className={`${styles.statusBadge} ${styles[executionDetails.execution.status]}`}>
                    {executionDetails.execution.status}
                  </span>
                </div>
                {executionDetails.execution.status === 'running' && (
                  <button
                    className={styles.cancelExecutionBtn}
                    onClick={handleCancelExecution}
                    disabled={isCancelling}
                  >
                    <Ban size={14} />
                    {isCancelling ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
              <div className={styles.detailMeta}>
                <span>Started: {formatTime(executionDetails.execution.started_at)}</span>
                <span>Duration: {formatDuration(executionDetails.execution.started_at, executionDetails.execution.finished_at)}</span>
                <span>Trigger: {executionDetails.execution.trigger_type}</span>
              </div>
            </div>

            <div className={styles.detailContent}>
              <div className={styles.actionLogs}>
                <h4>
                  <Layers size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  Workflow Stages
                </h4>
                {(() => {
                  const groups = groupActionsByStage(executionDetails.actions, executionDetails.execution.output);
                  return groups.map((group) => (
                    <div key={`stage-${group.stageIndex}`} className={styles.stageGroup}>
                      <div 
                        className={styles.stageGroupHeader}
                        onClick={() => toggleStage(group.stageIndex)}
                      >
                        <ChevronRight 
                          size={14} 
                          className={`${styles.stageExpandIcon} ${expandedStages.has(group.stageIndex) ? styles.expanded : ''}`}
                        />
                        <span className={styles.stageNumber}>{group.stageIndex + 1}</span>
                        <span className={styles.stageName}>{group.stageName}</span>
                        {group.isParallel && (
                          <span className={styles.parallelBadge}>
                            <Zap size={12} />
                            {group.actions.length} parallel
                          </span>
                        )}
                      </div>
                      <div className={`${styles.stageContent} ${expandedStages.has(group.stageIndex) ? styles.expanded : styles.collapsed}`}>
                        <div className={group.isParallel ? styles.parallelActionsContainer : styles.sequentialActionsContainer}>
                          {group.actions.map((action) => (
                            <div key={`act-${action.id}`} className={`${styles.actionLog} ${styles[action.status]}`}>
                              <div className={styles.actionLogHeader}>
                                {getStatusIcon(action.status)}
                                <span className={styles.actionName}>{action.action_name}</span>
                                <span className={styles.actionDuration}>
                                  {formatDuration(action.started_at, action.finished_at)}
                                </span>
                              </div>
                              {action.output && (
                                <div className={styles.output}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{action.output}</ReactMarkdown>
                                </div>
                              )}
                              {action.error && (
                                <pre className={styles.error}>{action.error}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {executionDetails.execution.output && (
                <div className={styles.fullOutput}>
                <div className={styles.fullOutputHeader}>
                  <h4 onClick={() => setFullOutputExpanded(!fullOutputExpanded)}>
                    <ChevronRight 
                      size={14} 
                      className={`${styles.stageExpandIcon} ${fullOutputExpanded ? styles.expanded : ''}`}
                    />
                    Full Output
                  </h4>
                  <div className={styles.sendActions}>
                    <button
                      className={styles.editDefaultsBtn}
                      onClick={() => openSendOutputModal(true)}
                      disabled={!executionDetails.execution.output || isSendingOutput}
                    >
                      Edit Defaults
                    </button>
                    <button
                      className={styles.sendOutputBtn}
                      onClick={handleSendOutputClick}
                      disabled={!executionDetails.execution.output || isSendingOutput}
                    >
                      <Send size={14} />
                      {isSendingOutput ? 'Sending...' : 'Send Output'}
                    </button>
                  </div>
                </div>
                {!showSendOutputModal && (sendOutputError || sendOutputSuccess) && (
                  <div className={`${styles.sendStatus} ${sendOutputError ? styles.sendStatusError : styles.sendStatusSuccess}`}>
                    {sendOutputError || sendOutputSuccess}
                  </div>
                )}
                  {fullOutputExpanded && (
                    <div className={styles.fullOutputContent}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {formatOutputAsMarkdown(executionDetails.execution.output)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <Clock size={48} />
            <p>Select an execution to view details</p>
          </div>
        )}
      </div>
      {showSendOutputModal && executionDetails && (
        <div className={styles.modalOverlay} onClick={closeSendOutputModal}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Send full output</h3>
                <p>Share this execution's full output via email or chat.</p>
              </div>
              <button className={styles.modalClose} onClick={closeSendOutputModal}>
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.deliverySection}>
                <label className={styles.deliveryHeader}>
                  <input
                    type="checkbox"
                    checked={sendConfig.emailEnabled}
                    onChange={(event) => setSendConfig((prev) => ({ ...prev, emailEnabled: event.target.checked }))}
                  />
                  <Mail size={16} />
                  <span>Email</span>
                </label>
                {sendConfig.emailEnabled && (
                  <div className={styles.deliveryFields}>
                    <div className={styles.formRow}>
                      <label>From</label>
                      <input
                        className={styles.input}
                        type="email"
                        value={sendConfig.emailFrom}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, emailFrom: event.target.value }))}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>To</label>
                      <input
                        className={styles.input}
                        type="email"
                        value={sendConfig.emailTo}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, emailTo: event.target.value }))}
                        placeholder="team@example.com"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Subject</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.emailSubject}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, emailSubject: event.target.value }))}
                        placeholder={buildDefaultEmailSubject()}
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>SMTP host</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.smtpHost}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, smtpHost: event.target.value }))}
                        placeholder="smtp.gmail.com"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>SMTP username (optional)</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.emailSmtpUsername}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, emailSmtpUsername: event.target.value }))}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>SMTP port</label>
                      <input
                        className={styles.input}
                        type="number"
                        value={sendConfig.smtpPort}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, smtpPort: Number(event.target.value) || 0 }))}
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Password / app key</label>
                      <input
                        className={styles.input}
                        type="password"
                        value={sendConfig.smtpPassword}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, smtpPassword: event.target.value }))}
                        placeholder="App password"
                      />
                    </div>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={sendConfig.useTls}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, useTls: event.target.checked }))}
                      />
                      Use TLS
                    </label>
                  </div>
                )}
              </div>

              <div className={styles.deliverySection}>
                <label className={styles.deliveryHeader}>
                  <input
                    type="checkbox"
                    checked={sendConfig.slackEnabled}
                    onChange={(event) => setSendConfig((prev) => ({ ...prev, slackEnabled: event.target.checked }))}
                  />
                  <MessageSquare size={16} />
                  <span>Slack</span>
                </label>
                {sendConfig.slackEnabled && (
                  <div className={styles.deliveryFields}>
                    <div className={styles.formRow}>
                      <label>Webhook URL</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.slackWebhook}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, slackWebhook: event.target.value }))}
                        placeholder="https://hooks.slack.com/services/..."
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Channel</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.slackChannel}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, slackChannel: event.target.value }))}
                        placeholder="#alerts"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Username (optional)</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.slackUsername}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, slackUsername: event.target.value }))}
                        placeholder="OpenCodeAssistant"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.deliverySection}>
                <label className={styles.deliveryHeader}>
                  <input
                    type="checkbox"
                    checked={sendConfig.discordEnabled}
                    onChange={(event) => setSendConfig((prev) => ({ ...prev, discordEnabled: event.target.checked }))}
                  />
                  <MessageSquare size={16} />
                  <span>Discord</span>
                </label>
                {sendConfig.discordEnabled && (
                  <div className={styles.deliveryFields}>
                    <div className={styles.formRow}>
                      <label>Webhook URL</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.discordWebhook}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, discordWebhook: event.target.value }))}
                        placeholder="https://discord.com/api/webhooks/..."
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Username (optional)</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.discordUsername}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, discordUsername: event.target.value }))}
                        placeholder="OpenCodeAssistant"
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>Avatar URL (optional)</label>
                      <input
                        className={styles.input}
                        type="text"
                        value={sendConfig.discordAvatarUrl}
                        onChange={(event) => setSendConfig((prev) => ({ ...prev, discordAvatarUrl: event.target.value }))}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                )}
              </div>

              {sendOutputError && <div className={styles.errorText}>{sendOutputError}</div>}
              {sendOutputSuccess && <div className={styles.successText}>{sendOutputSuccess}</div>}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.cancelButton} onClick={closeSendOutputModal} disabled={isSendingOutput}>
                Cancel
              </button>
              <button
                className={styles.sendButton}
                onClick={handleSendOutput}
                disabled={isSendingOutput || !executionDetails.execution.output}
              >
                {isSendingOutput ? 'Sending...' : 'Send Output'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
