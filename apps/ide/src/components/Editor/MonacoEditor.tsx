import { useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useProblemsStore, Problem } from '../../store/problemsStore';
import { AIEditOverlay } from './AIEditOverlay';
import styles from './MonacoEditor.module.css';

interface MonacoEditorProps {
  path: string;
  content: string;
  language: string;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
}

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export function MonacoEditor({ path, content, language, onScroll }: MonacoEditorProps) {
  const { updateFileContent, saveFile, setCursorPosition, activeFile } = useEditorStore();
  const pendingAIEdit = activeFile?.path === path ? activeFile?.pendingAIEdit : undefined;
  const { theme, fontSize } = useSettingsStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);
  const matchesRef = useRef<Array<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }>>([]);
  const currentMatchRef = useRef<number>(0);

  const performSearch = useCallback((query: string, options: SearchOptions) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !query) {
      decorationsRef.current = editor?.deltaDecorations(decorationsRef.current, []) || [];
      matchesRef.current = [];
      currentMatchRef.current = 0;
      window.dispatchEvent(new CustomEvent('editor-search-results', {
        detail: { count: 0, current: 0 }
      }));
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const matches: Array<{ startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }> = [];
    
    try {
      let searchRegex: RegExp;
      if (options.useRegex) {
        searchRegex = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
        searchRegex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
      }

      const text = model.getValue();
      const lines = text.split('\n');
      
      lines.forEach((line: string, lineIndex: number) => {
        let match;
        searchRegex.lastIndex = 0;
        while ((match = searchRegex.exec(line)) !== null) {
          matches.push({
            startLineNumber: lineIndex + 1,
            startColumn: match.index + 1,
            endLineNumber: lineIndex + 1,
            endColumn: match.index + match[0].length + 1
          });
          if (match[0].length === 0) break;
        }
      });
    } catch (e) {
      console.error('Search error:', e);
    }

    matchesRef.current = matches;
    
    const decorations = matches.map((match, index) => ({
      range: new monaco.Range(match.startLineNumber, match.startColumn, match.endLineNumber, match.endColumn),
      options: {
        className: index === currentMatchRef.current ? 'findMatchHighlightCurrent' : 'findMatchHighlight',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
    
    if (matches.length > 0 && currentMatchRef.current >= matches.length) {
      currentMatchRef.current = 0;
    }

    window.dispatchEvent(new CustomEvent('editor-search-results', {
      detail: { count: matches.length, current: matches.length > 0 ? currentMatchRef.current + 1 : 0 }
    }));

    if (matches.length > 0) {
      const currentMatch = matches[currentMatchRef.current];
      editor.revealLineInCenter(currentMatch.startLineNumber);
    }
  }, []);

  const navigateToMatch = useCallback((direction: 'next' | 'prev') => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    if (direction === 'next') {
      currentMatchRef.current = (currentMatchRef.current + 1) % matches.length;
    } else {
      currentMatchRef.current = (currentMatchRef.current - 1 + matches.length) % matches.length;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const decorations = matches.map((match, index) => ({
      range: new monaco.Range(match.startLineNumber, match.startColumn, match.endLineNumber, match.endColumn),
      options: {
        className: index === currentMatchRef.current ? 'findMatchHighlightCurrent' : 'findMatchHighlight',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
    
    const currentMatch = matches[currentMatchRef.current];
    editor.setPosition({ lineNumber: currentMatch.startLineNumber, column: currentMatch.startColumn });
    editor.revealLineInCenter(currentMatch.startLineNumber);

    window.dispatchEvent(new CustomEvent('editor-search-results', {
      detail: { count: matches.length, current: currentMatchRef.current + 1 }
    }));
  }, []);

  const replaceMatch = useCallback((query: string, replacement: string, options: SearchOptions) => {
    const editor = editorRef.current;
    const matches = matchesRef.current;
    if (!editor || matches.length === 0) return;

    const currentMatch = matches[currentMatchRef.current];
    const model = editor.getModel();
    if (!model) return;

    let replaceText = replacement;
    if (options.useRegex) {
      try {
        const searchRegex = new RegExp(query, options.caseSensitive ? '' : 'i');
        const matchText = model.getValueInRange({
          startLineNumber: currentMatch.startLineNumber,
          startColumn: currentMatch.startColumn,
          endLineNumber: currentMatch.endLineNumber,
          endColumn: currentMatch.endColumn
        });
        replaceText = matchText.replace(searchRegex, replacement);
      } catch (e) {
        console.error('Replace error:', e);
      }
    }

    editor.executeEdits('search-replace', [{
      range: {
        startLineNumber: currentMatch.startLineNumber,
        startColumn: currentMatch.startColumn,
        endLineNumber: currentMatch.endLineNumber,
        endColumn: currentMatch.endColumn
      },
      text: replaceText
    }]);

    setTimeout(() => {
      performSearch(query, options);
    }, 10);
  }, [performSearch]);

  const replaceAllMatches = useCallback((query: string, replacement: string, options: SearchOptions) => {
    const editor = editorRef.current;
    const matches = matchesRef.current;
    if (!editor || matches.length === 0) return;

    const model = editor.getModel();
    if (!model) return;

    const edits = [...matches].reverse().map(match => {
      let replaceText = replacement;
      if (options.useRegex) {
        try {
          const searchRegex = new RegExp(query, options.caseSensitive ? '' : 'i');
          const matchText = model.getValueInRange({
            startLineNumber: match.startLineNumber,
            startColumn: match.startColumn,
            endLineNumber: match.endLineNumber,
            endColumn: match.endColumn
          });
          replaceText = matchText.replace(searchRegex, replacement);
        } catch (e) {
          console.error('Replace error:', e);
        }
      }
      return {
        range: {
          startLineNumber: match.startLineNumber,
          startColumn: match.startColumn,
          endLineNumber: match.endLineNumber,
          endColumn: match.endColumn
        },
        text: replaceText
      };
    });

    editor.executeEdits('search-replace-all', edits);

    setTimeout(() => {
      performSearch(query, options);
    }, 10);
  }, [performSearch]);

  useEffect(() => {
    const handleSearch = (e: CustomEvent) => {
      performSearch(e.detail.query, e.detail.options);
    };

    const handleSearchNext = () => navigateToMatch('next');
    const handleSearchPrev = () => navigateToMatch('prev');
    
    const handleReplace = (e: CustomEvent) => {
      replaceMatch(e.detail.query, e.detail.replacement, e.detail.options);
    };

    const handleReplaceAll = (e: CustomEvent) => {
      replaceAllMatches(e.detail.query, e.detail.replacement, e.detail.options);
    };

    const handleSearchClear = () => {
      const editor = editorRef.current;
      if (editor) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      matchesRef.current = [];
      currentMatchRef.current = 0;
    };

    window.addEventListener('editor-search', handleSearch as EventListener);
    window.addEventListener('editor-search-next', handleSearchNext);
    window.addEventListener('editor-search-prev', handleSearchPrev);
    window.addEventListener('editor-replace', handleReplace as EventListener);
    window.addEventListener('editor-replace-all', handleReplaceAll as EventListener);
    window.addEventListener('editor-search-clear', handleSearchClear);

    return () => {
      window.removeEventListener('editor-search', handleSearch as EventListener);
      window.removeEventListener('editor-search-next', handleSearchNext);
      window.removeEventListener('editor-search-prev', handleSearchPrev);
      window.removeEventListener('editor-replace', handleReplace as EventListener);
      window.removeEventListener('editor-replace-all', handleReplaceAll as EventListener);
      window.removeEventListener('editor-search-clear', handleSearchClear);
    };
  }, [performSearch, navigateToMatch, replaceMatch, replaceAllMatches]);

  // Handle navigation from problems panel
  useEffect(() => {
    const handleNavigateToLine = (e: CustomEvent) => {
      const { file, line, column } = e.detail;
      if (file === path && editorRef.current) {
        editorRef.current.setPosition({ lineNumber: line, column });
        editorRef.current.revealLineInCenter(line);
        editorRef.current.focus();
      }
    };

    window.addEventListener('navigate-to-line', handleNavigateToLine as EventListener);
    return () => {
      window.removeEventListener('navigate-to-line', handleNavigateToLine as EventListener);
    };
  }, [path]);

  // Monitor Monaco markers and sync to problems store
  const { setProblemsForFile, clearProblemsForFile } = useProblemsStore();
  
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const updateProblems = () => {
      const model = editorRef.current?.getModel();
      if (!model) return;

      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const problems: Problem[] = markers.map((marker: any, index: number) => ({
        id: `${path}-${index}`,
        type: marker.severity === 8 ? 'error' : marker.severity === 4 ? 'warning' : 'info',
        message: marker.message,
        file: path,
        line: marker.startLineNumber,
        column: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn,
        source: marker.source,
      }));

      if (problems.length > 0) {
        setProblemsForFile(path, problems);
      } else {
        clearProblemsForFile(path);
      }
    };

    // Listen for marker changes
    const disposable = monaco.editor.onDidChangeMarkers(() => {
      updateProblems();
    });

    // Initial check
    setTimeout(updateProblems, 500);

    return () => {
      disposable?.dispose();
      clearProblemsForFile(path);
    };
  }, [path, setProblemsForFile, clearProblemsForFile]);

  // Update editor font size when settings change
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.updateOptions({ fontSize });
    }
  }, [fontSize]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure TypeScript/JavaScript compiler options for JSX support
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      jsx: monaco.languages.typescript.JsxEmit.React,
      jsxFactory: 'React.createElement',
      reactNamespace: 'React',
      allowJs: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    });

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      jsx: monaco.languages.typescript.JsxEmit.React,
      jsxFactory: 'React.createElement',
      reactNamespace: 'React',
      allowJs: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    });

    // Disable all validation for TypeScript/JavaScript
    // This removes errors since we don't have full LSP integration
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });

    // Add custom CSS for search highlights
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
      .findMatchHighlight {
        background-color: rgba(234, 179, 8, 0.4) !important;
        border: 1px solid rgba(234, 179, 8, 0.6);
        border-radius: 2px;
      }
      .findMatchHighlightCurrent {
        background-color: rgba(234, 179, 8, 0.7) !important;
        border: 2px solid rgba(234, 179, 8, 1);
        border-radius: 2px;
      }
    `;
    document.head.appendChild(styleSheet);

    // Add save command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile(path);
    });

    // Add font size increase command (Cmd/Ctrl + =)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
      const { increaseFontSize } = useSettingsStore.getState();
      increaseFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Add font size increase command (Cmd/Ctrl + Numpad Plus)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadAdd, () => {
      const { increaseFontSize } = useSettingsStore.getState();
      increaseFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Add font size decrease command (Cmd/Ctrl + -)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
      const { decreaseFontSize } = useSettingsStore.getState();
      decreaseFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Add font size decrease command (Cmd/Ctrl + Numpad Minus)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadSubtract, () => {
      const { decreaseFontSize } = useSettingsStore.getState();
      decreaseFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Add font size reset command (Cmd/Ctrl + 0)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => {
      const { resetFontSize } = useSettingsStore.getState();
      resetFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Add font size reset command (Cmd/Ctrl + Numpad 0)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Numpad0, () => {
      const { resetFontSize } = useSettingsStore.getState();
      resetFontSize();
      const newSize = useSettingsStore.getState().fontSize;
      window.dispatchEvent(new CustomEvent('font-size-changed', {
        detail: { fontSize: newSize }
      }));
    });

    // Track cursor position
    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition(path, e.position.lineNumber, e.position.column);
    });

    // Track scroll position for sync
    if (onScroll) {
      editor.onDidScrollChange((e) => {
        const scrollTop = e.scrollTop;
        const scrollHeight = e.scrollHeight;
        const clientHeight = editor.getLayoutInfo().height;
        onScroll(scrollTop, scrollHeight, clientHeight);
      });
    }

    // Configure editor theme
    monaco.editor.defineTheme('opencodebrew-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'variable', foreground: '9CDCFE' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#2d2d30',
        'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#aeafad',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
      },
    });
    monaco.editor.setTheme('opencodebrew-dark');

    editor.focus();
  };

  const handleChange: OnChange = useCallback(
    (value) => {
      if (value !== undefined) {
        updateFileContent(path, value);
      }
    },
    [path, updateFileContent]
  );

  return (
    <div className={styles.editorWrapper}>
      {pendingAIEdit && (
        <AIEditOverlay
          filePath={path}
          oldContent={pendingAIEdit.oldContent}
          newContent={pendingAIEdit.newContent}
          operationType={pendingAIEdit.operationType}
          insertLine={pendingAIEdit.insertLine}
        />
      )}
      <Editor
        height="100%"
        language={language}
        value={content}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontSize: fontSize,
          fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
          fontLigatures: true,
          minimap: { enabled: true, scale: 1 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          padding: { top: 8 },
          automaticLayout: true,
          wordWrap: 'on',
          lineNumbers: 'on',
          folding: true,
          foldingHighlight: true,
          showFoldingControls: 'mouseover',
          matchBrackets: 'always',
          suggest: {
            showMethods: true,
            showFunctions: true,
            showConstructors: true,
            showFields: true,
            showVariables: true,
            showClasses: true,
            showStructs: true,
            showInterfaces: true,
            showModules: true,
            showProperties: true,
            showEvents: true,
            showOperators: true,
            showUnits: true,
            showValues: true,
            showConstants: true,
            showEnums: true,
            showEnumMembers: true,
            showKeywords: true,
            showWords: true,
            showColors: true,
            showFiles: true,
            showReferences: true,
            showFolders: true,
            showTypeParameters: true,
            showSnippets: true,
          },
        }}
        theme={theme === 'light' ? 'light' : 'vs-dark'}
      />
    </div>
  );
}
