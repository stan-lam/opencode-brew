import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Trash2,
  Check,
  Circle,
  Clock,
  SkipForward,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react';
import { usePlanStore, Plan, PlanTodo, TodoStatus } from '../../store/planStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import styles from './Plans.module.css';

const TodoStatusIcon = ({ status }: { status: TodoStatus }) => {
  switch (status) {
    case 'completed':
      return <Check size={14} className={styles.todoIconCompleted} />;
    case 'in_progress':
      return <Clock size={14} className={styles.todoIconInProgress} />;
    case 'skipped':
      return <SkipForward size={14} className={styles.todoIconSkipped} />;
    default:
      return <Circle size={14} className={styles.todoIconPending} />;
  }
};

const TodoItem = ({
  todo,
  planId,
  onStatusChange,
}: {
  todo: PlanTodo;
  planId: string;
  onStatusChange: (todoId: string, status: TodoStatus) => void;
}) => {
  const cycleStatus = () => {
    const statusOrder: TodoStatus[] = ['pending', 'in_progress', 'completed', 'skipped'];
    const currentIndex = statusOrder.indexOf(todo.status);
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];
    onStatusChange(todo.id, nextStatus);
  };

  return (
    <div
      className={`${styles.todoItem} ${styles[`todoStatus${todo.status.replace('_', '')}`]}`}
      onClick={cycleStatus}
    >
      <div className={styles.todoCheckbox}>
        <TodoStatusIcon status={todo.status} />
      </div>
      <span className={styles.todoContent}>{todo.content}</span>
    </div>
  );
};

const PlanCard = ({
  plan,
  isExpanded,
  onToggle,
  onOpen,
  onDelete,
}: {
  plan: Plan;
  isExpanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  const { updateTodoStatus } = usePlanStore();
  const [showMenu, setShowMenu] = useState(false);

  const completedCount = plan.todos.filter((t) => t.status === 'completed').length;
  const totalCount = plan.todos.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={styles.planCard}>
      <div className={styles.planHeader} onClick={onToggle}>
        <div className={styles.planHeaderLeft}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} className={styles.planIcon} />
          <span className={styles.planName}>{plan.name}</span>
        </div>
        <div className={styles.planHeaderRight}>
          <span className={styles.planProgress}>
            {completedCount}/{totalCount}
          </span>
          <button
            className={styles.planMenuBtn}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {showMenu && (
            <div className={styles.planMenu}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen();
                  setShowMenu(false);
                }}
              >
                <ExternalLink size={12} />
                Open in Editor
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                  setShowMenu(false);
                }}
                className={styles.dangerBtn}
              >
                <Trash2 size={12} />
                Delete Plan
              </button>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className={styles.planContent}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className={styles.todoList}>
            {plan.todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                planId={plan.id}
                onStatusChange={(todoId, status) =>
                  updateTodoStatus(plan.id, todoId, status)
                }
              />
            ))}
          </div>

          {plan.todos.length === 0 && (
            <div className={styles.emptyTodos}>No tasks in this plan</div>
          )}
        </div>
      )}
    </div>
  );
};

export function PlansSidePanel() {
  const { plans, activePlanId, loadPlansFromWorkspace, openPlanInEditor, deletePlan } =
    usePlanStore();
  const { currentWorkspace } = useWorkspaceStore();
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentWorkspace?.rootPath) {
      loadPlansFromWorkspace(currentWorkspace.rootPath);
    }
  }, [currentWorkspace?.rootPath, loadPlansFromWorkspace]);

  useEffect(() => {
    if (activePlanId && !expandedPlans.has(activePlanId)) {
      setExpandedPlans((prev) => new Set(prev).add(activePlanId));
    }
  }, [activePlanId]);

  const togglePlan = (planId: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) {
        next.delete(planId);
      } else {
        next.add(planId);
      }
      return next;
    });
  };

  const handleDeletePlan = async (planId: string) => {
    if (window.confirm('Are you sure you want to delete this plan?')) {
      await deletePlan(planId);
    }
  };

  const totalTodos = plans.reduce((acc, p) => acc + p.todos.length, 0);
  const completedTodos = plans.reduce(
    (acc, p) => acc + p.todos.filter((t) => t.status === 'completed').length,
    0
  );

  return (
    <div className={styles.plansPanel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Plans</span>
        {plans.length > 0 && (
          <span className={styles.panelStats}>
            {completedTodos}/{totalTodos} tasks
          </span>
        )}
      </div>

      <div className={styles.plansList}>
        {plans.length === 0 ? (
          <div className={styles.emptyState}>
            <FileText size={32} className={styles.emptyIcon} />
            <p>No plans yet</p>
            <span className={styles.emptyHint}>
              Create a plan in Plan Mode to get started
            </span>
          </div>
        ) : (
          plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isExpanded={expandedPlans.has(plan.id)}
              onToggle={() => togglePlan(plan.id)}
              onOpen={() => openPlanInEditor(plan.id)}
              onDelete={() => handleDeletePlan(plan.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
