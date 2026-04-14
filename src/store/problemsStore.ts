import { create } from 'zustand';

export interface Problem {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
}

interface ProblemsState {
  problems: Problem[];
  
  setProblemsForFile: (file: string, problems: Problem[]) => void;
  clearProblemsForFile: (file: string) => void;
  clearAllProblems: () => void;
  getProblemsForFile: (file: string) => Problem[];
  getCounts: () => { errors: number; warnings: number; info: number };
}

export const useProblemsStore = create<ProblemsState>((set, get) => ({
  problems: [],

  setProblemsForFile: (file: string, newProblems: Problem[]) => {
    set((state) => ({
      problems: [
        ...state.problems.filter(p => p.file !== file),
        ...newProblems.map(p => ({ ...p, file })),
      ],
    }));
  },

  clearProblemsForFile: (file: string) => {
    set((state) => ({
      problems: state.problems.filter(p => p.file !== file),
    }));
  },

  clearAllProblems: () => {
    set({ problems: [] });
  },

  getProblemsForFile: (file: string) => {
    return get().problems.filter(p => p.file === file);
  },

  getCounts: () => {
    const problems = get().problems;
    return {
      errors: problems.filter(p => p.type === 'error').length,
      warnings: problems.filter(p => p.type === 'warning').length,
      info: problems.filter(p => p.type === 'info').length,
    };
  },
}));
