import { useState } from 'react';
import { X, GitCompare, Clock } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import styles from './EditorTabs.module.css';

interface ConfirmDialogState {
  show: boolean;
  path: string;
  name: string;
}

export function EditorTabs() {
  const { openFiles, activeFile, setActiveFile, closeFile, closeAllFiles, saveFile, saveAllFiles } = useEditorStore();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ show: false, path: '', name: '' });
  const [showCloseAllDialog, setShowCloseAllDialog] = useState(false);

  const handleClose = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const file = openFiles.find((f) => f.path === path);
    if (file?.isDirty) {
      setConfirmDialog({ show: true, path, name: file.name });
      return;
    }
    closeFile(path);
  };

  const handleConfirmSave = async () => {
    await saveFile(confirmDialog.path);
    closeFile(confirmDialog.path);
    setConfirmDialog({ show: false, path: '', name: '' });
  };

  const handleConfirmDiscard = () => {
    closeFile(confirmDialog.path);
    setConfirmDialog({ show: false, path: '', name: '' });
  };

  const handleConfirmCancel = () => {
    setConfirmDialog({ show: false, path: '', name: '' });
  };

  const handleMiddleClick = (e: React.MouseEvent, path: string) => {
    if (e.button === 1) {
      handleClose(e, path);
    }
  };

  const handleCloseAll = () => {
    if (openFiles.length === 0) return;
    const hasDirtyFiles = openFiles.some((file) => file.isDirty);
    if (hasDirtyFiles) {
      setShowCloseAllDialog(true);
      return;
    }
    closeAllFiles();
  };

  const handleCloseAllSave = async () => {
    await saveAllFiles();
    closeAllFiles();
    setShowCloseAllDialog(false);
  };

  const handleCloseAllDiscard = () => {
    closeAllFiles();
    setShowCloseAllDialog(false);
  };

  const handleCloseAllCancel = () => {
    setShowCloseAllDialog(false);
  };

  const getTabClassName = (file: typeof openFiles[0]) => {
    let className = styles.tab;
    if (activeFile?.path === file.path) className += ` ${styles.active}`;
    if (file.type === 'diff') className += ` ${styles.diffTab}`;
    if (file.type === 'history-diff') className += ` ${styles.historyTab}`;
    return className;
  };

  const getTabTitle = (file: typeof openFiles[0]) => {
    if (file.type === 'diff') return file.diffInfo?.filePath;
    if (file.type === 'history-diff') return `${file.historyDiffInfo?.filePath} (History)`;
    return file.path;
  };

  return (
    <>
      <div className={styles.tabs}>
        <div className={styles.tabList}>
          {openFiles.map((file) => (
            <div
              key={file.path}
              className={getTabClassName(file)}
              onClick={() => setActiveFile(file.path)}
              onMouseDown={(e) => handleMiddleClick(e, file.path)}
              title={getTabTitle(file)}
            >
              {file.type === 'diff' && (
                <GitCompare size={14} className={styles.tabIcon} />
              )}
              {file.type === 'history-diff' && (
                <Clock size={14} className={styles.tabIcon} />
              )}
              <span className={styles.tabName}>
                {file.isDirty && <span className={styles.dirty}>●</span>}
                {file.name}
              </span>
              <button
                className={styles.closeBtn}
                onClick={(e) => handleClose(e, file.path)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className={styles.tabActions}>
          <button
            className={styles.closeAllButton}
            onClick={handleCloseAll}
            disabled={openFiles.length === 0}
            title="Close All Files"
          >
            <X size={14} />
            <span>Close All</span>
          </button>
        </div>
      </div>

      {confirmDialog.show && (
        <div className={styles.dialogOverlay} onClick={handleConfirmCancel}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Unsaved Changes</h3>
            <p className={styles.dialogMessage}>
              Do you want to save the changes you made to <strong>{confirmDialog.name}</strong>?
            </p>
            <p className={styles.dialogSubtext}>
              Your changes will be lost if you don't save them.
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.discardBtn} onClick={handleConfirmDiscard}>
                Don't Save
              </button>
              <button className={styles.cancelBtn} onClick={handleConfirmCancel}>
                Cancel
              </button>
              <button className={styles.saveBtn} onClick={handleConfirmSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {showCloseAllDialog && (
        <div className={styles.dialogOverlay} onClick={handleCloseAllCancel}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Unsaved Changes</h3>
            <p className={styles.dialogMessage}>
              You have unsaved changes in open files. Do you want to save them before closing all files?
            </p>
            <p className={styles.dialogSubtext}>
              Your changes will be lost if you don't save them.
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.discardBtn} onClick={handleCloseAllDiscard}>
                Don't Save
              </button>
              <button className={styles.cancelBtn} onClick={handleCloseAllCancel}>
                Cancel
              </button>
              <button className={styles.saveBtn} onClick={handleCloseAllSave}>
                Save All
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
