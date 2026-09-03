import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface PlanTodo {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface Plan {
  id: string;
  name: string;
  overview?: string;
  content: string;
  todos: PlanTodo[];
  filePath?: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  isProject?: boolean;
}

interface PlanState {
  plans: Plan[];
  activePlanId: string | null;
  plansDirectory: string;

  setActivePlan: (planId: string | null) => void;
  createPlan: (name: string, content: string, todos: PlanTodo[], conversationId?: string) => Promise<Plan>;
  updatePlan: (planId: string, updates: Partial<Plan>) => void;
  deletePlan: (planId: string) => Promise<void>;
  updateTodoStatus: (planId: string, todoId: string, status: TodoStatus) => void;
  addTodo: (planId: string, content: string) => void;
  removeTodo: (planId: string, todoId: string) => void;
  syncFromFile: (planId: string) => Promise<void>;
  syncToFile: (planId: string) => Promise<void>;
  openPlanInEditor: (planId: string) => Promise<void>;
  loadPlansFromWorkspace: (workspacePath: string) => Promise<void>;
  getPlanById: (planId: string) => Plan | undefined;
  getActivePlan: () => Plan | undefined;
}

function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateTodoId(): string {
  return `todo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

function planToMarkdown(plan: Plan): string {
  const frontmatter = `---
name: ${plan.name}
overview: ${JSON.stringify(plan.overview || '')}
todos:
${plan.todos.map(todo => `  - id: ${todo.id}
    content: ${JSON.stringify(todo.content)}
    status: ${todo.status}`).join('\n')}
isProject: ${plan.isProject || false}
---

`;
  return frontmatter + plan.content;
}

function parsePlanMarkdown(content: string, filePath: string): Plan | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const overviewMatch = frontmatter.match(/^overview:\s*(.+)$/m);
  const isProjectMatch = frontmatter.match(/^isProject:\s*(true|false)$/m);

  const todos: PlanTodo[] = [];
  const todoBlockMatch = frontmatter.match(/todos:\n([\s\S]*?)(?=\n[a-zA-Z]|$)/);
  if (todoBlockMatch) {
    const todoLines = todoBlockMatch[1];
    const todoRegex = /- id: (\S+)\n\s+content: (".*?"|\S+)\n\s+status: (\S+)/g;
    let match;
    while ((match = todoRegex.exec(todoLines)) !== null) {
      let todoContent = match[2];
      if (todoContent.startsWith('"') && todoContent.endsWith('"')) {
        try {
          todoContent = JSON.parse(todoContent);
        } catch {
          todoContent = todoContent.slice(1, -1);
        }
      }
      todos.push({
        id: match[1],
        content: todoContent,
        status: match[3] as TodoStatus,
      });
    }
  }

  let overview = overviewMatch?.[1] || '';
  if (overview.startsWith('"') && overview.endsWith('"')) {
    try {
      overview = JSON.parse(overview);
    } catch {
      overview = overview.slice(1, -1);
    }
  }

  const fileName = filePath.split('/').pop() || '';
  const idMatch = fileName.match(/_([a-f0-9]+)\.plan\.md$/);
  const planId = idMatch ? idMatch[1] : generatePlanId();

  return {
    id: planId,
    name: nameMatch?.[1] || 'Untitled Plan',
    overview,
    content: body.trim(),
    todos,
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isProject: isProjectMatch?.[1] === 'true',
  };
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      plans: [],
      activePlanId: null,
      plansDirectory: '.opencodebrew/plans',

      setActivePlan: (planId) => {
        set({ activePlanId: planId });
      },

      createPlan: async (name, content, todos, conversationId) => {
        const { fs } = await import('../services/tauri');
        const { useWorkspaceStore } = await import('./workspaceStore');
        
        const workspace = useWorkspaceStore.getState().currentWorkspace;
        if (!workspace) {
          throw new Error('No workspace open');
        }

        const planId = generatePlanId().split('-').pop() || Date.now().toString(36);
        const fileName = `${sanitizeFileName(name)}_${planId}.plan.md`;
        const plansDir = `${workspace.rootPath}/${get().plansDirectory}`;
        const filePath = `${plansDir}/${fileName}`;

        const plan: Plan = {
          id: planId,
          name,
          content,
          todos: todos.map(t => ({ ...t, id: t.id || generateTodoId() })),
          filePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          conversationId,
        };

        // Ensure plans directory exists
        try {
          await fs.createDirectory(plansDir);
        } catch {
          // Directory may already exist
        }

        // Write plan file
        const markdown = planToMarkdown(plan);
        await fs.writeFile(filePath, markdown);

        set((state) => ({
          plans: [...state.plans, plan],
          activePlanId: planId,
        }));

        return plan;
      },

      updatePlan: (planId, updates) => {
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId
              ? { ...p, ...updates, updatedAt: new Date().toISOString() }
              : p
          ),
        }));

        // Sync to file
        get().syncToFile(planId);
      },

      deletePlan: async (planId) => {
        const plan = get().getPlanById(planId);
        if (!plan) return;

        if (plan.filePath) {
          try {
            const { fs } = await import('../services/tauri');
            await fs.deletePath(plan.filePath);
          } catch (error) {
            console.error('Failed to delete plan file:', error);
          }
        }

        set((state) => ({
          plans: state.plans.filter((p) => p.id !== planId),
          activePlanId: state.activePlanId === planId ? null : state.activePlanId,
        }));
      },

      updateTodoStatus: (planId, todoId, status) => {
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  todos: p.todos.map((t) =>
                    t.id === todoId ? { ...t, status } : t
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }));

        // Sync to file
        get().syncToFile(planId);
      },

      addTodo: (planId, content) => {
        const newTodo: PlanTodo = {
          id: generateTodoId(),
          content,
          status: 'pending',
        };

        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  todos: [...p.todos, newTodo],
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }));

        get().syncToFile(planId);
      },

      removeTodo: (planId, todoId) => {
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  todos: p.todos.filter((t) => t.id !== todoId),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }));

        get().syncToFile(planId);
      },

      syncFromFile: async (planId) => {
        const plan = get().getPlanById(planId);
        if (!plan?.filePath) return;

        try {
          const { fs } = await import('../services/tauri');
          const content = await fs.readFile(plan.filePath);
          const parsed = parsePlanMarkdown(content, plan.filePath);
          
          if (parsed) {
            set((state) => ({
              plans: state.plans.map((p) =>
                p.id === planId
                  ? { ...p, ...parsed, id: planId }
                  : p
              ),
            }));
          }
        } catch (error) {
          console.error('Failed to sync plan from file:', error);
        }
      },

      syncToFile: async (planId) => {
        const plan = get().getPlanById(planId);
        if (!plan?.filePath) return;

        try {
          const { fs } = await import('../services/tauri');
          const markdown = planToMarkdown(plan);
          await fs.writeFile(plan.filePath, markdown);
        } catch (error) {
          console.error('Failed to sync plan to file:', error);
        }
      },

      openPlanInEditor: async (planId) => {
        const plan = get().getPlanById(planId);
        if (!plan?.filePath) return;

        try {
          const { useEditorStore } = await import('./editorStore');
          await useEditorStore.getState().openFile(plan.filePath);
          set({ activePlanId: planId });
        } catch (error) {
          console.error('Failed to open plan in editor:', error);
        }
      },

      loadPlansFromWorkspace: async (workspacePath) => {
        try {
          const { fs } = await import('../services/tauri');
          const plansDir = `${workspacePath}/${get().plansDirectory}`;
          
          // Check if plans directory exists
          const exists = await fs.pathExists(plansDir);
          if (!exists) {
            set({ plans: [] });
            return;
          }

          const entries = await fs.readDirectory(plansDir);
          const planFiles = entries.filter(
            (e: { name: string; isDirectory: boolean }) => 
              !e.isDirectory && e.name.endsWith('.plan.md')
          );

          const plans: Plan[] = [];
          for (const file of planFiles) {
            try {
              const filePath = `${plansDir}/${file.name}`;
              const content = await fs.readFile(filePath);
              const plan = parsePlanMarkdown(content, filePath);
              if (plan) {
                plans.push(plan);
              }
            } catch (error) {
              console.error(`Failed to load plan ${file.name}:`, error);
            }
          }

          set({ plans });
        } catch (error) {
          console.error('Failed to load plans from workspace:', error);
          set({ plans: [] });
        }
      },

      getPlanById: (planId) => {
        return get().plans.find((p) => p.id === planId);
      },

      getActivePlan: () => {
        const { activePlanId, plans } = get();
        return activePlanId ? plans.find((p) => p.id === activePlanId) : undefined;
      },
    }),
    {
      name: 'opencodebrew-plans',
      partialize: (state) => ({
        activePlanId: state.activePlanId,
      }),
    }
  )
);
