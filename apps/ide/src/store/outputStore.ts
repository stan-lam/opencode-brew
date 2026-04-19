import { create } from 'zustand';

export interface OutputChannel {
  id: string;
  name: string;
  content: string[];
}

interface OutputState {
  channels: OutputChannel[];
  activeChannel: string;
  
  log: (channelId: string, message: string) => void;
  logMultiple: (channelId: string, messages: string[]) => void;
  clearChannel: (channelId: string) => void;
  setActiveChannel: (channelId: string) => void;
  addChannel: (channel: OutputChannel) => void;
  removeChannel: (channelId: string) => void;
  getChannel: (channelId: string) => OutputChannel | undefined;
}

const defaultChannels: OutputChannel[] = [
  { id: 'main', name: 'OpenCodeBrew', content: [`[${new Date().toLocaleTimeString()}] OpenCodeBrew started successfully.`] },
  { id: 'git', name: 'Git', content: [] },
  { id: 'ai', name: 'AI Assistant', content: [] },
  { id: 'build', name: 'Build', content: [] },
  { id: 'run', name: 'Run', content: [] },
];

export const useOutputStore = create<OutputState>((set, get) => ({
  channels: defaultChannels,
  activeChannel: 'main',

  log: (channelId: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === channelId
          ? { ...c, content: [...c.content, formattedMessage] }
          : c
      ),
    }));
  },

  logMultiple: (channelId: string, messages: string[]) => {
    const timestamp = new Date().toLocaleTimeString();
    
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === channelId
          ? { ...c, content: [...c.content, ...messages.map(m => `[${timestamp}] ${m}`)] }
          : c
      ),
    }));
  },

  clearChannel: (channelId: string) => {
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === channelId ? { ...c, content: [] } : c
      ),
    }));
  },

  setActiveChannel: (channelId: string) => {
    set({ activeChannel: channelId });
  },

  addChannel: (channel: OutputChannel) => {
    set((state) => ({
      channels: state.channels.some(c => c.id === channel.id)
        ? state.channels
        : [...state.channels, channel],
    }));
  },

  removeChannel: (channelId: string) => {
    set((state) => ({
      channels: state.channels.filter(c => c.id !== channelId),
      activeChannel: state.activeChannel === channelId ? 'main' : state.activeChannel,
    }));
  },

  getChannel: (channelId: string) => {
    return get().channels.find(c => c.id === channelId);
  },
}));

// Helper functions for common logging operations
export const output = {
  main: (message: string) => useOutputStore.getState().log('main', message),
  git: (message: string) => useOutputStore.getState().log('git', message),
  ai: (message: string) => useOutputStore.getState().log('ai', message),
  build: (message: string) => useOutputStore.getState().log('build', message),
  run: (message: string) => useOutputStore.getState().log('run', message),
  
  custom: (channelId: string, message: string) => useOutputStore.getState().log(channelId, message),
  
  clear: (channelId: string) => useOutputStore.getState().clearChannel(channelId),
  show: (channelId: string) => useOutputStore.getState().setActiveChannel(channelId),
};
