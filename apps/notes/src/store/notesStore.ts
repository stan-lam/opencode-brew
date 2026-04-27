import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Workspace {
  id: string;
  name: string;
  icon?: string;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  workspace_id: string;
  parent_id?: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  folder_id?: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: string;
  created_at: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}

interface NotesState {
  // Data
  workspaces: Workspace[];
  folders: Folder[];
  conversations: Conversation[];
  messages: Message[];
  tags: Tag[];
  conversationTags: Map<string, string[]>; // conversation_id -> tag_ids
  
  // UI State
  activeWorkspaceId: string | null;
  activeFolderId: string | null;
  activeConversationId: string | null;
  sidebarExpanded: boolean;
  showArchived: boolean;
  searchQuery: string;
  isLoading: boolean;
  isStreaming: boolean;
  
  // Actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  setFolders: (folders: Folder[]) => void;
  setConversations: (conversations: Conversation[]) => void;
  setMessages: (messages: Message[]) => void;
  setTags: (tags: Tag[]) => void;
  
  setActiveWorkspace: (id: string | null) => void;
  setActiveFolder: (id: string | null) => void;
  setActiveConversation: (id: string | null) => void;
  
  addMessage: (message: Message) => void;
  updateMessageContent: (id: string, content: string) => void;
  updateMessageId: (oldId: string, newId: string) => void;
  
  toggleSidebar: () => void;
  setShowArchived: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setIsLoading: (loading: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  
  // Helpers
  getActiveWorkspace: () => Workspace | undefined;
  getActiveConversation: () => Conversation | undefined;
  getFoldersForWorkspace: (workspaceId: string) => Folder[];
  getConversationsForFolder: (folderId: string | null) => Conversation[];
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      // Initial data state
      workspaces: [],
      folders: [],
      conversations: [],
      messages: [],
      tags: [],
      conversationTags: new Map(),
      
      // Initial UI state
      activeWorkspaceId: null,
      activeFolderId: null,
      activeConversationId: null,
      sidebarExpanded: true,
      showArchived: false,
      searchQuery: '',
      isLoading: false,
      isStreaming: false,
      
      // Actions
      setWorkspaces: (workspaces) => set({ workspaces }),
      setFolders: (folders) => set({ folders }),
      setConversations: (conversations) => set({ conversations }),
      setMessages: (messages) => set({ messages }),
      setTags: (tags) => set({ tags }),
      
      setActiveWorkspace: (id) => {
        const current = get().activeWorkspaceId;
        if (current === id) return; // Don't reset if same workspace
        set({ 
          activeWorkspaceId: id, 
          activeFolderId: null,
          activeConversationId: null,
          messages: [],
        });
      },
      setActiveFolder: (id) => {
        const current = get().activeFolderId;
        if (current === id) return; // Don't reset if same folder
        set({ 
          activeFolderId: id,
          activeConversationId: null,
          messages: [],
        });
      },
      setActiveConversation: (id) => {
        const current = get().activeConversationId;
        if (current === id) return; // Don't reload if same conversation
        set({ 
          activeConversationId: id,
          messages: [], // Clear messages - ChatPanel will load them
        });
      },
      
      addMessage: (message) => set((state) => ({
        messages: [...state.messages, message],
      })),
      
      updateMessageContent: (id, content) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, content } : m
        ),
      })),

      updateMessageId: (oldId, newId) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === oldId ? { ...m, id: newId } : m
        ),
      })),
      
      toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
      setShowArchived: (show) => set({ showArchived: show }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setIsLoading: (loading) => set({ isLoading: loading }),
      setIsStreaming: (streaming) => set({ isStreaming: streaming }),
      
      // Helpers
      getActiveWorkspace: () => {
        const { workspaces, activeWorkspaceId } = get();
        return workspaces.find((w) => w.id === activeWorkspaceId);
      },
      
      getActiveConversation: () => {
        const { conversations, activeConversationId } = get();
        return conversations.find((c) => c.id === activeConversationId);
      },
      
      getFoldersForWorkspace: (workspaceId) => {
        const { folders } = get();
        return folders.filter((f) => f.workspace_id === workspaceId);
      },
      
      getConversationsForFolder: (folderId) => {
        const { conversations, activeWorkspaceId, showArchived } = get();
        return conversations.filter((c) => 
          c.workspace_id === activeWorkspaceId &&
          c.folder_id === folderId &&
          c.archived === showArchived
        );
      },
    }),
    {
      name: 'opencodebrew-notes',
      version: 1,
      partialize: (state) => ({
        activeWorkspaceId: state.activeWorkspaceId,
        sidebarExpanded: state.sidebarExpanded,
      }),
    }
  )
);
