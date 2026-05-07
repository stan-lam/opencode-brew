import { useState, useEffect, useCallback } from 'react';
import { X, Trash2, Loader2, BarChart3, Settings } from 'lucide-react';
import styles from './SettingsModal.module.css';

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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [usageStats, setUsageStats] = useState<OverallStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

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

  useEffect(() => {
    if (isOpen) {
      fetchUsageStats();
    }
  }, [isOpen, fetchUsageStats]);

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

        <div className={styles.content}>
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
        </div>
      </div>
    </div>
  );
}
