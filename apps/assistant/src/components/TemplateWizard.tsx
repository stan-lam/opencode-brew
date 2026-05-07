import { useState, useCallback, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Check, FolderOpen } from 'lucide-react';
import { AgentTemplate, TemplateInput, TemplateInputGroup, DependsOnCondition } from '../types/AgentTemplate';
import { Agent } from '../store/assistantStore';
import styles from './TemplateWizard.module.css';

const openSaveDialog = async (options: { 
  title?: string; 
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}): Promise<string | null> => {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: options.title || 'Save File',
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
      defaultPath: options.defaultPath,
    });
    return path;
  } catch (e) {
    console.error('Failed to open save dialog:', e);
    return null;
  }
};

interface TemplateWizardProps {
  template: AgentTemplate;
  onClose: () => void;
  onComplete: (agent: Omit<Agent, 'id' | 'created_at' | 'updated_at'>) => void;
}

export function TemplateWizard({ template, onClose, onComplete }: TemplateWizardProps) {
  const [config, setConfig] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    template.inputGroups.forEach(group => {
      group.inputs.forEach(input => {
        if (input.defaultValue !== undefined) {
          initial[input.id] = input.defaultValue;
        }
      });
    });
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const checkCondition = useCallback((condition: DependsOnCondition, configState: Record<string, any>): boolean => {
    const fieldValue = configState[condition.field];
    
    if (condition.operator === 'includes') {
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value);
      }
      return false;
    }
    
    if (condition.operator === 'greaterThan') {
      return Number(fieldValue) > Number(condition.value);
    }
    
    if (condition.operator === 'notEquals' || condition.notValue !== undefined) {
      const checkValue = condition.notValue !== undefined ? condition.notValue : condition.value;
      return fieldValue !== checkValue;
    }
    
    if (condition.value !== undefined) {
      if (typeof condition.value === 'number') {
        return Number(fieldValue) >= condition.value;
      }
      return fieldValue === condition.value;
    }
    
    return !!fieldValue;
  }, []);

  const isFieldVisible = useCallback((input: TemplateInput, configState: Record<string, any>): boolean => {
    if (!input.dependsOn) return true;
    
    const conditions = Array.isArray(input.dependsOn) ? input.dependsOn : [input.dependsOn];
    return conditions.some(cond => checkCondition(cond, configState));
  }, [checkCondition]);

  const visibleSteps = useMemo(() => {
    return template.inputGroups
      .map((group, originalIndex) => ({ group, originalIndex }))
      .filter(({ group }) => 
        group.inputs.some(input => isFieldVisible(input, config))
      );
  }, [template.inputGroups, config, isFieldVisible]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = visibleSteps[currentStepIndex];
  const currentGroup = currentStep?.group;

  const validateField = useCallback((input: TemplateInput, value: any): string | null => {
    if (input.required) {
      if (value === undefined || value === null || value === '') {
        return `${input.label} is required`;
      }
      if (Array.isArray(value) && value.length === 0) {
        return `Please select at least one ${input.label.toLowerCase()}`;
      }
    }
    if (input.type === 'number' && value !== undefined && value !== '') {
      const num = Number(value);
      if (input.min !== undefined && num < input.min) {
        return `Minimum value is ${input.min}`;
      }
      if (input.max !== undefined && num > input.max) {
        return `Maximum value is ${input.max}`;
      }
    }
    return null;
  }, []);

  const validateCurrentStep = useCallback((): boolean => {
    if (!currentGroup) return true;
    const newErrors: Record<string, string> = {};
    let isValid = true;

    currentGroup.inputs.forEach(input => {
      if (!isFieldVisible(input, config)) return;

      const error = validateField(input, config[input.id]);
      if (error) {
        newErrors[input.id] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  }, [currentGroup, config, isFieldVisible, validateField]);

  const handleNext = useCallback(() => {
    if (validateCurrentStep()) {
      if (currentStepIndex < visibleSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
        setErrors({});
      }
    }
  }, [currentStepIndex, visibleSteps.length, validateCurrentStep]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      setErrors({});
    }
  }, [currentStepIndex]);

  const handleComplete = useCallback(() => {
    if (validateCurrentStep()) {
      const agent = template.generateAgent(config);
      onComplete(agent);
    }
  }, [config, template, validateCurrentStep, onComplete]);

  const handleChange = useCallback((id: string, value: any) => {
    setConfig(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [errors]);

  const previewText = useMemo(() => {
    if (template.previewDescription) {
      return template.previewDescription(config);
    }
    return '';
  }, [template, config]);

  const renderInput = (input: TemplateInput) => {
    if (!isFieldVisible(input, config)) return null;

    const value = config[input.id];
    const error = errors[input.id];

    switch (input.type) {
      case 'text':
        return (
          <input
            type="text"
            className={`${styles.input} ${error ? styles.error : ''}`}
            value={value || ''}
            onChange={e => handleChange(input.id, e.target.value)}
            placeholder={input.placeholder}
          />
        );

      case 'textarea':
        return (
          <textarea
            className={`${styles.textarea} ${error ? styles.error : ''}`}
            value={value || ''}
            onChange={e => handleChange(input.id, e.target.value)}
            placeholder={input.placeholder}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            className={`${styles.input} ${error ? styles.error : ''}`}
            value={value ?? ''}
            onChange={e => handleChange(input.id, e.target.value ? Number(e.target.value) : '')}
            placeholder={input.placeholder}
            min={input.min}
            max={input.max}
            step={input.step}
          />
        );

      case 'date':
      case 'datetime':
        return (
          <input
            type={input.type === 'datetime' ? 'datetime-local' : 'date'}
            className={`${styles.input} ${error ? styles.error : ''}`}
            value={value || ''}
            onChange={e => handleChange(input.id, e.target.value)}
          />
        );

      case 'select':
        return (
          <select
            className={`${styles.select} ${error ? styles.error : ''}`}
            value={value || ''}
            onChange={e => handleChange(input.id, e.target.value)}
          >
            <option value="">Select...</option>
            {input.options?.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.icon ? `${opt.icon} ` : ''}{opt.label}
              </option>
            ))}
          </select>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className={styles.multiselect}>
            {input.options?.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.multiselectOption} ${selectedValues.includes(opt.value) ? styles.selected : ''}`}
                onClick={() => {
                  const newValue = selectedValues.includes(opt.value)
                    ? selectedValues.filter(v => v !== opt.value)
                    : [...selectedValues, opt.value];
                  handleChange(input.id, newValue);
                }}
              >
                {opt.icon && <span>{opt.icon}</span>}
                {opt.label}
              </button>
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={e => handleChange(input.id, e.target.checked)}
            />
            <span>{input.label}</span>
          </label>
        );

      case 'filepath':
        return (
          <div className={styles.filepathInput}>
            <input
              type="text"
              className={`${styles.input} ${styles.filepathText} ${error ? styles.error : ''}`}
              value={value || ''}
              onChange={e => handleChange(input.id, e.target.value)}
              placeholder={input.placeholder}
            />
            <button
              type="button"
              className={styles.browseButton}
              onClick={async () => {
                const path = await openSaveDialog({
                  title: input.fileDialogTitle || `Select ${input.label}`,
                  filters: input.fileFilters || [
                    { name: 'Markdown', extensions: ['md'] },
                    { name: 'JSON', extensions: ['json'] },
                    { name: 'Text', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] },
                  ],
                  defaultPath: value || undefined,
                });
                if (path) {
                  handleChange(input.id, path);
                }
              }}
            >
              <FolderOpen size={16} />
              Browse
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  if (!currentGroup) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <div className={styles.templateTitle}>
              <span className={styles.templateIcon}>{template.icon}</span>
              {template.name}
            </div>
            <div className={styles.stepIndicator}>
              Step {currentStepIndex + 1} of {visibleSteps.length}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.progress}>
          {visibleSteps.map((_, index) => (
            <div
              key={index}
              className={`${styles.progressStep} ${
                index < currentStepIndex ? styles.completed : ''
              } ${index === currentStepIndex ? styles.active : ''}`}
            />
          ))}
        </div>

        <div className={styles.content}>
          <div className={styles.stepHeader}>
            <div className={styles.stepTitle}>
              {currentGroup.icon && <span className={styles.stepIcon}>{currentGroup.icon}</span>}
              {currentGroup.title}
            </div>
            {currentGroup.description && (
              <div className={styles.stepDescription}>{currentGroup.description}</div>
            )}
          </div>

          <div className={styles.form}>
            {currentGroup.inputs.map(input => {
              if (!isFieldVisible(input, config)) return null;
              if (input.type === 'checkbox') {
                return (
                  <div key={input.id} className={styles.field}>
                    {renderInput(input)}
                    {errors[input.id] && <div className={styles.errorText}>{errors[input.id]}</div>}
                  </div>
                );
              }
              return (
                <div key={input.id} className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {input.label}
                    {input.required && <span className={styles.required}>*</span>}
                  </label>
                  {input.helpText && <div className={styles.fieldHelp}>{input.helpText}</div>}
                  {renderInput(input)}
                  {errors[input.id] && <div className={styles.errorText}>{errors[input.id]}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.preview}>{previewText}</div>
          <div className={styles.actions}>
            {currentStepIndex > 0 && (
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleBack}>
                <ChevronLeft size={16} />
                Back
              </button>
            )}
            {currentStepIndex < visibleSteps.length - 1 ? (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleNext}>
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleComplete}>
                <Check size={16} />
                Create Agent
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TemplateWizard;
