import { useState, useEffect, useCallback } from 'react';
import { X, Save, Moon, Sun, Monitor, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, Loader2, BarChart3 } from 'lucide-react';
import styles from './SettingsModal.module.css';

type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';

interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
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

interface CopilotLoginStatus {
  logged_in: boolean;
}

interface CopilotDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in?: number;
  interval?: number;
}

interface CopilotCachedAccount {
  host: string;
  username: string;
  source: string;
  last_used?: string;
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

interface Settings {
  theme: 'dark' | 'light' | 'system';
  aiProvider: AIProvider;
  model: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  copilotClientId: string;
  copilotClientSecret: string;
  copilotAuthHost: string;
  copilotAuthMode: 'github' | 'enterprise';
  copilotEnterpriseType: 'ghe' | 'ghes';
  customBaseUrl: string;
  customApiKey: string;
  temperature: number;
  maxTokens: number;
  thinkAloud: boolean;
  mcpServers: MCPServer[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'opencodebrew-settings';
const COPILOT_MODELS_KEY = 'opencodebrew-copilot-models';
const COPILOT_METADATA_KEY = 'opencodebrew-copilot-models-metadata';

// Format context window tokens to human readable string
const formatContextWindow = (tokens: number | null | undefined): string => {
  if (!tokens) return '';
  if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}M`;
  return `${Math.round(tokens / 1000)}K`;
};

const BUILT_IN_MCP_SERVERS: MCPServer[] = [
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance MCP',
    command: 'npx',
    args: ['-y', 'yfinance-mcp'],
    env: {},
    enabled: false,
  },
  {
    id: 'brave-search',
    name: 'Brave Search MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    enabled: false,
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {},
    enabled: false,
  },
  {
    id: 'github',
    name: 'GitHub MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    enabled: false,
  },
];

const DEFAULT_MODELS: Record<AIProvider, string[]> = {
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
  // Hyphen format (claude-opus-4-5) - actual API model IDs
  'claude-haiku-4-5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4-5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6 - Medium - 264K',
  // Dot format (legacy/display names)
  'claude-haiku-4.5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4.5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6 - Medium - 264K',
  'gpt-5-mini': 'GPT-5 mini - Medium - 192K',
  'gpt-5.3-codex': 'GPT-5.3-Codex - Medium - 400K',
};

const formatModelLabel = (
  provider: AIProvider,
  model: string,
  metadata?: CopilotModelMetadata[]
): string => {
  if (provider === 'copilot') {
    // Try to get dynamic metadata first
    const modelMeta = metadata?.find(m => m.id === model);
    if (modelMeta) {
      const contextStr = formatContextWindow(modelMeta.context_window);
      const reasoningStr = modelMeta.reasoning_efforts.length > 0 ? ' - Medium' : '';
      // Include version suffix for dated models to avoid duplicates
      const versionMatch = model.match(/-(\d{4}-\d{2}-\d{2})$/);
      const versionSuffix = versionMatch ? ` (${versionMatch[1]})` : '';
      return `${modelMeta.name}${reasoningStr}${contextStr ? ` - ${contextStr}` : ''}${versionSuffix}`;
    }
    // Fallback to hardcoded labels
    return COPILOT_MODEL_LABELS[model] ?? model;
  }
  return model;
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>({
    theme: 'dark',
    aiProvider: 'ollama',
    model: 'llama3',
    ollamaUrl: 'http://localhost:11434',
    openaiKey: '',
    anthropicKey: '',
    copilotClientId: '',
    copilotClientSecret: '',
    copilotAuthHost: 'github.com',
    copilotAuthMode: 'github',
    copilotEnterpriseType: 'ghes',
    customBaseUrl: '',
    customApiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
    thinkAloud: false,
    mcpServers: BUILT_IN_MCP_SERVERS,
  });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'mcp' | 'usage'>('general');
  const [expandedMcp, setExpandedMcp] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [usageStats, setUsageStats] = useState<OverallStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [copilotLoggedIn, setCopilotLoggedIn] = useState<boolean | null>(null);
  const [copilotPolling, setCopilotPolling] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotModels, setCopilotModels] = useState<string[]>([]);
  const [copilotModelsMetadata, setCopilotModelsMetadata] = useState<CopilotModelMetadata[]>([]);
  const [copilotAccounts, setCopilotAccounts] = useState<CopilotCachedAccount[]>([]);
  const [copilotAccountsLoading, setCopilotAccountsLoading] = useState(false);
  const [copilotAccountsError, setCopilotAccountsError] = useState<string | null>(null);
  const [copilotAccountsNotice, setCopilotAccountsNotice] = useState<string | null>(null);
  const [copilotUseDeveloperOAuth, setCopilotUseDeveloperOAuth] = useState(false);
  const [showCopilotAccountPicker, setShowCopilotAccountPicker] = useState(false);
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<CopilotDeviceCode | null>(null);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [enterpriseTypeDraft, setEnterpriseTypeDraft] = useState<'ghe' | 'ghes'>('ghes');
  const [enterpriseHostDraft, setEnterpriseHostDraft] = useState('');
  const [enterpriseModalError, setEnterpriseModalError] = useState<string | null>(null);
  const [enterpriseLoginStarted, setEnterpriseLoginStarted] = useState(false);
  const [pendingEnterpriseLogin, setPendingEnterpriseLogin] = useState(false);

  const resolveEnterpriseHost = useCallback((value: string, type: 'ghe' | 'ghes') => {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const stripProtocol = (input: string) =>
      input.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (type === 'ghe') {
      if (trimmed.includes('://')) {
        try {
          return new URL(trimmed).host;
        } catch {
          return stripProtocol(trimmed);
        }
      }
      const normalized = stripProtocol(trimmed);
      if (normalized.includes('.')) {
        return normalized;
      }
      return `${normalized}.ghe.com`;
    }
    return stripProtocol(trimmed);
  }, []);

  const copilotAuthMode = settings.copilotAuthMode || 'github';
  const copilotEnterpriseType = (settings.copilotEnterpriseType || 'ghes') as 'ghe' | 'ghes';
  const enterpriseHostInput = settings.copilotAuthHost.trim();
  const resolvedEnterpriseHost = resolveEnterpriseHost(enterpriseHostInput, copilotEnterpriseType);
  const draftResolvedEnterpriseHost = resolveEnterpriseHost(enterpriseHostDraft, enterpriseTypeDraft);
  const copilotAuthHost = copilotAuthMode === 'enterprise'
    ? resolvedEnterpriseHost
    : 'github.com';
  const copilotEnterpriseClientId = settings.copilotClientId.trim();
  const copilotNeedsEnterpriseHost = copilotAuthMode === 'enterprise' && !enterpriseHostInput;
  const copilotCanStartDeviceFlow = copilotAuthMode === 'enterprise' || !copilotNeedsEnterpriseHost;

  const fetchOllamaModels = useCallback(async (baseUrl: string) => {
    setLoadingModels(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const models = await invoke<OllamaModel[]>('list_ollama_models', { baseUrl });
      const modelNames = models.map(m => m.name);
      setOllamaModels(modelNames);
      if (modelNames.length > 0 && !modelNames.includes(settings.model)) {
        setSettings(s => ({ ...s, model: modelNames[0] }));
      }
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error);
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [settings.model]);

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

  const openCopilotVerification = useCallback(async (url: string) => {
    if (!url) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:shell|open', { path: url });
    } catch (error) {
      console.error('Failed to open Copilot verification URL:', error);
    }
  }, []);

  const copyCopilotCode = useCallback(async (code: string) => {
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (error) {
      console.error('Failed to copy Copilot code:', error);
    }
  }, []);

  const applyCopilotModels = useCallback((models: string[], metadata?: CopilotModelMetadata[], persist = true) => {
    setCopilotModels(models);
    if (metadata) {
      setCopilotModelsMetadata(metadata);
    }
    if (models.length > 0 && settings.aiProvider === 'copilot' && !models.includes(settings.model)) {
      setSettings((prev) => ({ ...prev, model: models[0] }));
    }
    // Persist to localStorage for both launcher and IDE to use
    if (persist && models.length > 0) {
      localStorage.setItem(COPILOT_MODELS_KEY, JSON.stringify(models));
      if (metadata) {
        localStorage.setItem(COPILOT_METADATA_KEY, JSON.stringify(metadata));
      }
      console.log('[Launcher] Persisted copilot models to localStorage:', models.length);
    }
  }, [settings.aiProvider, settings.model]);

  const loadCachedCopilotModels = useCallback(async () => {
    // First try localStorage (faster)
    try {
      const stored = localStorage.getItem(COPILOT_MODELS_KEY);
      const storedMetadata = localStorage.getItem(COPILOT_METADATA_KEY);
      if (stored) {
        const models = JSON.parse(stored) as string[];
        const metadata = storedMetadata ? JSON.parse(storedMetadata) as CopilotModelMetadata[] : undefined;
        if (models.length > 0) {
          console.log('[Launcher] Loaded copilot models from localStorage:', models.length);
          applyCopilotModels(models, metadata, false); // Don't re-persist
        }
      }
    } catch (e) {
      console.error('Failed to load copilot models from localStorage:', e);
    }
    
    // Then try backend cache
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const host = copilotAuthMode === 'enterprise' ? copilotAuthHost || undefined : undefined;
      const cached = await invoke<string[]>('copilot_cached_models_list', { host });
      if (cached.length > 0) {
        applyCopilotModels(cached, undefined);
      }
      return cached;
    } catch (error) {
      console.error('Failed to load cached Copilot models:', error);
      return [] as string[];
    }
  }, [applyCopilotModels, copilotAuthMode, copilotAuthHost]);

  const refreshCopilotModels = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const host = copilotAuthMode === 'enterprise' ? copilotAuthHost || undefined : undefined;
      const enterpriseType = copilotAuthMode === 'enterprise' ? copilotEnterpriseType : undefined;
      
      // Fetch models and metadata in parallel
      const [models, metadata] = await Promise.all([
        invoke<string[]>('list_copilot_models', { host, enterpriseType }),
        invoke<CopilotModelMetadata[]>('list_copilot_models_with_metadata', { host, enterpriseType }).catch((e) => {
          console.error('Failed to fetch Copilot models metadata:', e);
          return [] as CopilotModelMetadata[];
        }),
      ]);
      
      applyCopilotModels(models, metadata);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to fetch Copilot models.';
      console.error('Failed to fetch Copilot models:', error);
      if (message.toLowerCase().includes('403') || message.toLowerCase().includes('forbidden')) {
        const cached = await loadCachedCopilotModels();
        if (cached.length > 0) {
          return;
        }
      }
    }
  }, [
    applyCopilotModels,
    loadCachedCopilotModels,
    copilotAuthMode,
    copilotAuthHost,
    copilotEnterpriseType,
  ]);

  const reloadCopilotAccounts = useCallback(async (): Promise<CopilotCachedAccount[]> => {
    setCopilotAccountsError(null);
    setCopilotAccountsLoading(true);
    try {
      if (copilotAuthMode === 'enterprise' && !copilotAuthHost) {
        setCopilotAccounts([]);
        setCopilotAccountsError('Enter your Enterprise host to load cached accounts.');
        return [];
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const cached = await invoke<CopilotCachedAccount[]>('copilot_cached_accounts_list', {
        host: copilotAuthHost || undefined,
      });
      console.debug('[copilot] reload accounts', cached);
      setCopilotAccounts(cached);
      if (cached.length > 0) {
        setCopilotAccountsError(null);
        setCopilotAccountsNotice(null);
        if (enterpriseLoginStarted) {
          setEnterpriseLoginStarted(false);
        }
      } else if (!enterpriseLoginStarted) {
        setCopilotAccountsError('No Copilot accounts found for this host.');
      } else {
        setCopilotAccountsError(null);
      }
      return cached;
    } catch (error) {
      console.debug('[copilot] reload accounts failed', error);
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to load Copilot accounts.';
      setCopilotAccountsError(message);
      return [];
    } finally {
      setCopilotAccountsLoading(false);
    }
  }, [copilotAuthHost, copilotAuthMode, enterpriseLoginStarted]);

  const handleCopilotLogin = useCallback(async () => {
    setCopilotError(null);
    setCopilotPolling(false);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const clientId = settings.copilotClientId.trim();
      const clientSecret = settings.copilotClientSecret.trim();

      if (!clientId || !clientSecret) {
        setCopilotError('GitHub OAuth client ID and secret are required.');
        return;
      }

      const start = await invoke<{ authorize_url: string; state: string }>('copilot_oauth_start', {
        clientId,
      });

      await openCopilotVerification(start.authorize_url);
      setCopilotPolling(true);
      await invoke('copilot_oauth_poll', {
        state: start.state,
        clientId,
        clientSecret,
      });
      setCopilotLoggedIn(true);
      await refreshCopilotModels();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to connect to Copilot';
      setCopilotError(message);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  }, [openCopilotVerification, refreshCopilotModels, settings.copilotClientId, settings.copilotClientSecret]);

  const openEnterpriseModal = useCallback((startLogin: boolean) => {
    setEnterpriseTypeDraft(copilotEnterpriseType);
    setEnterpriseHostDraft(enterpriseHostInput);
    setEnterpriseModalError(null);
    setPendingEnterpriseLogin(startLogin);
    setShowEnterpriseModal(true);
  }, [copilotEnterpriseType, enterpriseHostInput]);

  const handleEnterpriseLogin = useCallback(async (
    hostInput: string = enterpriseHostInput,
    type: 'ghe' | 'ghes' = copilotEnterpriseType
  ) => {
    const resolvedHost = resolveEnterpriseHost(hostInput, type);
    if (!resolvedHost) {
      openEnterpriseModal(true);
      return;
    }
    const loginUrl = `https://${resolvedHost}/login`;
    try {
      await openCopilotVerification(loginUrl);
      setEnterpriseLoginStarted(true);
      setCopilotAccountsNotice('Finish signing in with GitHub Enterprise, then click Reload accounts.');
      setCopilotAccountsError(null);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to open Enterprise login.';
      setCopilotAccountsError(message);
    }
  }, [copilotEnterpriseType, enterpriseHostInput, openCopilotVerification, openEnterpriseModal, resolveEnterpriseHost]);

  const handleEnterpriseModalContinue = useCallback(async () => {
    const trimmedHost = enterpriseHostDraft.trim();
    if (!trimmedHost) {
      setEnterpriseModalError('Enterprise host is required.');
      return;
    }
    setSettings((prev) => ({
      ...prev,
      copilotEnterpriseType: enterpriseTypeDraft,
      copilotAuthHost: trimmedHost,
    }));
    setShowEnterpriseModal(false);
    setEnterpriseModalError(null);
    const shouldLogin = pendingEnterpriseLogin;
    setPendingEnterpriseLogin(false);
    if (shouldLogin) {
      await handleEnterpriseLogin(trimmedHost, enterpriseTypeDraft);
    }
  }, [
    enterpriseHostDraft,
    enterpriseTypeDraft,
    handleEnterpriseLogin,
    pendingEnterpriseLogin,
    setSettings,
  ]);

  const handleCopilotDeviceFlow = useCallback(async () => {
    setCopilotError(null);
    setCopilotAccountsError(null);
    setCopilotAccountsNotice(null);
    setCopilotPolling(false);
    setCopilotDeviceCode(null);

    if (copilotAuthMode === 'enterprise') {
      await handleEnterpriseLogin();
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const deviceFlowClientId =
        copilotAuthMode === 'enterprise' ? copilotEnterpriseClientId || undefined : undefined;
      const deviceCode = await invoke<CopilotDeviceCode>('copilot_device_login_start', {
        host: copilotAuthHost || undefined,
        clientId: deviceFlowClientId,
      });
      setCopilotDeviceCode(deviceCode);
      await openCopilotVerification(deviceCode.verification_uri);
      setCopilotPolling(true);
      await invoke('copilot_device_login_poll', {
        deviceCode: deviceCode.device_code,
        interval: deviceCode.interval,
        expiresIn: deviceCode.expires_in,
        host: copilotAuthHost || undefined,
        clientId: deviceFlowClientId,
      });
      setCopilotLoggedIn(true);
      setShowCopilotAccountPicker(false);
      await reloadCopilotAccounts();
      await refreshCopilotModels();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to connect to Copilot';
      setCopilotError(message);
      setCopilotAccountsError(message);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  }, [
    copilotAuthHost,
    copilotAuthMode,
    handleEnterpriseLogin,
    openCopilotVerification,
    refreshCopilotModels,
    reloadCopilotAccounts,
  ]);

  const handleCopilotSignIn = useCallback(async () => {
    if (copilotUseDeveloperOAuth) {
      await handleCopilotLogin();
      return;
    }
    setCopilotError(null);
    setCopilotDeviceCode(null);
    setShowCopilotAccountPicker(true);
    const accounts = await reloadCopilotAccounts();
    if (accounts.length === 0) {
      await handleCopilotDeviceFlow();
      return;
    }
  }, [copilotUseDeveloperOAuth, handleCopilotDeviceFlow, handleCopilotLogin, reloadCopilotAccounts]);

  const handleCopilotChangeAccount = useCallback(async () => {
    setCopilotError(null);
    setCopilotUseDeveloperOAuth(false);
    setCopilotDeviceCode(null);
    setShowCopilotAccountPicker(true);
    const accounts = await reloadCopilotAccounts();
    if (accounts.length === 0) {
      await handleCopilotDeviceFlow();
      return;
    }
  }, [handleCopilotDeviceFlow, reloadCopilotAccounts]);

  const handleCopilotAccountSelect = useCallback(async (account: CopilotCachedAccount) => {
    setCopilotError(null);
    setCopilotPolling(false);
    try {
      setCopilotPolling(true);
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('copilot_cached_account_import', { host: account.host, username: account.username });
      setCopilotLoggedIn(true);
      setShowCopilotAccountPicker(false);
      await refreshCopilotModels();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to reuse Copilot account';
      setCopilotError(message);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  }, []);

  const handleCopilotLogout = useCallback(async () => {
    setCopilotError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('copilot_device_logout');
      setCopilotLoggedIn(false);
      setCopilotUseDeveloperOAuth(false);
      setShowCopilotAccountPicker(true);
      setCopilotDeviceCode(null);
      await reloadCopilotAccounts();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to disconnect Copilot';
      setCopilotError(message);
    }
  }, []);

  useEffect(() => {
    if (isOpen && settings.aiProvider === 'ollama') {
      fetchOllamaModels(settings.ollamaUrl);
    }
  }, [isOpen, settings.aiProvider, settings.ollamaUrl, fetchOllamaModels]);

  // Load cached copilot models when modal opens with copilot provider
  useEffect(() => {
    if (isOpen && settings.aiProvider === 'copilot') {
      loadCachedCopilotModels();
    }
  }, [isOpen, settings.aiProvider, loadCachedCopilotModels]);

  useEffect(() => {
    if (isOpen && activeTab === 'usage') {
      fetchUsageStats();
    }
  }, [isOpen, activeTab, fetchUsageStats]);

  useEffect(() => {
    let isActive = true;
    if (!isOpen || settings.aiProvider !== 'copilot') {
      setCopilotPolling(false);
      setCopilotError(null);
      setCopilotLoggedIn(null);
      setCopilotAccounts([]);
      setCopilotAccountsLoading(false);
      setCopilotAccountsError(null);
      setCopilotAccountsNotice(null);
      setCopilotUseDeveloperOAuth(false);
      setShowCopilotAccountPicker(false);
      setShowEnterpriseModal(false);
      setEnterpriseModalError(null);
      setEnterpriseLoginStarted(false);
      setCopilotDeviceCode(null);
      return () => {
        isActive = false;
      };
    }

    const loadStatus = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<CopilotLoginStatus>('copilot_device_login_status');
        if (isActive) {
          setCopilotLoggedIn(status.logged_in);
        }
      } catch {
        if (isActive) {
          setCopilotLoggedIn(false);
        }
      }
    };

    loadStatus();

    return () => {
      isActive = false;
    };
  }, [isOpen, settings.aiProvider]);

  useEffect(() => {
    if (copilotAuthMode === 'enterprise' && copilotUseDeveloperOAuth) {
      setCopilotUseDeveloperOAuth(false);
    }
    if (copilotAuthMode !== 'enterprise') {
      setEnterpriseLoginStarted(false);
      setCopilotAccountsNotice(null);
    }
  }, [copilotAuthMode, copilotUseDeveloperOAuth]);

  useEffect(() => {
    if (!isOpen || settings.aiProvider !== 'copilot') {
      return;
    }
    let isActive = true;
    setCopilotDeviceCode(null);
    reloadCopilotAccounts().finally(() => {
      if (!isActive) {
        return;
      }
    });
    return () => {
      isActive = false;
    };
  }, [isOpen, settings.aiProvider, copilotAuthHost, copilotAuthMode, reloadCopilotAccounts]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        
        // Migrate old MCP package names
        const packageMigrations: Record<string, string> = {
          '@anthropic-ai/mcp-server-brave-search': '@modelcontextprotocol/server-brave-search',
          '@anthropic-ai/mcp-server-filesystem': '@modelcontextprotocol/server-filesystem',
          '@anthropic-ai/mcp-server-github': '@modelcontextprotocol/server-github',
        };
        
        let mcpServers = parsed.mcpServers?.length ? parsed.mcpServers : BUILT_IN_MCP_SERVERS;
        let migrated = false;
        
        mcpServers = mcpServers.map((server: MCPServer) => {
          const newArgs = server.args.map((arg: string) => {
            if (packageMigrations[arg]) {
              migrated = true;
              console.log(`[Launcher] Migrating MCP package: ${arg} -> ${packageMigrations[arg]}`);
              return packageMigrations[arg];
            }
            return arg;
          });
          return { ...server, args: newArgs };
        });
        
        const newSettings = {
          ...settings,
          ...parsed,
          mcpServers,
        };
        
        setSettings(newSettings);
        
        // Save migrated settings
        if (migrated) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
          console.log('[Launcher] MCP settings migrated and saved');
        }
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (settings.theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme]);

  const handleSave = async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    
    // Also save to backend for scheduler access
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_ai_settings', {
        settings: {
          aiProvider: settings.aiProvider,
          model: settings.model,
          ollamaUrl: settings.ollamaUrl,
          openaiKey: settings.openaiKey,
          anthropicKey: settings.anthropicKey,
          copilotClientId: settings.copilotClientId,
          copilotClientSecret: settings.copilotClientSecret,
          copilotAuthHost: settings.copilotAuthHost,
          copilotAuthMode: settings.copilotAuthMode,
          copilotEnterpriseType: settings.copilotEnterpriseType,
          customBaseUrl: settings.customBaseUrl,
          customApiKey: settings.customApiKey,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        }
      });
      console.log('[Settings] Saved AI settings to backend');
    } catch (error) {
      console.error('[Settings] Failed to save AI settings to backend:', error);
    }
    
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateMcpServer = (id: string, updates: Partial<MCPServer>) => {
    setSettings({
      ...settings,
      mcpServers: settings.mcpServers.map(s => s.id === id ? { ...s, ...updates } : s),
    });
  };

  const addCustomMcpServer = () => {
    const newServer: MCPServer = {
      id: `custom-${Date.now()}`,
      name: 'Custom MCP Server',
      command: 'npx',
      args: ['-y', 'your-mcp-server'],
      env: {},
      enabled: false,
    };
    setSettings({
      ...settings,
      mcpServers: [...settings.mcpServers, newServer],
    });
    setExpandedMcp(newServer.id);
  };

  const removeMcpServer = (id: string) => {
    setSettings({
      ...settings,
      mcpServers: settings.mcpServers.filter(s => s.id !== id),
    });
  };

  const currentModels = settings.aiProvider === 'ollama' && ollamaModels.length > 0
    ? ollamaModels
    : settings.aiProvider === 'copilot' && copilotModels.length > 0
    ? copilotModels
    : DEFAULT_MODELS[settings.aiProvider] || [];

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'general' ? styles.active : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'ai' ? styles.active : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI Provider
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'mcp' ? styles.active : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP Servers
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'usage' ? styles.active : ''}`}
            onClick={() => setActiveTab('usage')}
          >
            Usage
          </button>
        </div>

        <div className={styles.content}>
          {activeTab === 'general' && (
            <section className={styles.section}>
              <h3>Appearance</h3>
              <div className={styles.field}>
                <label>Theme</label>
                <div className={styles.themeButtons}>
                  <button
                    className={`${styles.themeBtn} ${settings.theme === 'light' ? styles.active : ''}`}
                    onClick={() => setSettings({ ...settings, theme: 'light' })}
                  >
                    <Sun size={16} />
                    <span>Light</span>
                  </button>
                  <button
                    className={`${styles.themeBtn} ${settings.theme === 'dark' ? styles.active : ''}`}
                    onClick={() => setSettings({ ...settings, theme: 'dark' })}
                  >
                    <Moon size={16} />
                    <span>Dark</span>
                  </button>
                  <button
                    className={`${styles.themeBtn} ${settings.theme === 'system' ? styles.active : ''}`}
                    onClick={() => setSettings({ ...settings, theme: 'system' })}
                  >
                    <Monitor size={16} />
                    <span>System</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'ai' && (
            <>
              <section className={styles.section}>
                <h3>AI Provider</h3>
                <div className={styles.field}>
                  <label>Provider</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider;
                      const models = DEFAULT_MODELS[provider];
                      setSettings({
                        ...settings,
                        aiProvider: provider,
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
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                        className={styles.select}
                        disabled={loadingModels}
                      >
                        {currentModels.map((model) => (
                          <option key={model} value={model}>
                            {formatModelLabel(settings.aiProvider, model, copilotModelsMetadata)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                        placeholder={loadingModels ? "Loading models..." : "Enter model name"}
                        className={styles.input}
                        disabled={loadingModels}
                      />
                    )}
                    {settings.aiProvider === 'ollama' && (
                      <button
                        className={styles.refreshBtn}
                        onClick={() => fetchOllamaModels(settings.ollamaUrl)}
                        disabled={loadingModels}
                        title="Refresh models"
                      >
                        {loadingModels ? <Loader2 size={16} className={styles.spinning} /> : <RefreshCw size={16} />}
                      </button>
                    )}
                    {settings.aiProvider === 'copilot' && copilotLoggedIn && (
                      <button
                        className={styles.refreshBtn}
                        onClick={() => {
                          setLoadingModels(true);
                          refreshCopilotModels().finally(() => setLoadingModels(false));
                        }}
                        disabled={loadingModels}
                        title="Refresh models"
                      >
                        {loadingModels ? <Loader2 size={16} className={styles.spinning} /> : <RefreshCw size={16} />}
                      </button>
                    )}
                  </div>
                  {settings.aiProvider === 'ollama' && ollamaModels.length === 0 && !loadingModels && (
                    <p className={styles.fieldHint}>No models found. Make sure Ollama is running.</p>
                  )}
                  {/* Model info panel for Copilot models */}
                  {settings.aiProvider === 'copilot' && settings.model !== 'auto' && (() => {
                    const modelMeta = copilotModelsMetadata?.find(m => m.id === settings.model);
                    
                    if (!modelMeta) {
                      return (
                        <div className={styles.modelInfoPanel}>
                          <div className={styles.modelInfoHeader}>{settings.model}</div>
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
              </section>

              <section className={styles.section}>
                <h3>Provider Settings</h3>
                {settings.aiProvider === 'ollama' && (
                  <div className={styles.field}>
                    <label>Ollama URL</label>
                    <input
                      type="text"
                      value={settings.ollamaUrl}
                      onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                      placeholder="http://localhost:11434"
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'openai' && (
                  <div className={styles.field}>
                    <label>OpenAI API Key</label>
                    <input
                      type="password"
                      value={settings.openaiKey}
                      onChange={(e) => setSettings({ ...settings, openaiKey: e.target.value })}
                      placeholder="sk-..."
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'anthropic' && (
                  <div className={styles.field}>
                    <label>Anthropic API Key</label>
                    <input
                      type="password"
                      value={settings.anthropicKey}
                      onChange={(e) => setSettings({ ...settings, anthropicKey: e.target.value })}
                      placeholder="sk-ant-..."
                      className={styles.input}
                    />
                  </div>
                )}

                {settings.aiProvider === 'copilot' && (
                  <div className={styles.field}>
                    <label>GitHub Copilot</label>
                    <div className={styles.copilotHostRow}>
                      <label className={styles.copilotHostOption}>
                        <input
                          type="radio"
                          name="copilot-host"
                          checked={copilotAuthMode === 'github'}
                          onChange={() => {
                            setSettings({ ...settings, copilotAuthMode: 'github', copilotAuthHost: 'github.com' });
                            setCopilotDeviceCode(null);
                          }}
                        />
                        GitHub.com
                      </label>
                      <label className={styles.copilotHostOption}>
                        <input
                          type="radio"
                          name="copilot-host"
                          checked={copilotAuthMode === 'enterprise'}
                          onChange={() => {
                            setSettings({
                              ...settings,
                              copilotAuthMode: 'enterprise',
                              copilotAuthHost:
                                settings.copilotAuthHost === 'github.com' ? '' : settings.copilotAuthHost,
                              copilotEnterpriseType: settings.copilotEnterpriseType || 'ghes',
                            });
                            setCopilotDeviceCode(null);
                          }}
                        />
                        Enterprise
                      </label>
                    </div>
                    {copilotAuthMode === 'enterprise' && (
                      <div className={styles.copilotEnterpriseRow}>
                        <div className={styles.copilotEnterpriseInfo}>
                          <span className={styles.copilotEnterpriseLabel}>
                            {enterpriseHostInput
                              ? copilotEnterpriseType === 'ghe'
                                ? 'GHE.com (Enterprise Cloud)'
                                : 'GitHub Enterprise Server'
                              : 'Enterprise not configured'}
                          </span>
                          {enterpriseHostInput && (
                            <span className={styles.fieldHint}>
                              Using {resolvedEnterpriseHost}
                            </span>
                          )}
                        </div>
                        <button
                          className={styles.copilotButton}
                          type="button"
                          onClick={() => openEnterpriseModal(false)}
                        >
                          Configure Enterprise
                        </button>
                      </div>
                    )}
                    {!copilotUseDeveloperOAuth && showCopilotAccountPicker && (
                      <>
                        {copilotAccountsLoading && (
                          <p className={styles.fieldHint}>Loading cached Copilot accounts...</p>
                        )}
                        {!copilotAccountsLoading && (
                          <div className={styles.copilotAccountBox}>
                            <div className={styles.copilotAccountHeader}>
                              <span>
                                {copilotAuthMode === 'enterprise'
                                  ? `Enterprise accounts on ${resolvedEnterpriseHost || 'Enterprise'}`
                                  : 'Cached GitHub.com accounts'}
                              </span>
                              <div className={styles.copilotAccountActions}>
                                <button
                                  className={styles.copilotButton}
                                  type="button"
                                  onClick={handleCopilotDeviceFlow}
                                  disabled={copilotPolling || !copilotCanStartDeviceFlow}
                                  title={
                                    copilotCanStartDeviceFlow
                                      ? copilotAuthMode === 'enterprise'
                                        ? 'Open Enterprise login'
                                        : 'Start device login'
                                      : 'Enter an Enterprise host first.'
                                  }
                                >
                                  {copilotAuthMode === 'enterprise' ? 'Open login' : 'Add account'}
                                </button>
                                <button
                                  className={styles.copilotButton}
                                  type="button"
                                  onClick={() => void reloadCopilotAccounts()}
                                >
                                  {copilotAuthMode === 'enterprise' && enterpriseLoginStarted
                                    ? "I've signed in"
                                    : 'Reload'}
                                </button>
                                <button
                                  className={styles.copilotButton}
                                  type="button"
                                  onClick={() => setShowCopilotAccountPicker(false)}
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                            {copilotDeviceCode && (
                              <div className={styles.copilotDeviceBox}>
                                <div className={styles.copilotDeviceRow}>
                                  <span>Enter code</span>
                                  <span className={styles.copilotDeviceCode}>{copilotDeviceCode.user_code}</span>
                                  <button
                                    className={styles.copilotButton}
                                    type="button"
                                    onClick={() => void copyCopilotCode(copilotDeviceCode.user_code)}
                                  >
                                    Copy
                                  </button>
                                </div>
                                <div className={styles.copilotDeviceRow}>
                                  <span>Verification</span>
                                  <button
                                    className={styles.copilotButton}
                                    type="button"
                                    onClick={() => void openCopilotVerification(copilotDeviceCode.verification_uri)}
                                  >
                                    Open page
                                  </button>
                                </div>
                              </div>
                            )}
                            {copilotAccounts.length === 0 ? (
                              <p className={styles.copilotError}>
                                No accounts detected yet. Use {copilotAuthMode === 'enterprise' ? '"Open login"' : '"Add account"'} to sign in.
                              </p>
                            ) : (
                              <>
                                {copilotAccounts.length > 0 && (
                                  <>
                                    <p className={styles.fieldHint}>Cached accounts</p>
                                    {copilotAccounts.map((account, index) => (
                                      <div
                                        key={`${account.host}-${account.username}-${index}`}
                                        className={styles.copilotAccountRow}
                                      >
                                        <div className={styles.copilotAccountInfo}>
                                          <span className={styles.copilotAccountUser}>{account.username}</span>
                                          <span className={styles.copilotAccountSource}>{account.source}</span>
                                        </div>
                                        <button
                                          className={styles.copilotButton}
                                          type="button"
                                          onClick={() => handleCopilotAccountSelect(account)}
                                          disabled={copilotPolling}
                                        >
                                          Select
                                        </button>
                                      </div>
                                    ))}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {copilotAccountsError && <p className={styles.copilotError}>{copilotAccountsError}</p>}
                        {copilotAccountsNotice && <p className={styles.fieldHint}>{copilotAccountsNotice}</p>}
                      </>
                    )}
                    <div className={styles.copilotStatusRow}>
                      <span
                        className={`${styles.copilotStatus} ${
                          copilotLoggedIn ? styles.copilotConnected : styles.copilotDisconnected
                        }`}
                      >
                        {copilotLoggedIn ? 'Connected' : copilotLoggedIn === null ? 'Checking...' : 'Not connected'}
                      </span>
                      {copilotLoggedIn ? (
                        <div className={styles.copilotAuthActions}>
                          <button
                            className={styles.copilotButton}
                            onClick={handleCopilotChangeAccount}
                            type="button"
                          >
                            Change account
                          </button>
                          <button
                            className={styles.copilotButton}
                            onClick={handleCopilotLogout}
                            type="button"
                          >
                            Sign out
                          </button>
                        </div>
                      ) : (
                        <div className={styles.copilotAuthActions}>
                          <button
                            className={styles.copilotButton}
                            onClick={handleCopilotSignIn}
                            type="button"
                            disabled={copilotPolling}
                          >
                            {copilotPolling ? 'Connecting...' : 'Select account'}
                          </button>
                        </div>
                      )}
                    </div>
                    {copilotPolling && (
                      <p className={styles.fieldHint}>Connecting to Copilot...</p>
                    )}
                    {!copilotLoggedIn && copilotAuthMode === 'github' && (
                      <label className={styles.copilotCheckboxRow}>
                        <input
                          className={styles.copilotCheckbox}
                          type="checkbox"
                          checked={copilotUseDeveloperOAuth}
                          onChange={(event) => {
                            setCopilotUseDeveloperOAuth(event.target.checked);
                            setShowCopilotAccountPicker(false);
                            setCopilotAccountsError(null);
                            setCopilotDeviceCode(null);
                          }}
                        />
                        Use developer OAuth client ID + secret
                      </label>
                    )}
                    {!copilotLoggedIn && (
                      <p className={styles.fieldHint}>
                        {copilotAuthMode === 'enterprise'
                          ? 'Enterprise login opens your instance in the browser. After signing in, click Reload accounts.'
                          : "Device login uses GitHub's device flow and caches accounts locally. OAuth app login requires a client ID + secret and a local callback."}
                      </p>
                    )}
                    {copilotAccountsError && <p className={styles.copilotError}>{copilotAccountsError}</p>}
                    {copilotAccountsNotice && <p className={styles.fieldHint}>{copilotAccountsNotice}</p>}
                    {copilotError && <p className={styles.copilotError}>{copilotError}</p>}
                    {copilotUseDeveloperOAuth && copilotAuthMode === 'github' && (
                      <>
                        <div className={styles.field}>
                          <label>OAuth Client ID</label>
                          <input
                            type="text"
                            value={settings.copilotClientId}
                            onChange={(e) => setSettings({ ...settings, copilotClientId: e.target.value })}
                            placeholder="GitHub OAuth App client ID"
                            className={styles.input}
                          />
                          <p className={styles.fieldHint}>
                            Set the OAuth App redirect URL to http://127.0.0.1:1717/callback.
                          </p>
                        </div>
                        <div className={styles.field}>
                          <label>OAuth Client Secret</label>
                          <input
                            type="password"
                            value={settings.copilotClientSecret}
                            onChange={(e) => setSettings({ ...settings, copilotClientSecret: e.target.value })}
                            placeholder="GitHub OAuth App client secret"
                            className={styles.input}
                          />
                          <p className={styles.fieldHint}>
                            Stored locally to complete the OAuth token exchange.
                          </p>
                        </div>
                      </>
                    )}
                    {showEnterpriseModal && (
                      <div className={styles.enterpriseModalBackdrop}>
                        <div className={styles.enterpriseModal}>
                          <div className={styles.enterpriseModalHeader}>
                            Sign in with GitHub Enterprise
                          </div>
                          <p className={styles.fieldHint}>
                            Select your GitHub Enterprise type and enter instance details.
                          </p>
                          <div className={styles.enterpriseModalOptions}>
                            <label className={styles.enterpriseModalOption}>
                              <input
                                type="radio"
                                name="enterprise-type"
                                checked={enterpriseTypeDraft === 'ghe'}
                                onChange={() => setEnterpriseTypeDraft('ghe')}
                              />
                              GHE.com (Enterprise Cloud)
                            </label>
                            <label className={styles.enterpriseModalOption}>
                              <input
                                type="radio"
                                name="enterprise-type"
                                checked={enterpriseTypeDraft === 'ghes'}
                                onChange={() => setEnterpriseTypeDraft('ghes')}
                              />
                              GitHub Enterprise Server
                            </label>
                          </div>
                          <input
                            type="text"
                            value={enterpriseHostDraft}
                            onChange={(event) => setEnterpriseHostDraft(event.target.value)}
                            placeholder={
                              enterpriseTypeDraft === 'ghe'
                                ? 'octocat or https://octocat.ghe.com/'
                                : 'scm.company.com'
                            }
                            className={styles.input}
                          />
                          {enterpriseTypeDraft === 'ghe' ? (
                            <p className={styles.fieldHint}>
                              Enter a GHE.com instance name or URL.
                            </p>
                          ) : (
                            <p className={styles.fieldHint}>
                              Will resolve to https://{draftResolvedEnterpriseHost || 'scm.company.com'}/
                            </p>
                          )}
                          {enterpriseModalError && (
                            <p className={styles.copilotError}>{enterpriseModalError}</p>
                          )}
                          <div className={styles.enterpriseModalActions}>
                            <button
                              className={styles.copilotButton}
                              type="button"
                              onClick={() => {
                                setShowEnterpriseModal(false);
                                setEnterpriseModalError(null);
                                setPendingEnterpriseLogin(false);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className={styles.copilotButton}
                              type="button"
                              onClick={handleEnterpriseModalContinue}
                              disabled={!enterpriseHostDraft.trim()}
                            >
                              Continue
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {settings.aiProvider === 'custom' && (
                  <>
                    <div className={styles.field}>
                      <label>Base URL</label>
                      <input
                        type="text"
                        value={settings.customBaseUrl}
                        onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1"
                        className={styles.input}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>API Key</label>
                      <input
                        type="password"
                        value={settings.customApiKey}
                        onChange={(e) => setSettings({ ...settings, customApiKey: e.target.value })}
                        placeholder="Your API key"
                        className={styles.input}
                      />
                    </div>
                  </>
                )}
              </section>

              <section className={styles.section}>
                <h3>Advanced</h3>
                <div className={styles.field}>
                  <label>Temperature: {settings.temperature.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.temperature}
                    onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                    className={styles.slider}
                  />
                  <span className={styles.sliderLabels}>
                    <span>Precise</span>
                    <span>Creative</span>
                  </span>
                </div>

                <div className={styles.field}>
                  <label>Max Tokens: {settings.maxTokens}</label>
                  <input
                    type="range"
                    min="1024"
                    max="32768"
                    step="1024"
                    value={settings.maxTokens}
                    onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) })}
                    className={styles.slider}
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.toggleRow}>
                    <div>
                      <label>Think Aloud</label>
                      <p className={styles.fieldDesc}>Show AI reasoning process</p>
                    </div>
                    <button
                      className={`${styles.toggle} ${settings.thinkAloud ? styles.on : ''}`}
                      onClick={() => setSettings({ ...settings, thinkAloud: !settings.thinkAloud })}
                    >
                      <span className={styles.toggleThumb} />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'mcp' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>MCP Servers</h3>
                <button className={styles.addBtn} onClick={addCustomMcpServer}>
                  <Plus size={16} />
                  <span>Add Server</span>
                </button>
              </div>
              <p className={styles.sectionDesc}>
                Model Context Protocol (MCP) servers extend AI capabilities with tools like web search, file access, and APIs.
              </p>

              <div className={styles.mcpList}>
                {settings.mcpServers.map((server) => (
                  <div key={server.id} className={styles.mcpItem}>
                    <div 
                      className={styles.mcpHeader}
                      onClick={() => setExpandedMcp(expandedMcp === server.id ? null : server.id)}
                    >
                      <div className={styles.mcpHeaderLeft}>
                        {expandedMcp === server.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className={styles.mcpName}>{server.name}</span>
                      </div>
                      <div className={styles.mcpHeaderRight}>
                        <button
                          className={`${styles.toggle} ${styles.small} ${server.enabled ? styles.on : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateMcpServer(server.id, { enabled: !server.enabled });
                          }}
                        >
                          <span className={styles.toggleThumb} />
                        </button>
                      </div>
                    </div>

                    {expandedMcp === server.id && (
                      <div className={styles.mcpDetails}>
                        <div className={styles.field}>
                          <label>Name</label>
                          <input
                            type="text"
                            value={server.name}
                            onChange={(e) => updateMcpServer(server.id, { name: e.target.value })}
                            className={styles.input}
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Command</label>
                          <input
                            type="text"
                            value={server.command}
                            onChange={(e) => updateMcpServer(server.id, { command: e.target.value })}
                            placeholder="npx"
                            className={styles.input}
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Arguments</label>
                          <input
                            type="text"
                            value={server.args.join(' ')}
                            onChange={(e) => updateMcpServer(server.id, { args: e.target.value.split(' ').filter(Boolean) })}
                            placeholder="-y your-mcp-package"
                            className={styles.input}
                          />
                        </div>
                        {Object.keys(server.env).length > 0 && (
                          <div className={styles.field}>
                            <label>Environment Variables</label>
                            {Object.entries(server.env).map(([key, value]) => (
                              <div key={key} className={styles.envRow}>
                                <span className={styles.envKey}>{key}</span>
                                <input
                                  type="password"
                                  value={value}
                                  onChange={(e) => updateMcpServer(server.id, { 
                                    env: { ...server.env, [key]: e.target.value }
                                  })}
                                  placeholder="Enter value..."
                                  className={styles.input}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {!BUILT_IN_MCP_SERVERS.find(s => s.id === server.id) && (
                          <button 
                            className={styles.removeBtn}
                            onClick={() => removeMcpServer(server.id)}
                          >
                            <Trash2 size={14} />
                            <span>Remove Server</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'usage' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>Token Usage</h3>
                <button 
                  className={styles.addBtn} 
                  onClick={clearUsageHistory}
                  disabled={loadingUsage || !usageStats?.total_requests}
                >
                  <Trash2 size={16} />
                  <span>Clear History</span>
                </button>
              </div>
              <p className={styles.sectionDesc}>
                Track your AI token usage across all conversations and models.
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
                      <span>Token usage will appear here as you use the AI assistant.</span>
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

        <div className={styles.footer}>
          {saved && <span className={styles.savedMsg}>Settings saved!</span>}
          <button onClick={handleSave} className={styles.saveBtn}>
            <Save size={16} />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
