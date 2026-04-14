import { useState, useRef, useCallback } from 'react';
import { FileEdit, Columns, Eye } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { MarkdownPreview, MarkdownPreviewHandle } from './MarkdownPreview';
import styles from './MarkdownEditor.module.css';

type ViewMode = 'edit' | 'split' | 'preview';

interface MarkdownEditorProps {
  path: string;
  content: string;
  language: string;
}

export function MarkdownEditor({ path, content, language }: MarkdownEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const isScrollSyncingRef = useRef(false);
  const editorScrollPercentRef = useRef(0);

  const handleEditorScroll = useCallback((scrollTop: number, scrollHeight: number, clientHeight: number) => {
    if (isScrollSyncingRef.current) return;
    
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) return;
    
    const scrollPercent = scrollTop / maxScroll;
    editorScrollPercentRef.current = scrollPercent;
    
    isScrollSyncingRef.current = true;
    previewRef.current?.scrollToPercent(scrollPercent);
    
    requestAnimationFrame(() => {
      isScrollSyncingRef.current = false;
    });
  }, []);

  const handlePreviewScroll = useCallback((scrollPercent: number) => {
    if (isScrollSyncingRef.current) return;
    
    editorScrollPercentRef.current = scrollPercent;
    
    isScrollSyncingRef.current = true;
    
    requestAnimationFrame(() => {
      isScrollSyncingRef.current = false;
    });
  }, []);

  return (
    <div className={styles.markdownEditor}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.fileLabel}>Markdown</span>
        </div>
        <div className={styles.viewModeButtons}>
          <button
            className={`${styles.viewModeBtn} ${viewMode === 'edit' ? styles.active : ''}`}
            onClick={() => setViewMode('edit')}
            title="Edit only"
          >
            <FileEdit size={14} />
            <span>Edit</span>
          </button>
          <button
            className={`${styles.viewModeBtn} ${viewMode === 'split' ? styles.active : ''}`}
            onClick={() => setViewMode('split')}
            title="Edit and Preview"
          >
            <Columns size={14} />
            <span>Split</span>
          </button>
          <button
            className={`${styles.viewModeBtn} ${viewMode === 'preview' ? styles.active : ''}`}
            onClick={() => setViewMode('preview')}
            title="Preview only"
          >
            <Eye size={14} />
            <span>Preview</span>
          </button>
        </div>
      </div>
      
      <div className={styles.content}>
        {viewMode === 'edit' && (
          <div className={styles.editorPane}>
            <MonacoEditor path={path} content={content} language={language} />
          </div>
        )}
        
        {viewMode === 'split' && (
          <>
            <div className={styles.splitPane}>
              <MonacoEditor 
                path={path} 
                content={content} 
                language={language}
                onScroll={handleEditorScroll}
              />
            </div>
            <div className={styles.divider} />
            <div className={styles.splitPane}>
              <MarkdownPreview 
                ref={previewRef}
                content={content}
                onScroll={handlePreviewScroll}
                syncScroll
              />
            </div>
          </>
        )}
        
        {viewMode === 'preview' && (
          <div className={styles.previewPane}>
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
