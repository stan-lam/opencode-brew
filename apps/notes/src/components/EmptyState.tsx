import { MessageSquarePlus, Sparkles } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import styles from './EmptyState.module.css';

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

export function EmptyState() {
  const { 
    activeWorkspaceId, 
    activeFolderId, 
    conversations,
    setConversations,
    setActiveConversation,
  } = useNotesStore();

  const handleNewChat = async () => {
    if (!activeWorkspaceId) return;
    
    try {
      const invoke = await getInvoke();
      const newConversation = await invoke('create_conversation', {
        workspaceId: activeWorkspaceId,
        title: 'New Chat',
        folderId: activeFolderId,
      }) as any;
      
      setConversations([newConversation, ...conversations]);
      setActiveConversation(newConversation.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.iconWrapper}>
          <Sparkles size={48} />
        </div>
        <h2 className={styles.title}>OpenCodeNotes</h2>
        <p className={styles.description}>
          Start a new conversation with AI to brainstorm ideas, get answers, or explore topics.
        </p>
        <button onClick={handleNewChat} className={styles.newChatBtn}>
          <MessageSquarePlus size={20} />
          <span>Start New Chat</span>
        </button>
      </div>

      <div className={styles.suggestions}>
        <h3 className={styles.suggestionsTitle}>Try asking about:</h3>
        <div className={styles.suggestionsList}>
          <button className={styles.suggestionBtn} onClick={handleNewChat}>
            Explain a complex topic
          </button>
          <button className={styles.suggestionBtn} onClick={handleNewChat}>
            Help me write code
          </button>
          <button className={styles.suggestionBtn} onClick={handleNewChat}>
            Brainstorm ideas
          </button>
          <button className={styles.suggestionBtn} onClick={handleNewChat}>
            Review my work
          </button>
        </div>
      </div>
    </div>
  );
}
