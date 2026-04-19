import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, X, ChevronDown, ChevronRight, File, RefreshCw, Replace, CaseSensitive, WholeWord, Regex } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useEditorStore } from '../../store/editorStore';
import styles from './SearchPanel.module.css';

interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
  match_text: string;
}

interface GroupedResults {
  [file: string]: SearchResult[];
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isReplacing, setIsReplacing] = useState(false);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const { currentWorkspace } = useWorkspaceStore();
  const { openFile } = useEditorStore();

  useEffect(() => {
    const handleFind = () => {
      console.log('SearchPanel: find event received');
      setShowReplace(false);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    };

    const handleReplace = () => {
      console.log('SearchPanel: replace event received');
      setShowReplace(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    };

    window.addEventListener('search-panel-find', handleFind);
    window.addEventListener('search-panel-replace', handleReplace);

    return () => {
      window.removeEventListener('search-panel-find', handleFind);
      window.removeEventListener('search-panel-replace', handleReplace);
    };
  }, []);

  const handleSearch = async () => {
    if (!query.trim() || !currentWorkspace?.rootPath) return;
    
    setIsSearching(true);
    setResults([]);
    
    try {
      const searchResults = await invoke<SearchResult[]>('search_in_files', {
        directory: currentWorkspace.rootPath,
        query: query,
        options: {
          case_sensitive: caseSensitive,
          whole_word: wholeWord,
          use_regex: useRegex,
        }
      });
      
      setResults(searchResults);
      
      const files = new Set(searchResults.map(r => r.file));
      setExpandedFiles(files);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleResultClick = async (result: SearchResult) => {
    try {
      await openFile(result.file);
      
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('editor-goto-line', {
          detail: { line: result.line, column: result.column }
        }));
      }, 100);
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  };

  const handleReplaceInFile = async (file: string) => {
    if (!replaceText && replaceText !== '') return;
    
    setIsReplacing(true);
    try {
      await invoke<number>('replace_in_file', {
        path: file,
        search: query,
        replace: replaceText,
        options: {
          case_sensitive: caseSensitive,
          whole_word: wholeWord,
          use_regex: useRegex,
        }
      });
      
      handleSearch();
    } catch (error) {
      console.error('Replace error:', error);
    } finally {
      setIsReplacing(false);
    }
  };

  const handleReplaceAll = async () => {
    if (!replaceText && replaceText !== '') return;
    
    const files = [...new Set(results.map(r => r.file))];
    setIsReplacing(true);
    
    try {
      for (const file of files) {
        await invoke<number>('replace_in_file', {
          path: file,
          search: query,
          replace: replaceText,
          options: {
            case_sensitive: caseSensitive,
            whole_word: wholeWord,
            use_regex: useRegex,
          }
        });
      }
      
      handleSearch();
    } catch (error) {
      console.error('Replace all error:', error);
    } finally {
      setIsReplacing(false);
    }
  };

  const toggleFileExpanded = (file: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  const groupedResults: GroupedResults = results.reduce((acc, result) => {
    if (!acc[result.file]) {
      acc[result.file] = [];
    }
    acc[result.file].push(result);
    return acc;
  }, {} as GroupedResults);

  const getRelativePath = (fullPath: string) => {
    if (currentWorkspace?.rootPath && fullPath.startsWith(currentWorkspace.rootPath)) {
      return fullPath.slice(currentWorkspace.rootPath.length + 1);
    }
    return fullPath;
  };

  const highlightMatch = (text: string, matchText: string) => {
    if (!matchText) return text;
    
    const index = text.toLowerCase().indexOf(matchText.toLowerCase());
    if (index === -1) return text;
    
    return (
      <>
        {text.slice(0, index)}
        <mark className={styles.highlight}>{text.slice(index, index + matchText.length)}</mark>
        {text.slice(index + matchText.length)}
      </>
    );
  };

  return (
    <div className={styles.searchPanel}>
      <div className={styles.searchInputs}>
        <div className={styles.inputRow}>
          <button
            className={styles.toggleReplace}
            onClick={() => setShowReplace(!showReplace)}
            title={showReplace ? 'Hide Replace' : 'Show Replace'}
          >
            {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className={styles.inputWrapper}>
            <Search size={14} className={styles.inputIcon} />
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Search in files..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button
                className={styles.clearBtn}
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className={styles.optionsRow}>
          <button
            className={`${styles.optionBtn} ${caseSensitive ? styles.active : ''}`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="Match Case"
          >
            <CaseSensitive size={14} />
          </button>
          <button
            className={`${styles.optionBtn} ${wholeWord ? styles.active : ''}`}
            onClick={() => setWholeWord(!wholeWord)}
            title="Match Whole Word"
          >
            <WholeWord size={14} />
          </button>
          <button
            className={`${styles.optionBtn} ${useRegex ? styles.active : ''}`}
            onClick={() => setUseRegex(!useRegex)}
            title="Use Regular Expression"
          >
            <Regex size={14} />
          </button>
          <button
            className={styles.searchBtn}
            onClick={handleSearch}
            disabled={!query.trim() || isSearching}
          >
            {isSearching ? <RefreshCw size={14} className={styles.spinner} /> : <Search size={14} />}
          </button>
        </div>

        {showReplace && (
          <>
            <div className={styles.inputRow}>
              <div className={styles.spacer} />
              <div className={styles.inputWrapper}>
                <Replace size={14} className={styles.inputIcon} />
                <input
                  ref={replaceInputRef}
                  type="text"
                  className={styles.searchInput}
                  placeholder="Replace with..."
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.replaceActions}>
              <button
                className={styles.replaceAllBtn}
                onClick={handleReplaceAll}
                disabled={results.length === 0 || isReplacing}
              >
                {isReplacing ? <RefreshCw size={12} className={styles.spinner} /> : null}
                Replace All ({results.length})
              </button>
            </div>
          </>
        )}
      </div>

      <div className={styles.results}>
        {isSearching ? (
          <div className={styles.loading}>
            <RefreshCw size={16} className={styles.spinner} />
            Searching...
          </div>
        ) : results.length === 0 ? (
          <div className={styles.empty}>
            {query ? 'No results found' : 'Enter a search term and press Enter'}
          </div>
        ) : (
          <div className={styles.resultList}>
            <div className={styles.resultSummary}>
              {results.length} results in {Object.keys(groupedResults).length} files
            </div>
            {Object.entries(groupedResults).map(([file, fileResults]) => (
              <div key={file} className={styles.fileGroup}>
                <div 
                  className={styles.fileHeader}
                  onClick={() => toggleFileExpanded(file)}
                >
                  {expandedFiles.has(file) ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <File size={14} />
                  <span className={styles.fileName}>{getRelativePath(file)}</span>
                  <span className={styles.matchCount}>{fileResults.length}</span>
                  {showReplace && (
                    <button
                      className={styles.replaceFileBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReplaceInFile(file);
                      }}
                      title="Replace in this file"
                    >
                      <Replace size={12} />
                    </button>
                  )}
                </div>
                {expandedFiles.has(file) && (
                  <div className={styles.fileResults}>
                    {fileResults.map((result, index) => (
                      <div
                        key={index}
                        className={styles.resultItem}
                        onClick={() => handleResultClick(result)}
                      >
                        <span className={styles.lineNumber}>{result.line}</span>
                        <span className={styles.lineText}>
                          {highlightMatch(result.text, result.match_text)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
  };
  return langMap[ext] || 'plaintext';
}
