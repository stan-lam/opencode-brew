import { create } from 'zustand';
import { project, ProjectInfo } from '../services/tauri';

export interface RunConfiguration {
  id: string;
  name: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory: string;
  isDefault: boolean;
}

interface ProjectState {
  projectInfo: ProjectInfo | null;
  isDetecting: boolean;
  runConfigurations: RunConfiguration[];
  activeConfiguration: RunConfiguration | null;
  isRunning: boolean;
  runningProcessId: string | null;
  
  detectProject: (path: string) => Promise<void>;
  setRunConfigurations: (configs: RunConfiguration[]) => void;
  addRunConfiguration: (config: RunConfiguration) => void;
  removeRunConfiguration: (id: string) => void;
  setActiveConfiguration: (config: RunConfiguration | null) => void;
  setIsRunning: (running: boolean, processId?: string) => void;
  getDefaultConfiguration: () => RunConfiguration | null;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectInfo: null,
  isDetecting: false,
  runConfigurations: [],
  activeConfiguration: null,
  isRunning: false,
  runningProcessId: null,

  detectProject: async (path: string) => {
    set({ isDetecting: true });
    try {
      const info = await project.detect(path);
      console.log('Detected project:', info);
      
      // Generate default run configurations based on project type
      const configs = generateDefaultConfigs(info, path);
      
      set({ 
        projectInfo: info,
        runConfigurations: configs,
        activeConfiguration: configs.find(c => c.isDefault) || configs[0] || null,
      });
    } catch (error) {
      console.error('Failed to detect project:', error);
      set({ projectInfo: null });
    } finally {
      set({ isDetecting: false });
    }
  },

  setRunConfigurations: (configs) => {
    set({ runConfigurations: configs });
  },

  addRunConfiguration: (config) => {
    set((state) => ({
      runConfigurations: [...state.runConfigurations, config],
    }));
  },

  removeRunConfiguration: (id) => {
    set((state) => ({
      runConfigurations: state.runConfigurations.filter(c => c.id !== id),
      activeConfiguration: state.activeConfiguration?.id === id ? null : state.activeConfiguration,
    }));
  },

  setActiveConfiguration: (config) => {
    set({ activeConfiguration: config });
  },

  setIsRunning: (running, processId) => {
    set({ 
      isRunning: running,
      runningProcessId: processId || null,
    });
  },

  getDefaultConfiguration: () => {
    const { runConfigurations } = get();
    return runConfigurations.find(c => c.isDefault) || runConfigurations[0] || null;
  },
}));

function generateDefaultConfigs(info: ProjectInfo, workingDirectory: string): RunConfiguration[] {
  const configs: RunConfiguration[] = [];

  switch (info.project_type) {
    case 'npm':
      // Add script-based configurations
      if (info.scripts.dev) {
        configs.push({
          id: 'npm-dev',
          name: 'npm run dev',
          type: 'npm',
          command: 'npm',
          args: ['run', 'dev'],
          env: {},
          workingDirectory,
          isDefault: true,
        });
      }
      if (info.scripts.start) {
        configs.push({
          id: 'npm-start',
          name: 'npm start',
          type: 'npm',
          command: 'npm',
          args: ['start'],
          env: {},
          workingDirectory,
          isDefault: !info.scripts.dev,
        });
      }
      if (info.scripts.build) {
        configs.push({
          id: 'npm-build',
          name: 'npm run build',
          type: 'npm',
          command: 'npm',
          args: ['run', 'build'],
          env: {},
          workingDirectory,
          isDefault: false,
        });
      }
      if (info.scripts.test) {
        configs.push({
          id: 'npm-test',
          name: 'npm test',
          type: 'npm',
          command: 'npm',
          args: ['test'],
          env: {},
          workingDirectory,
          isDefault: false,
        });
      }
      break;

    case 'cargo':
      configs.push({
        id: 'cargo-run',
        name: 'cargo run',
        type: 'cargo',
        command: 'cargo',
        args: ['run'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      configs.push({
        id: 'cargo-build',
        name: 'cargo build',
        type: 'cargo',
        command: 'cargo',
        args: ['build'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      configs.push({
        id: 'cargo-build-release',
        name: 'cargo build --release',
        type: 'cargo',
        command: 'cargo',
        args: ['build', '--release'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      configs.push({
        id: 'cargo-test',
        name: 'cargo test',
        type: 'cargo',
        command: 'cargo',
        args: ['test'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      break;

    case 'python':
      configs.push({
        id: 'python-main',
        name: 'python main.py',
        type: 'python',
        command: 'python',
        args: ['main.py'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      break;

    case 'go':
      configs.push({
        id: 'go-run',
        name: 'go run .',
        type: 'go',
        command: 'go',
        args: ['run', '.'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      configs.push({
        id: 'go-build',
        name: 'go build',
        type: 'go',
        command: 'go',
        args: ['build'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      configs.push({
        id: 'go-test',
        name: 'go test',
        type: 'go',
        command: 'go',
        args: ['test', './...'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      break;

    case 'maven':
      configs.push({
        id: 'maven-run',
        name: 'mvn exec:java',
        type: 'maven',
        command: 'mvn',
        args: ['exec:java'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      configs.push({
        id: 'maven-compile',
        name: 'mvn compile',
        type: 'maven',
        command: 'mvn',
        args: ['compile'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      break;

    case 'gradle':
      configs.push({
        id: 'gradle-run',
        name: 'gradle run',
        type: 'gradle',
        command: './gradlew',
        args: ['run'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      configs.push({
        id: 'gradle-build',
        name: 'gradle build',
        type: 'gradle',
        command: './gradlew',
        args: ['build'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      break;

    case 'make':
      configs.push({
        id: 'make-default',
        name: 'make',
        type: 'make',
        command: 'make',
        args: [],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      configs.push({
        id: 'make-run',
        name: 'make run',
        type: 'make',
        command: 'make',
        args: ['run'],
        env: {},
        workingDirectory,
        isDefault: false,
      });
      break;

    case 'cmake':
      configs.push({
        id: 'cmake-build',
        name: 'cmake --build build',
        type: 'cmake',
        command: 'cmake',
        args: ['--build', 'build'],
        env: {},
        workingDirectory,
        isDefault: true,
      });
      break;
  }

  return configs;
}
