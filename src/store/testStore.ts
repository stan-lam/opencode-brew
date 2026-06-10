import { create } from 'zustand';
import { git, GitFileStatus } from '../services/tauri';
import { useWorkspaceStore } from './workspaceStore';
import { useAIStore } from './aiStore';

export interface PendingChange {
  path: string;
  status: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface TestFile {
  id: string;
  path: string;
  description: string;
  testCount: number;
  selected: boolean;
}

export interface TestCategory {
  id: string;
  name: string;
  testFiles: TestFile[];
  expanded: boolean;
}

export interface TestPlan {
  categories: TestCategory[];
  totalTests: number;
}

export interface CVEEntry {
  id: string;
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  fixAvailable: boolean;
}

export interface DependencyAudit {
  cves: CVEEntry[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

interface TestState {
  pendingChanges: PendingChange[];
  testPlan: TestPlan | null;
  selectedTests: Set<string>;
  dependencyAudit: DependencyAudit | null;
  isAnalyzing: boolean;
  isFetchingChanges: boolean;
  customInstructions: string;
  error: string | null;
  lastFetchedAt: string | null;

  fetchPendingChanges: () => Promise<void>;
  analyzeChanges: (instructions?: string, focusType?: 'unit' | 'security' | 'audit') => Promise<void>;
  setCustomInstructions: (text: string) => void;
  toggleTestSelection: (testId: string) => void;
  selectAllTests: () => void;
  deselectAllTests: () => void;
  toggleCategoryExpanded: (categoryId: string) => void;
  createSelectedTests: () => Promise<void>;
  clearTestPlan: () => void;
  setError: (error: string | null) => void;
}

export const useTestStore = create<TestState>((set, get) => ({
  pendingChanges: [],
  testPlan: null,
  selectedTests: new Set(),
  dependencyAudit: null,
  isAnalyzing: false,
  isFetchingChanges: false,
  customInstructions: '',
  error: null,
  lastFetchedAt: null,

  fetchPendingChanges: async () => {
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    set({ isFetchingChanges: true, error: null });

    try {
      const status = await git.status(workspace.rootPath);
      
      const changes: PendingChange[] = [];
      
      status.staged.forEach((file: GitFileStatus) => {
        changes.push({
          path: file.path,
          status: file.status,
          staged: true,
        });
      });
      
      status.unstaged.forEach((file: GitFileStatus) => {
        const existing = changes.find(c => c.path === file.path);
        if (!existing) {
          changes.push({
            path: file.path,
            status: file.status,
            staged: false,
          });
        }
      });
      
      status.untracked.forEach((file: GitFileStatus) => {
        changes.push({
          path: file.path,
          status: 'untracked',
          staged: false,
        });
      });

      set({ 
        pendingChanges: changes, 
        isFetchingChanges: false,
        lastFetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      set({ 
        error: `Failed to fetch changes: ${error}`,
        isFetchingChanges: false,
      });
    }
  },

  analyzeChanges: async (instructions?: string, focusType?: 'unit' | 'security' | 'audit') => {
    const { pendingChanges } = get();
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    if (pendingChanges.length === 0) {
      set({ error: 'No pending changes to analyze' });
      return;
    }

    set({ isAnalyzing: true, error: null });

    try {
      const aiStore = useAIStore.getState();
      
      aiStore.setAgentMode('test');
      
      let prompt = `Analyze the following pending changes and generate a test plan:\n\n`;
      prompt += `**Changed Files:**\n`;
      pendingChanges.forEach(change => {
        prompt += `- ${change.path} (${change.status}${change.staged ? ', staged' : ''})\n`;
      });
      
      if (focusType) {
        prompt += `\n**Focus:** ${focusType === 'unit' ? 'Unit Tests' : focusType === 'security' ? 'Security Tests' : 'Dependency Audit'}\n`;
      }
      
      if (instructions) {
        prompt += `\n**Additional Instructions:** ${instructions}\n`;
      }
      
      prompt += `\nPlease generate a structured test plan with <test_plan> tags.`;
      
      await aiStore.sendMessage(prompt);
      
      set({ isAnalyzing: false });
    } catch (error) {
      set({ 
        error: `Analysis failed: ${error}`,
        isAnalyzing: false,
      });
    }
  },

  setCustomInstructions: (text: string) => {
    set({ customInstructions: text });
  },

  toggleTestSelection: (testId: string) => {
    set(state => {
      const newSelected = new Set(state.selectedTests);
      if (newSelected.has(testId)) {
        newSelected.delete(testId);
      } else {
        newSelected.add(testId);
      }
      return { selectedTests: newSelected };
    });
  },

  selectAllTests: () => {
    const { testPlan } = get();
    if (!testPlan) return;

    const allTestIds = new Set<string>();
    testPlan.categories.forEach(cat => {
      cat.testFiles.forEach(file => {
        allTestIds.add(file.id);
      });
    });
    set({ selectedTests: allTestIds });
  },

  deselectAllTests: () => {
    set({ selectedTests: new Set() });
  },

  toggleCategoryExpanded: (categoryId: string) => {
    set(state => {
      if (!state.testPlan) return state;
      
      const newCategories = state.testPlan.categories.map(cat => 
        cat.id === categoryId ? { ...cat, expanded: !cat.expanded } : cat
      );
      
      return {
        testPlan: {
          ...state.testPlan,
          categories: newCategories,
        },
      };
    });
  },

  createSelectedTests: async () => {
    const { selectedTests, testPlan } = get();
    
    if (selectedTests.size === 0) {
      set({ error: 'No tests selected' });
      return;
    }

    if (!testPlan) {
      set({ error: 'No test plan available' });
      return;
    }

    const aiStore = useAIStore.getState();
    
    const selectedFilesList: string[] = [];
    testPlan.categories.forEach(cat => {
      cat.testFiles.forEach(file => {
        if (selectedTests.has(file.id)) {
          selectedFilesList.push(`- ${file.path}: ${file.description}`);
        }
      });
    });

    const prompt = `Please create the following test files:\n\n${selectedFilesList.join('\n')}\n\nGenerate the complete test code for each file.`;
    
    await aiStore.sendMessage(prompt);
  },

  clearTestPlan: () => {
    set({ 
      testPlan: null, 
      selectedTests: new Set(),
      dependencyAudit: null,
    });
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));
