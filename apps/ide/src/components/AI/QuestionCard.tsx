import React, { useState, useCallback } from 'react';
import { CheckCircle2, Circle, HelpCircle, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { StructuredQuestion, QuestionOption, QuestionCategory } from '../../types/questions';
import styles from './QuestionCard.module.css';

interface QuestionCardProps {
  question: StructuredQuestion;
  value: string | string[] | undefined;
  onAnswer: (value: string | string[], customValue?: string) => void;
  disabled?: boolean;
}

const CATEGORY_ICONS: Record<QuestionCategory, string> = {
  'scope': '🎯',
  'technical': '⚙️',
  'business': '💼',
  'risk': '⚠️',
  'priority': '📊',
  'project-setup': '🚀',
};

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  'scope': 'Scope',
  'technical': 'Technical',
  'business': 'Business',
  'risk': 'Risk Assessment',
  'priority': 'Priority',
  'project-setup': 'Project Setup',
};

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  value,
  onAnswer,
  disabled = false,
}) => {
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const isSelected = useCallback((optionId: string) => {
    if (!value) return false;
    if (Array.isArray(value)) {
      return value.includes(optionId);
    }
    return value === optionId;
  }, [value]);

  const handleOptionClick = useCallback((optionId: string) => {
    if (disabled) return;

    if (question.allowMultiple) {
      const currentValues = Array.isArray(value) ? value : value ? [value] : [];
      if (currentValues.includes(optionId)) {
        onAnswer(currentValues.filter(v => v !== optionId));
      } else {
        onAnswer([...currentValues, optionId]);
      }
    } else {
      onAnswer(optionId);
      setShowCustomInput(false);
    }
  }, [disabled, question.allowMultiple, value, onAnswer]);

  const handleCustomSubmit = useCallback(() => {
    if (customInput.trim()) {
      onAnswer('custom', customInput.trim());
      setShowCustomInput(false);
    }
  }, [customInput, onAnswer]);

  return (
    <div className={styles.questionCard}>
      <div className={styles.questionHeader}>
        {question.category && (
          <span className={styles.categoryBadge}>
            {CATEGORY_ICONS[question.category]} {CATEGORY_LABELS[question.category]}
          </span>
        )}
        {question.required !== false && (
          <span className={styles.requiredBadge}>Required</span>
        )}
      </div>

      <div className={styles.questionPrompt}>
        <HelpCircle size={18} className={styles.questionIcon} />
        <span>{question.prompt}</span>
      </div>

      <div className={styles.optionsList}>
        {question.options.map((option) => (
          <button
            key={option.id}
            className={`${styles.optionButton} ${isSelected(option.id) ? styles.optionSelected : ''} ${option.recommended ? styles.optionRecommended : ''}`}
            onClick={() => handleOptionClick(option.id)}
            disabled={disabled}
          >
            <span className={styles.optionCheckbox}>
              {question.allowMultiple ? (
                isSelected(option.id) ? (
                  <CheckCircle2 size={18} className={styles.checkIcon} />
                ) : (
                  <Circle size={18} />
                )
              ) : (
                <span className={`${styles.radioCircle} ${isSelected(option.id) ? styles.radioSelected : ''}`} />
              )}
            </span>
            <span className={styles.optionContent}>
              <span className={styles.optionLabel}>
                {option.icon && <span className={styles.optionIcon}>{option.icon}</span>}
                {option.label}
              </span>
              {option.description && (
                <span className={styles.optionDescription}>{option.description}</span>
              )}
            </span>
            {option.recommended && (
              <span className={styles.recommendedBadge}>
                <Sparkles size={12} /> Recommended
              </span>
            )}
          </button>
        ))}

        {question.allowCustom && (
          <div className={styles.customOption}>
            <button
              className={`${styles.optionButton} ${showCustomInput ? styles.optionSelected : ''}`}
              onClick={() => setShowCustomInput(!showCustomInput)}
              disabled={disabled}
            >
              <span className={styles.optionCheckbox}>
                <span className={`${styles.radioCircle} ${showCustomInput ? styles.radioSelected : ''}`} />
              </span>
              <span className={styles.optionLabel}>Other (specify)</span>
              {showCustomInput ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {showCustomInput && (
              <div className={styles.customInputWrapper}>
                <input
                  type="text"
                  className={styles.customInput}
                  placeholder="Enter your answer..."
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                  disabled={disabled}
                  autoFocus
                />
                <button
                  className={styles.customSubmitButton}
                  onClick={handleCustomSubmit}
                  disabled={!customInput.trim() || disabled}
                >
                  Submit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionCard;
