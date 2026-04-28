import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, GripVertical, Layers } from 'lucide-react';
import { Action, WorkflowStage, CombineStrategy } from '../store/assistantStore';
import styles from './WorkflowStageEditor.module.css';

interface WorkflowStageEditorProps {
  stage: WorkflowStage;
  stageIndex: number;
  onUpdate: (updates: Partial<WorkflowStage>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  renderActionEditor: (action: Action, index: number, onUpdate: (updates: Partial<Action>) => void, onRemove: () => void) => React.ReactNode;
}

const COMBINE_STRATEGIES: { value: CombineStrategy; label: string; description: string }[] = [
  { value: 'first_success', label: 'First Success', description: 'Use the first successful result' },
  { value: 'array', label: 'Array', description: 'Combine all outputs into a JSON array' },
  { value: 'named', label: 'Named', description: 'Each action output as named property' },
  { value: 'merge_json', label: 'Merge JSON', description: 'Deep merge all JSON outputs' },
];

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export function WorkflowStageEditor({
  stage,
  stageIndex,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  renderActionEditor,
}: WorkflowStageEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(
    stage.actions.length > 0 ? stage.actions[0].id : null
  );

  // Auto-select first action when actions change
  useEffect(() => {
    if (stage.actions.length > 0 && !stage.actions.find(a => a.id === selectedActionId)) {
      setSelectedActionId(stage.actions[0].id);
    } else if (stage.actions.length === 0) {
      setSelectedActionId(null);
    }
  }, [stage.actions, selectedActionId]);

  const handleAddAction = () => {
    const newAction: Action = {
      id: generateId(),
      name: `Action ${stage.actions.length + 1}`,
      action_type: { type: 'cli', command: '', args: [] },
      order: stage.actions.length,
      on_error: 'continue',
    };
    onUpdate({ actions: [...stage.actions, newAction] });
    setSelectedActionId(newAction.id);
  };

  const handleRemoveAction = (actionId: string) => {
    const newActions = stage.actions.filter((a) => a.id !== actionId);
    onUpdate({ actions: newActions });
    if (selectedActionId === actionId) {
      setSelectedActionId(newActions.length > 0 ? newActions[0].id : null);
    }
  };

  const handleUpdateAction = (actionId: string, updates: Partial<Action>) => {
    onUpdate({
      actions: stage.actions.map((a) => (a.id === actionId ? { ...a, ...updates } : a)),
    });
  };

  const selectedAction = stage.actions.find(a => a.id === selectedActionId);
  const selectedActionIndex = stage.actions.findIndex(a => a.id === selectedActionId);

  return (
    <div className={styles.stageContainer}>
      <div className={styles.stageHeader}>
        <div className={styles.stageHeaderLeft}>
          <button 
            className={styles.dragHandle} 
            title="Drag to reorder"
            disabled
          >
            <GripVertical size={16} />
          </button>
          <button
            className={styles.expandToggle}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <div className={styles.stageIcon}>
            <Layers size={16} />
          </div>
          <input
            type="text"
            value={stage.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className={styles.stageNameInput}
            placeholder="Stage name"
          />
          <span className={styles.stageIndex}>Stage {stageIndex + 1}</span>
        </div>
        <div className={styles.stageHeaderRight}>
          {canMoveUp && (
            <button onClick={onMoveUp} className={styles.moveBtn} title="Move up">
              <ChevronUp size={16} />
            </button>
          )}
          {canMoveDown && (
            <button onClick={onMoveDown} className={styles.moveBtn} title="Move down">
              <ChevronDown size={16} />
            </button>
          )}
          <button onClick={onRemove} className={styles.removeStageBtn} title="Remove stage">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className={styles.stageContent}>
          {/* Action tabs/buttons row */}
          <div className={styles.actionTabsRow}>
            <div className={styles.actionTabs}>
              {stage.actions.map((action, index) => (
                <button
                  key={action.id}
                  className={`${styles.actionTab} ${selectedActionId === action.id ? styles.actionTabSelected : ''}`}
                  onClick={() => setSelectedActionId(action.id)}
                >
                  <span className={styles.actionTabIndex}>{index + 1}</span>
                  <span className={styles.actionTabName}>{action.name}</span>
                </button>
              ))}
              <button onClick={handleAddAction} className={styles.addActionTab} title="Add parallel action">
                <Plus size={14} />
              </button>
            </div>
            {stage.actions.length > 1 && (
              <span className={styles.parallelBadge} title="Actions run in parallel">
                ⚡ {stage.actions.length} parallel
              </span>
            )}
          </div>

          {/* Selected action editor */}
          {selectedAction && (
            <div className={styles.actionEditorPanel}>
              {renderActionEditor(
                selectedAction,
                selectedActionIndex,
                (updates) => handleUpdateAction(selectedAction.id, updates),
                () => handleRemoveAction(selectedAction.id)
              )}
            </div>
          )}

          {stage.actions.length === 0 && (
            <div className={styles.emptyState}>
              <p>No actions in this stage</p>
              <button onClick={handleAddAction} className={styles.addFirstAction}>
                <Plus size={16} />
                Add Action
              </button>
            </div>
          )}

          {stage.actions.length > 1 && (
            <div className={styles.combineSection}>
              <label className={styles.combineLabel}>
                Combine Strategy
                <span className={styles.combineHint}>
                  How to combine outputs from {stage.actions.length} parallel actions
                </span>
              </label>
              <select
                value={stage.combineStrategy}
                onChange={(e) => onUpdate({ combineStrategy: e.target.value as CombineStrategy })}
                className={styles.combineSelect}
              >
                {COMBINE_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} — {s.description}
                  </option>
                ))}
              </select>
              <p className={styles.combineDescription}>
                {stage.combineStrategy === 'first_success' && (
                  <>Output variable: <code>{`{{${stage.name.toLowerCase().replace(/\s+/g, '_')}_output}}`}</code> = first non-error result</>
                )}
                {stage.combineStrategy === 'array' && (
                  <>Output variable: <code>{`{{${stage.name.toLowerCase().replace(/\s+/g, '_')}_output}}`}</code> = [result1, result2, ...]</>
                )}
                {stage.combineStrategy === 'named' && (
                  <>Output variables: <code>{`{{action_name_output}}`}</code> for each action</>
                )}
                {stage.combineStrategy === 'merge_json' && (
                  <>Output variable: <code>{`{{${stage.name.toLowerCase().replace(/\s+/g, '_')}_output}}`}</code> = merged JSON object</>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      <div className={styles.stageConnector}>
        <div className={styles.connectorLine} />
        <div className={styles.connectorArrow}>↓</div>
        <div className={styles.connectorLine} />
      </div>
    </div>
  );
}
