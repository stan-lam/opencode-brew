import { useEditorStore } from '../../store/editorStore';
import { EditorTabs } from './EditorTabs';
import { MonacoEditor } from './MonacoEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { WelcomeTab } from './WelcomeTab';
import { SearchReplaceBar, useSearchReplace } from './SearchReplace';
import { DiffEditor } from './DiffEditor';
import { HistoryDiffEditor } from './HistoryDiffEditor';
import styles from './EditorArea.module.css';

function isMarkdownFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith('.md') || lowerPath.endsWith('.mdx') || lowerPath.endsWith('.markdown');
}

export function EditorArea() {
  const { openFiles, activeFile } = useEditorStore();
  const { isVisible: searchVisible, showReplace, close: closeSearch } = useSearchReplace();

  if (openFiles.length === 0) {
    return (
      <div className={styles.editorArea}>
        <WelcomeTab />
      </div>
    );
  }

  const renderEditor = () => {
    if (!activeFile) return null;

    if (activeFile.type === 'diff' && activeFile.diffInfo) {
      return (
        <DiffEditor
          key={activeFile.path}
          repoPath={activeFile.diffInfo.repoPath}
          filePath={activeFile.diffInfo.filePath}
          staged={activeFile.diffInfo.staged}
        />
      );
    }

    if (activeFile.type === 'history-diff' && activeFile.historyDiffInfo) {
      return (
        <HistoryDiffEditor
          key={activeFile.path}
          filePath={activeFile.historyDiffInfo.filePath}
          fileName={activeFile.historyDiffInfo.fileName}
          historyId={activeFile.historyDiffInfo.historyId}
          historyTimestamp={activeFile.historyDiffInfo.historyTimestamp}
          oldContent={activeFile.historyDiffInfo.oldContent}
          newContent={activeFile.historyDiffInfo.newContent}
        />
      );
    }

    if (isMarkdownFile(activeFile.path)) {
      return (
        <MarkdownEditor
          key={activeFile.path}
          path={activeFile.path}
          content={activeFile.content}
          language={activeFile.language}
        />
      );
    }

    return (
      <MonacoEditor
        key={activeFile.path}
        path={activeFile.path}
        content={activeFile.content}
        language={activeFile.language}
      />
    );
  };

  return (
    <div className={styles.editorArea}>
      <EditorTabs />
      {searchVisible && <SearchReplaceBar onClose={closeSearch} initialShowReplace={showReplace} />}
      <div className={styles.editorContent}>
        {renderEditor()}
      </div>
    </div>
  );
}
