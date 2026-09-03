import { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Play,
  Check,
  Circle,
  Clock,
  SkipForward,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { usePlanStore, Plan, PlanTodo, TodoStatus } from '../../store/planStore';
import { useAIStore } from '../../store/aiStore';
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

interface PlanFileViewerProps {
  planId: string;
}

export function PlanFileViewer({ planId }: PlanFileViewerProps) {
  const { getPlanById, updateTodoStatus, syncFromFile, addTodo } = usePlanStore();
  const { setAgentMode, sendMessage, setAgentTasks, queuePrompt } = useAIStore();
  const [newTodoText, setNewTodoText] = useState('');
  const [showAddTodo, setShowAddTodo] = useState(false);
  const [todosExpanded, setTodosExpanded] = useState(true);

  const plan = getPlanById(planId);

  useEffect(() => {
    if (planId) {
      syncFromFile(planId);
    }
  }, [planId, syncFromFile]);

  const stats = useMemo(() => {
    if (!plan) return { completed: 0, total: 0, percent: 0 };
    const completed = plan.todos.filter((t) => t.status === 'completed').length;
    const total = plan.todos.length;
    return {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [plan]);

  const handleTodoClick = (todo: PlanTodo) => {
    const statusOrder: TodoStatus[] = ['pending', 'in_progress', 'completed', 'skipped'];
    const currentIndex = statusOrder.indexOf(todo.status);
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];
    updateTodoStatus(planId, todo.id, nextStatus);
  };

  const handleRunInAgent = () => {
    if (!plan) return;
    
    const pendingTodos = plan.todos.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    );
    
    if (pendingTodos.length === 0) return;

    setAgentMode('agent');
    setAgentTasks(pendingTodos.map((t) => t.content));

    // Send first task
    const firstTask = pendingTodos[0];
    sendMessage(
      `Implement task 1 of ${pendingTodos.length}: ${firstTask.content}\n\nCreate or edit files as needed. Reply when done.`
    );

    // Queue remaining tasks
    pendingTodos.slice(1).forEach((task, i) => {
      queuePrompt(
        `Implement task ${i + 2} of ${pendingTodos.length}: ${task.content}\n\nCreate or edit files as needed. Reply when done.`
      );
    });
  };

  const handleAddTodo = () => {
    if (newTodoText.trim()) {
      addTodo(planId, newTodoText.trim());
      setNewTodoText('');
      setShowAddTodo(false);
    }
  };

  if (!plan) {
    return (
      <div className={styles.planViewer}>
        <div className={styles.emptyState}>
          <FileText size={32} className={styles.emptyIcon} />
          <p>Plan not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.planViewer}>
      <div className={styles.viewerHeader}>
        <div className={styles.viewerTitle}>
          <FileText size={16} />
          <span>{plan.name}</span>
        </div>
        <div className={styles.viewerActions}>
          <button
            className={styles.viewerActionBtn}
            onClick={() => syncFromFile(planId)}
            title="Refresh from file"
          >
            <RefreshCw size={14} />
          </button>
          <button
            className={`${styles.viewerActionBtn} ${styles.primary}`}
            onClick={handleRunInAgent}
            disabled={stats.completed === stats.total}
          >
            <Play size={14} />
            Run in Agent
          </button>
        </div>
      </div>

      <div className={styles.viewerContent}>
        <div className={styles.viewerTodos}>
          <div className={styles.viewerTodosHeader}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              onClick={() => setTodosExpanded(!todosExpanded)}
            >
              {todosExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className={styles.viewerTodosTitle}>
                {stats.total} To-dos
              </span>
            </div>
            <span className={styles.viewerTodosCount}>
              {stats.completed} done
            </span>
          </div>

          {todosExpanded && (
            <>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${stats.percent}%` }}
                />
              </div>

              <div className={styles.todoList}>
                {plan.todos.map((todo) => (
                  <div
                    key={todo.id}
                    className={`${styles.todoItem} ${styles[`todoStatus${todo.status.replace('_', '')}`]}`}
                    onClick={() => handleTodoClick(todo)}
                  >
                    <div className={styles.todoCheckbox}>
                      <TodoStatusIcon status={todo.status} />
                    </div>
                    <span className={styles.todoContent}>{todo.content}</span>
                  </div>
                ))}
              </div>

              {showAddTodo ? (
                <div style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTodo();
                      if (e.key === 'Escape') setShowAddTodo(false);
                    }}
                    placeholder="New task..."
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 12,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowAddTodo(true)}
                  style={{
                    marginTop: 8,
                    padding: '6px 8px',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    width: '100%',
                    borderRadius: 4,
                  }}
                >
                  + New
                </button>
              )}
            </>
          )}
        </div>

        <div className={styles.viewerBody}>
          {plan.overview && (
            <div className={styles.viewerOverview}>
              <h3>Overview</h3>
              <p>{plan.overview}</p>
            </div>
          )}

          <div className={styles.viewerMarkdown}>
            <PlanMarkdownContent content={plan.content} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanMarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('# ')) {
      elements.push(<h1 key={key++}>{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={key++}>{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={key++}>{line.slice(4)}</h3>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [line.slice(2)];
      while (i + 1 < lines.length && (lines[i + 1].startsWith('- ') || lines[i + 1].startsWith('* '))) {
        i++;
        items.push(lines[i].slice(2));
      }
      elements.push(
        <ul key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      );
    } else if (line.trim() === '') {
      continue;
    } else {
      elements.push(<p key={key++}>{line}</p>);
    }
  }

  return <>{elements}</>;
}

export function PlanFileViewerWrapper({ filePath }: { filePath: string }) {
  const { plans, loadPlansFromWorkspace } = usePlanStore();
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    const plan = plans.find((p) => p.filePath === filePath);
    if (plan) {
      setPlanId(plan.id);
    } else {
      const idMatch = filePath.match(/_([a-f0-9]+)\.plan\.md$/);
      if (idMatch) {
        setPlanId(idMatch[1]);
      }
    }
  }, [filePath, plans]);

  if (!planId) {
    return (
      <div className={styles.planViewer}>
        <div className={styles.emptyState}>
          <FileText size={32} className={styles.emptyIcon} />
          <p>Loading plan...</p>
        </div>
      </div>
    );
  }

  return <PlanFileViewer planId={planId} />;
}
