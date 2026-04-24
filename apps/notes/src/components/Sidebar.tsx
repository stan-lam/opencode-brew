import { useEffect, useState } from 'react';
import { 
  Plus, 
  FolderPlus, 
  MessageSquare, 
  Folder, 
  ChevronRight, 
  ChevronDown,
  Search,
  Archive,
  Settings,
  Trash2,
  Pin,
} from 'lucide-react';
import { useNotesStore, Folder as FolderType, Conversation } from '../store/notesStore';
import { SettingsModal } from './SettingsModal';
import styles from './Sidebar.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

export function Sidebar() {
  const {
    workspaces,
    folders,
    conversations,
    activeWorkspaceId,
    activeFolderId,
    activeConversationId,
    sidebarExpanded,
    showArchived,
    searchQuery,
    setFolders,
    setConversations,
    setActiveWorkspace,
    setActiveFolder,
    setActiveConversation,
    setShowArchived,
    setSearchQuery,
    toggleSidebar,
  } = useNotesStore();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  // Load folders and conversations when workspace changes
  useEffect(() => {
    const loadData = async () => {
      if (!activeWorkspaceId) return;
      
      try {
        const invoke = await getInvoke();
        
        const loadedFolders = await invoke('list_folders', { workspaceId: activeWorkspaceId });
        setFolders(loadedFolders as FolderType[]);
        
        const loadedConversations = await invoke('list_conversations', { 
          workspaceId: activeWorkspaceId,
          folderId: null,
          archived: showArchived,
        });
        setConversations(loadedConversations as Conversation[]);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };

    loadData();
  }, [activeWorkspaceId, showArchived]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleNewConversation = async () => {
    if (!activeWorkspaceId) return;
    
    try {
      const invoke = await getInvoke();
      const newConversation = await invoke('create_conversation', {
        workspaceId: activeWorkspaceId,
        title: 'New Chat',
        folderId: activeFolderId,
      }) as Conversation;
      
      setConversations([newConversation, ...conversations]);
      setActiveConversation(newConversation.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleNewFolder = async () => {
    if (!activeWorkspaceId) return;
    
    try {
      const invoke = await getInvoke();
      const newFolder = await invoke('create_folder', {
        workspaceId: activeWorkspaceId,
        name: 'New Folder',
        parentId: null,
      }) as FolderType;
      
      setFolders([...folders, newFolder]);
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      const invoke = await getInvoke();
      await invoke('delete_conversation', { id: conversationId });
      
      // Remove from local state
      setConversations(conversations.filter(c => c.id !== conversationId));
      
      // Clear active conversation if it was deleted
      if (activeConversationId === conversationId) {
        setActiveConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (conversationId: string, newTitle: string) => {
    try {
      const invoke = await getInvoke();
      await invoke('update_conversation', { 
        id: conversationId, 
        title: newTitle,
      });
      
      // Update local state
      setConversations(conversations.map(c => 
        c.id === conversationId ? { ...c, title: newTitle } : c
      ));
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  const handleRenameFolder = async (folderId: string, newName: string) => {
    try {
      const invoke = await getInvoke();
      const folder = folders.find(f => f.id === folderId);
      await invoke('update_folder', { 
        id: folderId, 
        name: newName,
        parentId: folder?.parent_id || null,
      });
      
      // Update local state
      setFolders(folders.map(f => 
        f.id === folderId ? { ...f, name: newName } : f
      ));
    } catch (error) {
      console.error('Failed to rename folder:', error);
    }
  };

  const rootFolders = folders.filter((f) => !f.parent_id);
  const rootConversations = conversations.filter((c) => !c.folder_id && c.archived === showArchived);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  if (!sidebarExpanded) {
    return (
      <div className={styles.collapsedSidebar}>
        <button onClick={toggleSidebar} className={styles.expandBtn}>
          <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.workspaceSelector}>
          <select
            value={activeWorkspaceId || ''}
            onChange={(e) => setActiveWorkspace(e.target.value)}
            className={styles.workspaceSelect}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.headerActions}>
          <button onClick={handleNewConversation} className={styles.iconBtn} title="New Chat">
            <Plus size={18} />
          </button>
          <button onClick={handleNewFolder} className={styles.iconBtn} title="New Folder">
            <FolderPlus size={18} />
          </button>
        </div>
      </div>

      <div className={styles.searchBar}>
        <Search size={16} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      <div className={styles.content}>
        <div className={styles.section}>
          {rootFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              expanded={expandedFolders.has(folder.id)}
              onToggle={() => toggleFolder(folder.id)}
              isActive={activeFolderId === folder.id}
              onSelect={() => setActiveFolder(folder.id)}
              onRename={(newName) => handleRenameFolder(folder.id, newName)}
            />
          ))}
          
          {rootConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={activeConversationId === conv.id}
              onSelect={() => setActiveConversation(conv.id)}
              onDelete={() => handleDeleteConversation(conv.id)}
              onRename={(newTitle) => handleRenameConversation(conv.id, newTitle)}
            />
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <button 
          onClick={() => setShowArchived(!showArchived)}
          className={`${styles.footerBtn} ${showArchived ? styles.active : ''}`}
        >
          <Archive size={16} />
          <span>{showArchived ? 'Show Active' : 'Archived'}</span>
        </button>
        <button className={styles.footerBtn} onClick={() => setShowSettings(true)}>
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </aside>
  );
}

interface FolderItemProps {
  folder: FolderType;
  expanded: boolean;
  onToggle: () => void;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
}

function FolderItem({ folder, expanded, onToggle, isActive, onSelect, onRename }: FolderItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditName(folder.name);
  };
  
  const handleSave = () => {
    if (editName.trim() && editName !== folder.name) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(folder.name);
    }
  };
  
  return (
    <div className={styles.folderItem}>
      <div 
        className={`${styles.folderRow} ${isActive ? styles.active : ''}`}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      >
        <span 
          className={styles.expandBtn}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onToggle(); } }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Folder size={16} className={styles.folderIcon} />
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className={styles.editInput}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.folderName}>{folder.name}</span>
        )}
      </div>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

function ConversationItem({ conversation, isActive, onSelect, onDelete, onRename }: ConversationItemProps) {
  const [showActions, setShowActions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditTitle(conversation.title);
  };

  const handleSave = () => {
    if (editTitle.trim() && editTitle !== conversation.title) {
      onRename(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditTitle(conversation.title);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
    setConfirmDelete(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    <div 
      className={`${styles.conversationItem} ${isActive ? styles.active : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setConfirmDelete(false); }}
    >
      <button 
        className={styles.conversationBtn} 
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
      >
        <MessageSquare size={16} className={styles.conversationIcon} />
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className={styles.editInput}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.conversationTitle}>{conversation.title}</span>
        )}
        {conversation.pinned && !isEditing && <Pin size={12} className={styles.pinnedIcon} />}
      </button>
      {showActions && !confirmDelete && !isEditing && (
        <button 
          className={styles.deleteBtn}
          onClick={handleDeleteClick}
          title="Delete conversation"
        >
          <Trash2 size={14} />
        </button>
      )}
      {confirmDelete && (
        <div className={styles.confirmDelete}>
          <button className={styles.confirmYes} onClick={handleConfirmDelete}>Yes</button>
          <button className={styles.confirmNo} onClick={handleCancelDelete}>No</button>
        </div>
      )}
    </div>
  );
}
