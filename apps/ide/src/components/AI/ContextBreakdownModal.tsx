import React from 'react';
import { X } from 'lucide-react';
import { ContextBreakdown } from '../../store/aiStore';
import styles from './ContextBreakdownModal.module.css';

interface ContextBreakdownModalProps {
  breakdown: ContextBreakdown;
  onClose: () => void;
}

interface BreakdownItem {
  label: string;
  tokens: number;
  color: string;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export const ContextBreakdownModal: React.FC<ContextBreakdownModalProps> = ({ breakdown, onClose }) => {
  const items: BreakdownItem[] = [
    { label: 'System prompt', tokens: breakdown.systemPrompt, color: '#6b7280' },
    { label: 'Mode prompt', tokens: breakdown.modePrompt, color: '#a855f7' },
    { label: 'Web/Tools', tokens: breakdown.webAccessPrompt, color: '#22c55e' },
    { label: 'Summary', tokens: breakdown.conversationSummary, color: '#f59e0b' },
    { label: 'Conversation', tokens: breakdown.conversation, color: '#3b82f6' },
    { label: 'Current message', tokens: breakdown.currentMessage, color: '#06b6d4' },
    { label: 'Attachments', tokens: breakdown.attachments, color: '#ec4899' },
  ].filter(item => item.tokens > 0);

  const usedTokens = breakdown.total;
  const maxTokens = breakdown.contextLimit;
  const percentUsed = breakdown.percentFull;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>Context</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.summary}>
          <span className={styles.percentFull}>{percentUsed}% Full</span>
          <span className={styles.tokenCount}>~{formatTokens(usedTokens)} / {formatTokens(maxTokens)} Tokens</span>
        </div>

        <div className={styles.progressBar}>
          <div className={styles.progressTrack}>
            {items.map((item, index) => {
              const widthPercent = (item.tokens / maxTokens) * 100;
              return (
                <div
                  key={item.label}
                  className={styles.progressSegment}
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: item.color,
                  }}
                  title={`${item.label}: ${formatTokens(item.tokens)}`}
                />
              );
            })}
          </div>
        </div>

        <div className={styles.breakdown}>
          {items.map(item => (
            <div key={item.label} className={styles.breakdownItem}>
              <div className={styles.itemLabel}>
                <span
                  className={styles.colorDot}
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
              <span className={styles.itemTokens}>{formatTokens(item.tokens)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ContextBreakdownModal;
