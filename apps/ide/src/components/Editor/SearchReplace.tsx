import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { X, ChevronDown, ChevronUp, Replace, ReplaceAll, CaseSensitive, Regex, WholeWord } from 'lucide-react';
import styles from './SearchReplace.module.css';

interface SearchReplaceProps {
  onSearch: (query: string, options: SearchOptions) => SearchResult[];
  onReplace: (query: string, replacement: string, options: SearchOptions) => void;
  onReplaceAll: (query: string, replacement: string, options: SearchOptions) => void;
  onNavigate: (direction: 'next' | 'prev') => void;
  onClose: () => void;
  visible: boolean;
  showReplace: boolean;
  matchCount: number;
  currentMatch: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface SearchResult {
  lineNumber: number;
  column: number;
  length: number;
  text: string;
}

interface SearchReplaceBarProps {
  onClose: () => void;
  initialShowReplace?: boolean;
}

export function SearchReplaceBar({ onClose, initialShowReplace = false }: SearchReplaceBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [regexError, setRegexError] = useState<string | null>(null);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShowReplace(initialShowReplace);
  }, [initialShowReplace]);

  useEffect(() => {
    if (showReplace) {
      replaceInputRef.current?.focus();
    } else {
      searchInputRef.current?.focus();
    }
  }, [showReplace]);

  const validateRegex = useCallback((pattern: string): boolean => {
    if (!useRegex || !pattern) {
      setRegexError(null);
      return true;
    }
    try {
      new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      setRegexError(null);
      return true;
    } catch (e) {
      setRegexError((e as Error).message);
      return false;
    }
  }, [useRegex, caseSensitive]);

  useEffect(() => {
    validateRegex(searchQuery);
  }, [searchQuery, validateRegex]);

  const handleSearch = useCallback(() => {
    if (!searchQuery || !validateRegex(searchQuery)) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const event = new CustomEvent('editor-search', {
      detail: {
        query: searchQuery,
        options: { caseSensitive, wholeWord, useRegex }
      }
    });
    window.dispatchEvent(event);
  }, [searchQuery, caseSensitive, wholeWord, useRegex, validateRegex]);

  useEffect(() => {
    const handleSearchResults = (e: CustomEvent) => {
      setMatchCount(e.detail.count);
      setCurrentMatch(e.detail.current);
    };
    window.addEventListener('editor-search-results', handleSearchResults as EventListener);
    return () => window.removeEventListener('editor-search-results', handleSearchResults as EventListener);
  }, []);

  useEffect(() => {
    handleSearch();
  }, [handleSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigatePrev();
      } else {
        navigateNext();
      }
    } else if (e.key === 'F3' || (e.key === 'g' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (e.shiftKey) {
        navigatePrev();
      } else {
        navigateNext();
      }
    }
  };

  const navigateNext = () => {
    window.dispatchEvent(new CustomEvent('editor-search-next'));
  };

  const navigatePrev = () => {
    window.dispatchEvent(new CustomEvent('editor-search-prev'));
  };

  const handleReplace = () => {
    window.dispatchEvent(new CustomEvent('editor-replace', {
      detail: {
        query: searchQuery,
        replacement: replaceQuery,
        options: { caseSensitive, wholeWord, useRegex }
      }
    }));
  };

  const handleReplaceAll = () => {
    window.dispatchEvent(new CustomEvent('editor-replace-all', {
      detail: {
        query: searchQuery,
        replacement: replaceQuery,
        options: { caseSensitive, wholeWord, useRegex }
      }
    }));
  };

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchRow}>
        <button
          className={styles.toggleReplace}
          onClick={() => setShowReplace(!showReplace)}
          title={showReplace ? 'Hide Replace' : 'Show Replace'}
        >
          {showReplace ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        
        <div className={styles.inputWrapper}>
          <input
            ref={searchInputRef}
            type="text"
            className={`${styles.searchInput} ${regexError ? styles.error : ''}`}
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.inputOptions}>
            <button
              className={`${styles.optionButton} ${caseSensitive ? styles.active : ''}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Match Case (Alt+C)"
            >
              <CaseSensitive size={14} />
            </button>
            <button
              className={`${styles.optionButton} ${wholeWord ? styles.active : ''}`}
              onClick={() => setWholeWord(!wholeWord)}
              title="Match Whole Word (Alt+W)"
            >
              <WholeWord size={14} />
            </button>
            <button
              className={`${styles.optionButton} ${useRegex ? styles.active : ''}`}
              onClick={() => setUseRegex(!useRegex)}
              title="Use Regular Expression (Alt+R)"
            >
              <Regex size={14} />
            </button>
          </div>
        </div>

        <span className={styles.matchInfo}>
          {searchQuery ? (
            matchCount > 0 ? `${currentMatch} of ${matchCount}` : 'No results'
          ) : ''}
        </span>

        <div className={styles.navButtons}>
          <button
            className={styles.navButton}
            onClick={navigatePrev}
            disabled={matchCount === 0}
            title="Previous Match (Shift+Enter)"
          >
            <ChevronUp size={16} />
          </button>
          <button
            className={styles.navButton}
            onClick={navigateNext}
            disabled={matchCount === 0}
            title="Next Match (Enter)"
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <button className={styles.closeButton} onClick={onClose} title="Close (Escape)">
          <X size={16} />
        </button>
      </div>

      {regexError && (
        <div className={styles.errorMessage}>
          Invalid regex: {regexError}
        </div>
      )}

      {showReplace && (
        <div className={styles.replaceRow}>
          <div className={styles.replaceInputWrapper}>
            <input
              ref={replaceInputRef}
              type="text"
              className={styles.replaceInput}
              placeholder="Replace"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    handleReplaceAll();
                  } else {
                    handleReplace();
                  }
                } else if (e.key === 'Escape') {
                  onClose();
                }
              }}
            />
          </div>
          <div className={styles.replaceButtons}>
            <button
              className={styles.replaceButton}
              onClick={handleReplace}
              disabled={matchCount === 0}
              title="Replace (Enter)"
            >
              <Replace size={14} />
              <span>Replace</span>
            </button>
            <button
              className={styles.replaceButton}
              onClick={handleReplaceAll}
              disabled={matchCount === 0}
              title="Replace All (Shift+Enter)"
            >
              <ReplaceAll size={14} />
              <span>All</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function useSearchReplace() {
  const [isVisible, setIsVisible] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  useEffect(() => {
    const unlistenFind = listen('open-find', () => {
      setShowReplace(false);
      setIsVisible(true);
    });

    const unlistenReplace = listen('open-replace', () => {
      setShowReplace(true);
      setIsVisible(true);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowReplace(false);
        setIsVisible(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        setShowReplace(true);
        setIsVisible(true);
      } else if (e.key === 'Escape' && isVisible) {
        setIsVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenFind.then(fn => fn());
      unlistenReplace.then(fn => fn());
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible]);

  const close = useCallback(() => {
    setIsVisible(false);
    window.dispatchEvent(new CustomEvent('editor-search-clear'));
  }, []);

  return { isVisible, showReplace, close };
}
