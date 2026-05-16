import { useMemo, useEffect } from 'react';
import { Check, X, ChevronDown, Sparkles } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import styles from './AIEditOverlay.module.css';

interface AIEditOverlayProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  operationType: 'create' | 'edit' | 'delete';
  insertLine?: number;
}

export function AIEditOverlay({ filePath, oldContent, newContent, operationType, insertLine }: AIEditOverlayProps) {
  const { applyAIEdit, clearAIEdit, activeFile } = useEditorStore();

  // Find where the edit should be applied
  const editLocation = useMemo(() => {
    // For insert mode, we have a specific line number
    if (insertLine !== undefined) {
      return { startLine: insertLine, found: true, isInsert: true };
    }
    
    // For replace mode, find where oldContent exists
    if (!activeFile?.content || !oldContent) {
      return { startLine: 1, found: false, isInsert: false };
    }
    
    const fileContent = activeFile.content;
    const oldTrimmed = oldContent.trim();
    
    // Find the position of oldContent in the file
    const index = fileContent.indexOf(oldTrimmed);
    if (index === -1) {
      // Try finding with normalized whitespace
      const normalizedFile = fileContent.replace(/\r\n/g, '\n');
      const normalizedOld = oldTrimmed.replace(/\r\n/g, '\n');
      const normalizedIndex = normalizedFile.indexOf(normalizedOld);
      if (normalizedIndex === -1) {
        return { startLine: 1, found: false, isInsert: false };
      }
      const linesBefore = normalizedFile.substring(0, normalizedIndex).split('\n').length;
      return { startLine: linesBefore, found: true, isInsert: false };
    }
    
    // Count lines before this position
    const linesBefore = fileContent.substring(0, index).split('\n').length;
    return { startLine: linesBefore, found: true, isInsert: false };
  }, [activeFile?.content, oldContent, insertLine]);

  // Calculate diff stats
  const stats = useMemo(() => {
    const oldLines = oldContent ? oldContent.trim().split('\n').length : 0;
    const newLines = newContent ? newContent.trim().split('\n').length : 0;
    return {
      added: newLines,
      removed: oldLines,
    };
  }, [oldContent, newContent]);

  // Navigate to the edit location on mount
  useEffect(() => {
    if (editLocation.startLine > 0) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate-to-line', {
          detail: { file: filePath, line: editLocation.startLine, column: 1 }
        }));
      }, 100);
    }
  }, [editLocation, filePath]);

  const handleApply = () => {
    try {
      console.log('[AIEditOverlay] Applying edit to:', filePath);
      applyAIEdit(filePath);
      // File is now marked as dirty - user can save with Cmd+S
      console.log('[AIEditOverlay] Edit applied, file marked dirty');
    } catch (error) {
      console.error('[AIEditOverlay] Failed to apply AI edit:', error);
    }
  };

  const handleDismiss = () => {
    clearAIEdit(filePath);
  };

  const handleGoToEdit = () => {
    window.dispatchEvent(new CustomEvent('navigate-to-line', {
      detail: { file: filePath, line: editLocation.startLine, column: 1 }
    }));
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.badge}>
        <Sparkles size={14} />
        <span>AI Edit</span>
      </div>
      
      <div className={styles.stats}>
        <span className={styles.statAdd}>+{stats.added}</span>
        <span className={styles.statRemove}>-{stats.removed}</span>
      </div>

      <button 
        className={styles.locationBtn}
        onClick={handleGoToEdit}
        title={editLocation.found ? `Go to line ${editLocation.startLine}` : 'Edit location not found'}
      >
        {editLocation.found ? (
          <>
            <ChevronDown size={14} />
            {editLocation.isInsert ? 'Insert at' : 'Line'} {editLocation.startLine}
          </>
        ) : (
          <span style={{ color: '#ffc107' }}>Not found in file</span>
        )}
      </button>

      <div className={styles.actions}>
        <button 
          className={styles.applyBtn}
          onClick={handleApply}
          disabled={!editLocation.found}
          title={editLocation.found ? 'Apply changes (saves as draft)' : 'Cannot apply - edit location not found'}
        >
          <Check size={14} />
          Apply
        </button>
        <button 
          className={styles.dismissBtn}
          onClick={handleDismiss}
          title="Dismiss changes"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
