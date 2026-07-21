import { useState, useEffect, useCallback, useContext } from 'react';
import { X, Trash2, Loader2, BarChart3, Settings, RefreshCw } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { ModelSettingsContext } from '../contexts/ModelSettingsContext';

type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';

interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

interface UsageStats {
  model: string;
  provider: string;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  request_count: number;
}

interface OverallStats {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_requests: number;
  by_model: UsageStats[];
}

interface CopilotModelMetadata {
  id: string;
  name: string;
  supports_vision: boolean;
  supports_tools: boolean;
  supported_endpoints: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  input_price: number | null;
  output_price: number | null;
  cache_price: number | null;
  reasoning_efforts: string[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_MODELS: Record<AIProvider, string[]> = {
  ollama: ['llama3', 'llama3.1', 'codellama', 'mistral', 'mixtral', 'phi3', 'gemma2', 'qwen2'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  copilot: ['auto', 'claude-haiku-4.5', 'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'gpt-5-mini'],
  custom: [],
};

const COPILOT_MODEL_LABELS: Record<string, string> = {
  auto: 'Auto (Variable)',
  'claude-haiku-4.5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4.5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6 - Medium - 264K',
  'gpt-5-mini': 'GPT-5 mini - Medium - 192K',
};

const COPILOT_MODELS_KEY = 'opencodebrew-copilot-models';
const COPILOT_METADATA_KEY = 'opencodebrew-copilot-models-metadata';

const formatContextWindow = (tokens: number | null | undefined): string => {
  if (!tokens) return '';
  if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}M`;
  return `${Math.round(tokens / 1000)}K`;
};

const formatModelLabel = (
  provider: AIProvider,
  model: string,
  metadata?: CopilotModelMetadata[]
): string => {
  if (provider === 'copilot') {
    const modelMeta = metadata?.find(m => m.id === model);
    if (modelMeta) {
      const contextStr = formatContextWindow(modelMeta.context_window);
      const reasoningStr = modelMeta.reasoning_efforts.length > 0 ? ' - Medium' : '';
      const versionMatch = model.match(/-(\d{4}-\d{2}-\d{2})$/);
      const versionSuffix = versionMatch ? ` (${versionMatch[1]})` : '';
      return `${modelMeta.name}${reasoningStr}${contextStr ? ` - ${contextStr}` : ''}${versionSuffix}`;
    }
    return COPILOT_MODEL_LABELS[model] ?? model;
  }
  return model;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { globalSettings, updateGlobalSettings } = useContext(ModelSettingsContext);
  const [activeTab, setActiveTab] = useState<'ai' | 'usage'>('ai');
  const [usageStats, setUsageStats] = useState<OverallStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [copilotModels, setCopilotModels] = useState<string[]>([]);
  const [copilotModelsMetadata, setCopilotModelsMetadata] = useState<CopilotModelMetadata[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchOllamaModels = useCallback(async (baseUrl: string, currentModel?: string) => {
    setLoadingModels(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const models = await invoke<OllamaModel[]>('list_ollama_models', { baseUrl });
      const modelNames = models.map(m => m.name);
      setOllamaModels(modelNames);
      if (modelNames.length > 0 && currentModel && !modelNames.includes(currentModel)) {
        updateGlobalSettings({ model: modelNames[0] });
      }
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error);
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [updateGlobalSettings]);

  const refreshCopilotModels = useCallback(async (currentModel?: string) => {
    setLoadingModels(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [models, metadata] = await Promise.all([
        invoke<string[]>('list_copilot_models', {}),
        invoke<CopilotModelMetadata[]>('list_copilot_models_with_metadata', {}).catch((e) => {
          console.error('Failed to fetch Copilot models metadata:', e);
          return [] as CopilotModelMetadata[];
        }),
      ]);
      setCopilotModels(models);
      setCopilotModelsMetadata(metadata);
      localStorage.setItem(COPILOT_MODELS_KEY, JSON.stringify(models));
      localStorage.setItem(COPILOT_METADATA_KEY, JSON.stringify(metadata));
      if (models.length > 0 && currentModel && !models.includes(currentModel)) {
        updateGlobalSettings({ model: models[0] });
      }
    } catch (error) {
      console.error('Failed to fetch Copilot models:', error);
    } finally {
      setLoadingModels(false);
    }
  }, [updateGlobalSettings]);

  const fetchUsageStats = useCallback(async () => {
    setLoadingUsage(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('init_usage_db');
      const stats = await invoke<OverallStats>('get_usage_stats');
      setUsageStats(stats);
    } catch (error) {
      console.error('Failed to fetch usage stats:', error);
      setUsageStats(null);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  const clearUsageHistory = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_usage_history');
      setUsageStats({
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_requests: 0,
        by_model: [],
      });
    } catch (error) {
      console.error('Failed to clear usage history:', error);
    }
  }, []);

  // Load cached copilot models on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COPILOT_MODELS_KEY);
      const storedMetadata = localStorage.getItem(COPILOT_METADATA_KEY);
      if (stored) {
        setCopilotModels(JSON.parse(stored));
      }
      if (storedMetadata) {
        setCopilotModelsMetadata(JSON.parse(storedMetadata));
      }
    } catch (e) {
      console.error('Failed to load cached copilot models:', e);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === 'usage') {
      fetchUsageStats();
    }
  }, [isOpen, activeTab, fetchUsageStats]);

  useEffect(() => {
    if (isOpen && globalSettings.provider === 'ollama') {
      fetchOllamaModels(globalSettings.ollamaUrl || 'http://localhost:11434', globalSettings.model);
    }
    // Only run on open or when ollama URL changes, not on every model/provider change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, globalSettings.ollamaUrl]);

  const currentModels = globalSettings.provider === 'ollama' && ollamaModels.length > 0
    ? ollamaModels
    : globalSettings.provider === 'copilot' && copilotModels.length > 0
    ? copilotModels
    : DEFAULT_MODELS[globalSettings.provider] || [];

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Settings size={20} />
            <h2>Settings</h2>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'ai' ? styles.active : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI Provider
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'usage' ? styles.active : ''}`}
            onClick={() => setActiveTab('usage')}
          >
            Usage
          </button>
        </div>

        <div className={styles.content}>
          {activeTab === 'ai' && (
            <section className={styles.section}>
              <h3>AI Provider</h3>
              <div className={styles.field}>
                <label>Provider</label>
                <select
                  value={globalSettings.provider}
                  onChange={(e) => {
                    const provider = e.target.value as AIProvider;
                    const models = DEFAULT_MODELS[provider];
                    updateGlobalSettings({
                      provider,
                      model: models.length > 0 ? models[0] : '',
                    });
                  }}
                  className={styles.select}
                >
                  <option value="ollama">Ollama (Local)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="copilot">GitHub Copilot</option>
                  <option value="custom">Custom API</option>
                </select>
              </div>

              <div className={styles.field}>
                <label>Model</label>
                <div className={styles.modelRow}>
                  {currentModels.length > 0 ? (
                    <select
                      value={globalSettings.model}
                      onChange={(e) => updateGlobalSettings({ model: e.target.value })}
                      className={styles.select}
                      disabled={loadingModels}
                    >
                      {currentModels.map((model) => (
                        <option key={model} value={model}>
                          {formatModelLabel(globalSettings.provider, model, copilotModelsMetadata)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={globalSettings.model}
                      onChange={(e) => updateGlobalSettings({ model: e.target.value })}
                      placeholder={loadingModels ? "Loading models..." : "Enter model name"}
                      className={styles.input}
                      disabled={loadingModels}
                    />
                  )}
                  {(globalSettings.provider === 'ollama' || globalSettings.provider === 'copilot') && (
                    <button
                      className={styles.refreshBtn}
                      onClick={() => {
                        if (globalSettings.provider === 'ollama') {
                          fetchOllamaModels(globalSettings.ollamaUrl || 'http://localhost:11434', globalSettings.model);
                        } else {
                          refreshCopilotModels(globalSettings.model);
                        }
                      }}
                      disabled={loadingModels}
                      title="Refresh models"
                    >
                      {loadingModels ? <Loader2 size={16} className={styles.spinning} /> : <RefreshCw size={16} />}
                    </button>
                  )}
                </div>
                {/* Model info panel for Copilot models */}
                {globalSettings.provider === 'copilot' && globalSettings.model !== 'auto' && (() => {
                  const modelMeta = copilotModelsMetadata?.find(m => m.id === globalSettings.model);
                  
                  if (!modelMeta) {
                    return (
                      <div className={styles.modelInfoPanel}>
                        <div className={styles.modelInfoHeader}>{globalSettings.model}</div>
                        <div className={styles.modelInfoRow} style={{ color: 'var(--text-muted)' }}>
                          <span>Pricing info not available. Click refresh to load model details.</span>
                        </div>
                      </div>
                    );
                  }
                  
                  const capabilities: string[] = [];
                  if (modelMeta.supports_vision) capabilities.push('Vision');
                  if (modelMeta.supports_tools) capabilities.push('Tools');
                  if (modelMeta.reasoning_efforts.length > 0) {
                    capabilities.push(`Thinking (${modelMeta.reasoning_efforts.join('/')})`);
                  }
                  
                  return (
                    <div className={styles.modelInfoPanel}>
                      <div className={styles.modelInfoHeader}>{modelMeta.name}</div>
                      {modelMeta.context_window && (
                        <div className={styles.modelInfoRow}>
                          <span>Context Window:</span>
                          <span>{formatContextWindow(modelMeta.context_window)}</span>
                        </div>
                      )}
                      {(modelMeta.input_price !== null || modelMeta.output_price !== null) && (
                        <>
                          <div className={styles.modelInfoSection}>Cost per 1M Tokens</div>
                          {modelMeta.input_price !== null && (
                            <div className={styles.modelInfoRow}>
                              <span>Input:</span>
                              <span>{modelMeta.input_price} Credits</span>
                            </div>
                          )}
                          {modelMeta.output_price !== null && (
                            <div className={styles.modelInfoRow}>
                              <span>Output:</span>
                              <span>{modelMeta.output_price} Credits</span>
                            </div>
                          )}
                          {modelMeta.cache_price !== null && (
                            <div className={styles.modelInfoRow}>
                              <span>Cached:</span>
                              <span>{modelMeta.cache_price} Credits</span>
                            </div>
                          )}
                        </>
                      )}
                      {capabilities.length > 0 && (
                        <div className={styles.modelInfoCapabilities}>
                          {capabilities.map(cap => (
                            <span key={cap} className={styles.capabilityBadge}>{cap}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <h3>Provider Settings</h3>
              {globalSettings.provider === 'ollama' && (
                <div className={styles.field}>
                  <label>Ollama URL</label>
                  <input
                    type="text"
                    value={globalSettings.ollamaUrl || ''}
                    onChange={(e) => updateGlobalSettings({ ollamaUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                    className={styles.input}
                  />
                </div>
              )}

              {globalSettings.provider === 'openai' && (
                <div className={styles.field}>
                  <label>OpenAI API Key</label>
                  <input
                    type="password"
                    value={globalSettings.openaiKey || ''}
                    onChange={(e) => updateGlobalSettings({ openaiKey: e.target.value })}
                    placeholder="sk-..."
                    className={styles.input}
                  />
                </div>
              )}

              {globalSettings.provider === 'anthropic' && (
                <div className={styles.field}>
                  <label>Anthropic API Key</label>
                  <input
                    type="password"
                    value={globalSettings.anthropicKey || ''}
                    onChange={(e) => updateGlobalSettings({ anthropicKey: e.target.value })}
                    placeholder="sk-ant-..."
                    className={styles.input}
                  />
                </div>
              )}

              {globalSettings.provider === 'copilot' && (
                <div className={styles.field}>
                  <p className={styles.fieldHint}>
                    GitHub Copilot uses your existing Copilot subscription. Sign in via the Launcher settings.
                  </p>
                </div>
              )}

              {globalSettings.provider === 'custom' && (
                <>
                  <div className={styles.field}>
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={globalSettings.customBaseUrl || ''}
                      onChange={(e) => updateGlobalSettings({ customBaseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      className={styles.input}
                    />
                  </div>
                  <div className={styles.field}>
                    <label>API Key</label>
                    <input
                      type="password"
                      value={globalSettings.customApiKey || ''}
                      onChange={(e) => updateGlobalSettings({ customApiKey: e.target.value })}
                      placeholder="Your API key"
                      className={styles.input}
                    />
                  </div>
                </>
              )}

              <h3>Advanced</h3>
              <div className={styles.field}>
                <label>Temperature: {globalSettings.temperature.toFixed(1)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={globalSettings.temperature}
                  onChange={(e) => updateGlobalSettings({ temperature: parseFloat(e.target.value) })}
                  className={styles.slider}
                />
                <span className={styles.sliderLabels}>
                  <span>Precise</span>
                  <span>Creative</span>
                </span>
              </div>

              <div className={styles.field}>
                <label>Max Tokens: {globalSettings.maxTokens}</label>
                <input
                  type="range"
                  min="1024"
                  max="32768"
                  step="1024"
                  value={globalSettings.maxTokens}
                  onChange={(e) => updateGlobalSettings({ maxTokens: parseInt(e.target.value) })}
                  className={styles.slider}
                />
              </div>
            </section>
          )}

          {activeTab === 'usage' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>Token Usage</h3>
                <button 
                  className={styles.clearBtn} 
                  onClick={clearUsageHistory}
                  disabled={loadingUsage || !usageStats?.total_requests}
                >
                  <Trash2 size={14} />
                  <span>Clear History</span>
                </button>
              </div>
              <p className={styles.sectionDesc}>
                Track your AI token usage across all agent executions.
              </p>

              {loadingUsage ? (
                <div className={styles.loadingState}>
                  <Loader2 size={24} className={styles.spinning} />
                  <span>Loading usage data...</span>
                </div>
              ) : usageStats ? (
                <>
                  <div className={styles.usageSummary}>
                    <div className={styles.usageCard}>
                      <div className={styles.usageValue}>{usageStats.total_requests.toLocaleString()}</div>
                      <div className={styles.usageLabel}>Total Requests</div>
                    </div>
                    <div className={styles.usageCard}>
                      <div className={styles.usageValue}>{usageStats.total_tokens.toLocaleString()}</div>
                      <div className={styles.usageLabel}>Total Tokens</div>
                    </div>
                    <div className={styles.usageCard}>
                      <div className={styles.usageValue}>{usageStats.total_prompt_tokens.toLocaleString()}</div>
                      <div className={styles.usageLabel}>Prompt Tokens</div>
                    </div>
                    <div className={styles.usageCard}>
                      <div className={styles.usageValue}>{usageStats.total_completion_tokens.toLocaleString()}</div>
                      <div className={styles.usageLabel}>Completion Tokens</div>
                    </div>
                  </div>

                  {usageStats.by_model.length > 0 && (
                    <div className={styles.usageTable}>
                      <h4>Usage by Model</h4>
                      <table>
                        <thead>
                          <tr>
                            <th>Model</th>
                            <th>Provider</th>
                            <th>Requests</th>
                            <th>Prompt</th>
                            <th>Completion</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageStats.by_model.map((stat, idx) => (
                            <tr key={idx}>
                              <td>{stat.model}</td>
                              <td className={styles.providerCell}>{stat.provider}</td>
                              <td>{stat.request_count.toLocaleString()}</td>
                              <td>{stat.total_prompt_tokens.toLocaleString()}</td>
                              <td>{stat.total_completion_tokens.toLocaleString()}</td>
                              <td>{stat.total_tokens.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {usageStats.by_model.length === 0 && (
                    <div className={styles.emptyState}>
                      <BarChart3 size={48} />
                      <p>No usage data yet</p>
                      <span>Token usage will appear here as agents run.</span>
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.emptyState}>
                  <BarChart3 size={48} />
                  <p>Unable to load usage data</p>
                  <span>There was an error loading usage statistics.</span>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
