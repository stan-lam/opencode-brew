import React, { useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Shield,
  Code,
  Zap,
  MessageSquare,
} from 'lucide-react';
import type { CheckpointState, HandoffDocument, HandoffDocumentType } from '../../types/workflow';
import styles from './CheckpointCard.module.css';

interface CheckpointCardProps {
  checkpoint: CheckpointState;
  onApprove: (checkpointId: string, feedback?: string, answers?: Record<string, string>) => void;
  onReject: (checkpointId: string, feedback: string) => void;
  disabled?: boolean;
}

const DOCUMENT_ICONS: Record<HandoffDocumentType, React.ReactNode> = {
  'requirements': <FileText size={18} />,
  'architecture': <Code size={18} />,
  'task-list': <FileText size={18} />,
  'code-review': <Code size={18} />,
  'security-review': <Shield size={18} />,
  'performance-review': <Zap size={18} />,
  'verification-report': <CheckCircle2 size={18} />,
};

const DOCUMENT_LABELS: Record<HandoffDocumentType, string> = {
  'requirements': 'Requirements Document',
  'architecture': 'Architecture Document',
  'task-list': 'Task List',
  'code-review': 'Code Review Report',
  'security-review': 'Security Review Report',
  'performance-review': 'Performance Review Report',
  'verification-report': 'Verification Report',
};

const RISK_COLORS: Record<string, string> = {
  'low': '#22c55e',
  'medium': '#f59e0b',
  'high': '#ef4444',
  'critical': '#dc2626',
};

export const CheckpointCard: React.FC<CheckpointCardProps> = ({
  checkpoint,
  onApprove,
  onReject,
  disabled = false,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState(false);

  const { checkpoint: config, document, status } = checkpoint;

  const handleApprove = useCallback(() => {
    onApprove(config.id, feedback || undefined, Object.keys(answers).length > 0 ? answers : undefined);
  }, [config.id, feedback, answers, onApprove]);

  const handleReject = useCallback(() => {
    if (!feedback.trim()) {
      setShowRejectInput(true);
      return;
    }
    onReject(config.id, feedback);
  }, [config.id, feedback, onReject]);

  const handleQuestionAnswer = useCallback((questionId: string, answerId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answerId }));
  }, []);

  const isAwaitingApproval = status === 'awaiting_approval';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';

  return (
    <div className={`${styles.checkpointCard} ${styles[`status_${status}`]}`}>
      {/* Header */}
      <div className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.headerLeft}>
          <span className={styles.statusIcon}>
            {isAwaitingApproval && <Clock size={20} className={styles.iconPending} />}
            {isApproved && <CheckCircle2 size={20} className={styles.iconApproved} />}
            {isRejected && <XCircle size={20} className={styles.iconRejected} />}
            {status === 'pending' && <Clock size={20} className={styles.iconPending} />}
          </span>
          <span className={styles.checkpointName}>{config.name}</span>
          {config.required && <span className={styles.requiredBadge}>Required</span>}
        </div>
        <div className={styles.headerRight}>
          {document && (
            <span 
              className={styles.riskBadge}
              style={{ backgroundColor: RISK_COLORS[document.riskLevel] }}
            >
              {document.riskLevel.toUpperCase()} Risk
            </span>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className={styles.content}>
          {/* Document summary */}
          {document && (
            <div className={styles.documentSection}>
              <div className={styles.documentHeader}>
                {DOCUMENT_ICONS[document.type]}
                <span className={styles.documentType}>{DOCUMENT_LABELS[document.type]}</span>
                <span className={styles.documentVersion}>v{document.version}</span>
              </div>
              <div className={styles.documentSummary}>
                {document.summary}
              </div>
              
              {/* Blocking issues */}
              {document.blockingIssues.length > 0 && (
                <div className={styles.blockingIssues}>
                  <div className={styles.blockingHeader}>
                    <AlertTriangle size={14} />
                    <span>Blocking Issues ({document.blockingIssues.length})</span>
                  </div>
                  <ul className={styles.issuesList}>
                    {document.blockingIssues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Checkpoint questions */}
          {isAwaitingApproval && config.questions && config.questions.length > 0 && (
            <div className={styles.questionsSection}>
              {config.questions.map(question => (
                <div key={question.id} className={styles.question}>
                  <div className={styles.questionPrompt}>{question.prompt}</div>
                  <div className={styles.questionOptions}>
                    {question.options.map(option => (
                      <button
                        key={option.id}
                        className={`${styles.optionButton} ${answers[question.id] === option.id ? styles.optionSelected : ''}`}
                        onClick={() => handleQuestionAnswer(question.id, option.id)}
                        disabled={disabled}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Feedback input */}
          {isAwaitingApproval && (
            <div className={styles.feedbackSection}>
              <div className={styles.feedbackHeader}>
                <MessageSquare size={14} />
                <span>Feedback (optional for approval)</span>
              </div>
              <textarea
                className={styles.feedbackInput}
                placeholder="Add feedback or notes..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={disabled}
              />
              
              {showRejectInput && !feedback.trim() && (
                <div className={styles.rejectWarning}>
                  <AlertTriangle size={14} />
                  <span>Please provide feedback explaining what needs to change.</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {isAwaitingApproval && (
            <div className={styles.actions}>
              <button
                className={styles.rejectButton}
                onClick={handleReject}
                disabled={disabled}
              >
                <XCircle size={16} />
                Request Changes
              </button>
              <button
                className={styles.approveButton}
                onClick={handleApprove}
                disabled={disabled || (document?.blockingIssues?.length ?? 0) > 0}
              >
                <CheckCircle2 size={16} />
                Approve & Continue
              </button>
            </div>
          )}

          {/* Status messages */}
          {isApproved && (
            <div className={styles.statusMessage}>
              <CheckCircle2 size={16} />
              <span>Approved{checkpoint.feedback ? `: ${checkpoint.feedback}` : ''}</span>
            </div>
          )}

          {isRejected && (
            <div className={styles.statusMessage}>
              <XCircle size={16} />
              <span>Changes requested: {checkpoint.feedback}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CheckpointCard;
