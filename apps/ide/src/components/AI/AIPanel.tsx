import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Send,
  Plus,
  Settings,
  Trash2,
  Copy,
  RefreshCw,
  Bot,
  User,
  History,
  MessageSquare,
  Download,
  Upload,
  X,
  FolderOpen,
  Square,
  Image as ImageIcon,
  Paperclip,
  Terminal as TerminalIcon,
  Check,
  Zap,
  ListChecks,
  Circle,
  Loader,
  Loader2,
  ChevronDown,
  ChevronRight,
  Globe,
  Clock,
  ExternalLink,
  FileText,
  List,
  AlertTriangle,
} from 'lucide-react';
import { ai, appEvents, dialog, fs, history, shell, listenForTokenUsage, usage, git } from '../../services/tauri';
import type { CopilotCachedAccount, CopilotDeviceCode } from '../../services/tauri';
import { useAIStore, AIMessage, MessageAttachment, AgentMode, AgentTask, WebAccessTrace, SubagentProfile, PendingQuestion as StorePendingQuestion, CommandOperation, CommandStatus } from '../../store/aiStore';
import type { AIProvider } from '../../store/aiStore';
import { ContextBreakdownModal } from './ContextBreakdownModal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useGitStore } from '../../store/gitStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './AIPanel.module.css';
import { ContextMenu, ContextMenuItem, ContextMenuPosition } from '../FileTree/ContextMenu';
import mermaid from 'mermaid';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#007acc',
    primaryTextColor: '#cccccc',
    primaryBorderColor: '#3c3c3c',
    lineColor: '#6d6d6d',
    secondaryColor: '#252526',
    tertiaryColor: '#1e1e1e',
    background: '#1e1e1e',
    mainBkg: '#252526',
    secondBkg: '#1e1e1e',
    border1: '#3c3c3c',
    border2: '#3c3c3c',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
});

// Fallback labels when metadata is not available
const COPILOT_MODEL_LABELS: Record<string, string> = {
  auto: 'Auto (Variable)',
  // Hyphen format (claude-opus-4-5) - actual API model IDs
  'claude-haiku-4-5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4-5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6 - Medium - 264K',
  // Dot format (legacy/display names)
  'claude-haiku-4.5': 'Claude Haiku 4.5 - 200K',
  'claude-opus-4.5': 'Claude Opus 4.5 - 200K',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5 - 200K',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6 - Medium - 264K',
  'gpt-5-mini': 'GPT-5 mini - Medium - 192K',
  'gpt-5.3-codex': 'GPT-5.3-Codex - Medium - 400K',
};

import type { CopilotModelMetadata } from '../../services/tauri';

// Format context window as human-readable string (e.g., 200000 -> "200K")
const formatContextWindow = (tokens: number | null | undefined): string => {
  if (!tokens) return '';
  if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}M`;
  return `${Math.round(tokens / 1000)}K`;
};

// Format model label with dynamic metadata
const formatModelLabel = (
  provider: string,
  model: string,
  metadata?: CopilotModelMetadata[]
): string => {
  if (provider === 'copilot') {
    // Try to get dynamic metadata first
    const modelMeta = metadata?.find(m => m.id === model);
    if (modelMeta) {
      const contextStr = formatContextWindow(modelMeta.context_window);
      const reasoningStr = modelMeta.reasoning_efforts.length > 0 ? ' - Medium' : '';
      // Include version suffix for dated models to avoid duplicates
      const versionMatch = model.match(/-(\d{4}-\d{2}-\d{2})$/);
      const versionSuffix = versionMatch ? ` (${versionMatch[1]})` : '';
      return `${modelMeta.name}${reasoningStr}${contextStr ? ` - ${contextStr}` : ''}${versionSuffix}`;
    }
    // Fallback to hardcoded labels
    return COPILOT_MODEL_LABELS[model] ?? model;
  }
  return model;
};

// Get pricing tooltip for a model
const getModelPricingTooltip = (
  model: string,
  metadata?: CopilotModelMetadata[]
): string | undefined => {
  const modelMeta = metadata?.find(m => m.id === model);
  if (!modelMeta) return undefined;
  
  const lines: string[] = [];
  lines.push(modelMeta.name);
  
  if (modelMeta.context_window) {
    lines.push(`Context Window: ${formatContextWindow(modelMeta.context_window)}`);
  }
  
  if (modelMeta.input_price !== null || modelMeta.output_price !== null) {
    lines.push('');
    lines.push('Cost per 1M Tokens:');
    if (modelMeta.input_price !== null) {
      lines.push(`  Input: ${modelMeta.input_price} Credits`);
    }
    if (modelMeta.output_price !== null) {
      lines.push(`  Output: ${modelMeta.output_price} Credits`);
    }
    if (modelMeta.cache_price !== null) {
      lines.push(`  Cached: ${modelMeta.cache_price} Credits`);
    }
  }
  
  const capabilities: string[] = [];
  if (modelMeta.supports_vision) capabilities.push('Vision');
  if (modelMeta.supports_tools) capabilities.push('Tools');
  if (modelMeta.reasoning_efforts.length > 0) {
    capabilities.push(`Thinking (${modelMeta.reasoning_efforts.join('/')})`);
  }
  if (capabilities.length > 0) {
    lines.push('');
    lines.push(`Capabilities: ${capabilities.join(', ')}`);
  }
  
  return lines.join('\n');
};

// Component to render code blocks with copy button, expand/collapse, and diff support
interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
  isDiff?: boolean;
}

function CodeBlock({ code, language, filename, isDiff }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { currentWorkspace } = useWorkspaceStore();
  const lines = code.split('\n');
  const lineCount = lines.length;
  const shouldCollapse = lineCount > 15;
  const COLLAPSED_MAX_LINES = 120;
  
  // Context menu state for line number right-click
  const [lineContextMenu, setLineContextMenu] = useState<{
    position: ContextMenuPosition;
    lineNumber: number;
    lineContent: string;
  } | null>(null);
  
  const { activeConversation } = useAIStore();
  
  // Handle right-click on line number
  const handleLineContextMenu = useCallback((
    e: React.MouseEvent,
    lineNumber: number,
    lineContent: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setLineContextMenu({
      position: { x: e.clientX, y: e.clientY },
      lineNumber,
      lineContent,
    });
  }, []);
  
  // Close context menu
  const closeLineContextMenu = useCallback(() => {
    setLineContextMenu(null);
  }, []);
  
  // Handle AI action from context menu - dispatch event to prefill AI input
  const handleAIAction = useCallback((
    action: 'review' | 'ask' | 'research',
    startNewConversation: boolean
  ) => {
    if (!lineContextMenu) return;
    
    // Dispatch event to prefill the AI input instead of sending directly
    window.dispatchEvent(new CustomEvent('prefill-ai-input', {
      detail: {
        action,
        lineNumber: lineContextMenu.lineNumber,
        lineContent: lineContextMenu.lineContent,
        filename,
        language,
        startNewConversation,
      }
    }));
    
    closeLineContextMenu();
  }, [lineContextMenu, filename, language, closeLineContextMenu]);
  
  // Build context menu items for line number right-click
  const buildLineContextMenuItems = useCallback((): ContextMenuItem[] => {
    const hasActiveConversation = !!activeConversation;
    const items: ContextMenuItem[] = [];
    
    // Review section
    items.push({
      id: 'review-new',
      label: '🔍 Review (New Chat)',
      action: () => handleAIAction('review', true),
    });
    if (hasActiveConversation) {
      items.push({
        id: 'review-continue',
        label: '🔍 Review (Continue)',
        action: () => handleAIAction('review', false),
      });
    }
    
    items.push({ id: 'divider-1', divider: true });
    
    // Ask section
    items.push({
      id: 'ask-new',
      label: '💬 Ask AI (New Chat)',
      action: () => handleAIAction('ask', true),
    });
    if (hasActiveConversation) {
      items.push({
        id: 'ask-continue',
        label: '💬 Ask AI (Continue)',
        action: () => handleAIAction('ask', false),
      });
    }
    
    items.push({ id: 'divider-2', divider: true });
    
    // Research section
    items.push({
      id: 'research-new',
      label: '📚 Research (New Chat)',
      action: () => handleAIAction('research', true),
    });
    if (hasActiveConversation) {
      items.push({
        id: 'research-continue',
        label: '📚 Research (Continue)',
        action: () => handleAIAction('research', false),
      });
    }
    
    return items;
  }, [activeConversation, handleAIAction]);
  
  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (contentRef.current && !expanded) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [code, expanded]);
  
  const isCliLanguage = (lang: string): boolean => {
    const cliLanguages = ['bash', 'sh', 'shell', 'zsh', 'cli', 'terminal', 'console', 'powershell', 'ps1', 'cmd'];
    return cliLanguages.includes(lang.toLowerCase());
  };

  const runInTerminal = async () => {
    try {
      // Generate a unique terminal ID
      const terminalId = `ai-cmd-${Date.now()}`;
      
      console.log('AIPanel: Dispatching run-command event', {
        terminalId,
        command: code.trim(),
        cwd: currentWorkspace?.rootPath,
      });
      
      // Show terminal panel first
      const { setActiveBottomTab } = useLayoutStore.getState();
      setActiveBottomTab('terminal');
      
      // Dispatch a custom event to the terminal panel
      const event = new CustomEvent('run-command', {
        detail: {
          terminalId,
          command: code.trim(),
          cwd: currentWorkspace?.rootPath,
          label: `AI: ${language}`,
        },
      });
      window.dispatchEvent(event);
      
      console.log('AIPanel: Event dispatched successfully');
      
    } catch (error) {
      console.error('Failed to run command in terminal:', error);
    }
  };
  
  // Detect ASCII art/diagrams (box-drawing characters)
  const boxDrawingChars = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬▀▄█▌▐░▒▓]/;
  const isAsciiArt = lines.some(l => boxDrawingChars.test(l));

  const normalizeAsciiArt = (input: string): string => {
    const rawLines = input.split('\n');
    const hasBoxChar = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬]/;
    const rightBorderChars = /[│┤┐┘║╣╗╝]$/;

    const lineInfos = rawLines.map((line) => ({
      raw: line,
      trimmed: line.replace(/\s+$/, ''),
      indent: line.match(/^\s*/)?.[0].length ?? 0,
    }));

    const widthByIndent = new Map<number, number>();
    lineInfos.forEach((info) => {
      if (hasBoxChar.test(info.trimmed) && rightBorderChars.test(info.trimmed)) {
        const current = widthByIndent.get(info.indent) ?? 0;
        widthByIndent.set(info.indent, Math.max(current, info.trimmed.length));
      }
    });

    const normalizedLines = lineInfos.map((info) => {
      const trimmed = info.trimmed;
      const targetWidth = widthByIndent.get(info.indent);
      if (!targetWidth || !rightBorderChars.test(trimmed)) {
        return trimmed;
      }

      const endChar = trimmed.slice(-1);
      const content = trimmed.slice(0, -1);
      const fillNeeded = targetWidth - 1 - content.length;
      if (fillNeeded <= 0) {
        return trimmed;
      }

      const hasHorizontal = /[─═]/.test(content);
      const fillChar = content.includes('═') ? '═' : '─';
      const useHorizontal = hasHorizontal && /[┐┘┤╗╝╣]$/.test(trimmed);
      const filler = useHorizontal ? fillChar.repeat(fillNeeded) : ' '.repeat(fillNeeded);
      return content + filler + endChar;
    });

    return normalizedLines.join('\n');
  };

  const asciiContent = isAsciiArt ? normalizeAsciiArt(code) : code;

  const copyToClipboard = async () => {
    try {
      // For diff, copy only the actual code (without +/- prefixes)
      const textToCopy = isDiff 
        ? lines.filter(l => !l.startsWith('-')).map(l => l.startsWith('+') ? l.slice(1) : l).join('\n')
        : (isAsciiArt ? asciiContent : code);
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Basic syntax highlighting with diff support
  const highlightCode = (code: string, lang: string): React.ReactNode => {
    const codeLines = code.split('\n');
    // Performance: rendering thousands of lines with spans is extremely expensive and
    // can freeze the UI (especially during window resize). When collapsed, render
    // only a limited number of lines and let users expand for the full view.
    const isCollapsed = shouldCollapse && !expanded;
    const renderLines = isCollapsed ? codeLines.slice(0, COLLAPSED_MAX_LINES) : codeLines;
    const truncated = isCollapsed && codeLines.length > renderLines.length;
    
    const inferLang = (raw: string): string => {
      const sample = raw.slice(0, 4000);
      if (/\bplugins\s*\{[\s\S]*?\}/i.test(sample) || /\bdependencies\s*\{/i.test(sample)) return 'gradle';
      if (/\brootProject\.name\b/.test(sample) || /\binclude\s+['"][^'"]+['"]/.test(sample)) return 'gradle';
      if (/\bpackage\s+[a-zA-Z_][\w.]*\s*;/.test(sample) || /\bpublic\s+class\s+\w+/.test(sample)) return 'java';
      if (/^\s*import\s+.+\s+from\s+.+/m.test(sample) || /\bdef\s+\w+\s*\(/.test(sample)) return 'python';
      if (/\bfunction\s+\w+\s*\(|\bconst\s+\w+\s*=|\bimport\s+.*\s+from\s+['"]/m.test(sample)) return 'javascript';
      return '';
    };

    const rawLang = (lang || '').toLowerCase();
    const effectiveLang = rawLang && rawLang !== 'text' && rawLang !== 'plaintext'
      ? rawLang
      : inferLang(code) || rawLang;

    const rendered = renderLines.map((line, lineIdx) => {
      // Check for diff markers
      const isDiffAdd = isDiff && line.startsWith('+');
      const isDiffRemove = isDiff && line.startsWith('-');
      const diffClass = isDiffAdd ? styles.diffAdd : isDiffRemove ? styles.diffRemove : '';
      
      // Remove diff prefix for syntax highlighting
      const lineContent = (isDiffAdd || isDiffRemove) ? line.slice(1) : line;
      const lineNumber = lineIdx + 1;
      
      let tokenKey = 0;
      const patterns: { regex: RegExp; className: string }[] = [];
      
      // Language-specific patterns
      if (!effectiveLang || ['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'rust', 'go', 'swift', 'gradle', 'groovy', 'kotlin'].includes(effectiveLang)) {
        patterns.push({ regex: /(\/\/.*$)/, className: styles.syntaxComment });
        patterns.push({ regex: /(\/\*[\s\S]*?\*\/)/, className: styles.syntaxComment });
      }
      if (!effectiveLang || ['python', 'py', 'ruby', 'bash', 'sh', 'shell', 'yaml', 'yml'].includes(effectiveLang)) {
        patterns.push({ regex: /(#.*$)/, className: styles.syntaxComment });
      }
      if (['html', 'xml', 'svg'].includes(effectiveLang)) {
        patterns.push({ regex: /(<!--[\s\S]*?-->)/, className: styles.syntaxComment });
      }
      
      patterns.push({ regex: /("(?:[^"\\]|\\.)*")/, className: styles.syntaxString });
      patterns.push({ regex: /('(?:[^'\\]|\\.)*')/, className: styles.syntaxString });
      patterns.push({ regex: /(`(?:[^`\\]|\\.)*`)/, className: styles.syntaxString });
      
      const baseKeywords = [
        'const','let','var','function','return','if','else','for','while','class','interface','type','import','export','from',
        'async','await','try','catch','throw','new','this','super','extends','implements','public','private','protected','static','readonly',
        'def','fn','pub','mod','use','struct','enum','impl','trait','match','loop','break','continue',
        'true','false','null','undefined','None','True','False','self','nil'
      ];
      const gradleKeywords = [
        'plugins','dependencies','repositories','mavenCentral','gradlePluginPortal',
        'implementation','api','compileOnly','runtimeOnly','testImplementation','annotationProcessor',
        'group','version','id','java','test','sourceCompatibility','targetCompatibility','subprojects','allprojects','tasks'
      ];
      const keywordList = (effectiveLang === 'gradle' || effectiveLang === 'groovy' || effectiveLang === 'kotlin')
        ? [...baseKeywords, ...gradleKeywords]
        : baseKeywords;
      const keywords = new RegExp(`\\\\b(${keywordList.map(k => k.replace(/[.*+?^${}()|[\\\\]\\\\]/g, '\\\\$&')).join('|')})\\\\b`, 'g');
      patterns.push({ regex: keywords, className: styles.syntaxKeyword });
      patterns.push({ regex: /\b(\d+\.?\d*)\b/, className: styles.syntaxNumber });
      patterns.push({ regex: /\b([a-zA-Z_]\w*)\s*(?=\()/, className: styles.syntaxFunction });

      const replacements: { start: number; end: number; element: React.ReactNode }[] = [];

      patterns.forEach(({ regex, className }) => {
        const globalRegex = new RegExp(regex.source, 'g');
        let match;
        while ((match = globalRegex.exec(lineContent)) !== null) {
          const overlaps = replacements.some(r => 
            (match!.index >= r.start && match!.index < r.end) ||
            (match!.index + match![0].length > r.start && match!.index + match![0].length <= r.end)
          );
          if (!overlaps) {
            replacements.push({
              start: match.index,
              end: match.index + match[0].length,
              element: <span key={`${lineIdx}-${tokenKey++}`} className={className}>{match[0]}</span>
            });
          }
        }
      });

      replacements.sort((a, b) => a.start - b.start);

      let highlightedContent: React.ReactNode;
      if (replacements.length === 0) {
        highlightedContent = <span style={{ color: 'var(--text-primary)' }}>{lineContent}</span>;
      } else {
        const parts: React.ReactNode[] = [];
        let lastEnd = 0;
        replacements.forEach((r, idx) => {
          if (r.start > lastEnd) {
            parts.push(<span key={`${lineIdx}-text-${idx}`} style={{ color: 'var(--text-primary)' }}>{lineContent.slice(lastEnd, r.start)}</span>);
          }
          parts.push(r.element);
          lastEnd = r.end;
        });
        if (lastEnd < lineContent.length) {
          parts.push(<span key={`${lineIdx}-text-end`} style={{ color: 'var(--text-primary)' }}>{lineContent.slice(lastEnd)}</span>);
        }
        highlightedContent = parts;
      }

      return (
        <div key={lineIdx} className={`${styles.codeLine} ${diffClass}`}>
          <span 
            className={`${styles.lineNumber} ${styles.lineNumberClickable}`}
            onContextMenu={(e) => handleLineContextMenu(e, lineNumber, lineContent)}
            title="Right-click for AI options"
          >
            {lineNumber}
          </span>
          {isDiff && <span className={styles.diffMarker}>{isDiffAdd ? '+' : isDiffRemove ? '-' : ' '}</span>}
          <span className={styles.lineContent}>{highlightedContent}</span>
        </div>
      );
    });

    if (!truncated) return rendered;
    const remaining = codeLines.length - renderLines.length;
    rendered.push(
      <div key="__truncated__" className={styles.codeTruncatedLine}>
        … {remaining} more line{remaining === 1 ? '' : 's'} (expand to view)
      </div>
    );
    return rendered;
  };

  const displayLang = isAsciiArt ? 'diagram' : (language || 'text');

  if (isAsciiArt) {
    return (
      <div className={styles.codeBlockWrapper}>
        <div className={styles.codeBlockHeader}>
          <div className={styles.codeBlockInfo}>
            {filename && <span className={styles.codeBlockFilename}>{filename}</span>}
            <span className={styles.codeBlockLang}>{displayLang}</span>
          </div>
          <div className={styles.codeBlockActions}>
            {isCliLanguage(language) && (
              <button 
                className={styles.codeBlockBtn} 
                onClick={runInTerminal}
                title="Run in terminal"
              >
                <TerminalIcon size={14} />
                <span>Run</span>
              </button>
            )}
            <button 
              className={styles.codeBlockBtn} 
              onClick={copyToClipboard}
              title={copied ? 'Copied!' : 'Copy code'}
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>
        <div ref={contentRef} className={styles.codeBlockContent}>
          <pre className={`${styles.codeBlock} ${styles.asciiArtBlock}`} data-lang={displayLang}>
            <code className={styles.asciiArtText}>{asciiContent}</code>
          </pre>
        </div>
        
        {/* Line number context menu for AI actions */}
        {lineContextMenu && (
          <ContextMenu
            position={lineContextMenu.position}
            onClose={closeLineContextMenu}
            items={buildLineContextMenuItems()}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.codeBlockWrapper} ${isDiff ? styles.diffBlock : ''}`}>
      <div className={styles.codeBlockHeader}>
        <div className={styles.codeBlockInfo}>
          {filename && <span className={styles.codeBlockFilename}>{filename}</span>}
          <span className={styles.codeBlockLang}>{displayLang}</span>
        </div>
        <div className={styles.codeBlockActions}>
          {shouldCollapse && (
            <button 
              className={styles.codeBlockBtn} 
              onClick={() => setExpanded(!expanded)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              )}
              <span>{expanded ? 'Collapse' : 'Expand'}</span>
            </button>
          )}
          {isCliLanguage(language) && !isDiff && (
            <button 
              className={styles.codeBlockBtn} 
              onClick={runInTerminal}
              title="Run in terminal"
            >
              <TerminalIcon size={14} />
              <span>Run</span>
            </button>
          )}
          <button 
            className={styles.codeBlockBtn} 
            onClick={copyToClipboard}
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <div ref={contentRef} className={`${styles.codeBlockContent} ${expanded ? styles.expanded : ''}`}>
        <pre className={styles.codeBlock} data-lang={displayLang}>
          <code>{highlightCode(code, language)}</code>
        </pre>
      </div>
      
      {/* Line number context menu for AI actions */}
      {lineContextMenu && (
        <ContextMenu
          position={lineContextMenu.position}
          onClose={closeLineContextMenu}
          items={buildLineContextMenuItems()}
        />
      )}
    </div>
  );
}

// File operation types
interface FileOperation {
  type: 'create' | 'edit' | 'delete';
  path: string;
  content?: string;
  oldContent?: string;
  newContent?: string;
  mode?: 'replace' | 'insert';
  line?: number;
  invalidReason?: string;
}

interface PendingFileOperation {
  operation: FileOperation;
  messageId: string;
  applied: boolean;
  previousContent?: string;
  previousExists?: boolean;
  wasSkipped?: boolean;
  requiresOverwrite?: boolean;
  errorMessage?: string;
}

const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/;
const WINDOWS_ABS_REGEX = /^[a-zA-Z]:[\\/]/;
const INVALID_PATH_CHARS_REGEX = /[<>:"|?*]/;
const MARKDOWN_PATH_HINT_REGEX = /\*\*|`{2,}|^:+\s*/;
const SEVERITY_PATTERN = /(?:SEVERITY\s*[:\-–—]\s*)?\[?(CRITICAL|HIGH|MEDIUM|LOW|INFO|TEST)(?:\s*\/\s*(CODE QUALITY))?\]?(?:\s+(?:ISSUES|SEVERITY)\s*:\s*\*\*)?/i;

const getSeverityClassName = (severity: string): string => {
  switch (severity) {
    case 'CRITICAL':
      return styles.severityCritical;
    case 'HIGH':
      return styles.severityHigh;
    case 'MEDIUM':
      return styles.severityMedium;
    case 'LOW':
      return styles.severityLow;
    case 'INFO':
      return styles.severityInfo;
    case 'TEST':
      return styles.severityTest;
    default:
      return '';
  }
};

interface PathValidationOptions {
  allowExternalPaths?: boolean;
}

const getInvalidPathReason = (
  filePath: string, 
  workspaceRoot?: string,
  options?: PathValidationOptions
): string | null => {
  const { allowExternalPaths = false } = options || {};
  const trimmed = filePath.trim();
  if (!trimmed) return 'Path is empty.';
  if (CONTROL_CHAR_REGEX.test(trimmed)) return 'Path contains control characters.';
  if (MARKDOWN_PATH_HINT_REGEX.test(trimmed)) return 'Path appears to include markdown formatting.';

  const normalized = trimmed.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/') || WINDOWS_ABS_REGEX.test(trimmed);

  // Disallow characters that break paths on common platforms (especially Windows),
  // while still allowing a Windows drive letter like "C:/".
  const hasInvalidChars = INVALID_PATH_CHARS_REGEX.test(trimmed)
    && !/^[a-zA-Z]:[\\/]/.test(trimmed);
  if (hasInvalidChars) return 'Path contains invalid filename characters.';
  
  // When allowExternalPaths is true, skip workspace containment checks for absolute paths
  if (isAbsolute && !workspaceRoot && !allowExternalPaths) {
    return 'Absolute paths are not allowed.';
  }

  if (isAbsolute && workspaceRoot && !allowExternalPaths) {
    const rootNormalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized.startsWith(`${rootNormalized}/`) && normalized !== rootNormalized) {
      return 'Path is outside the workspace.';
    }
  }

  // Path traversal is still blocked even for external paths
  const rootNormalized = workspaceRoot ? workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '') : '';
  const relativeCandidate = rootNormalized && normalized.startsWith(rootNormalized)
    ? normalized.slice(rootNormalized.length)
    : normalized;
  const parts = relativeCandidate.replace(/^\/+/, '').split('/');
  if (parts.some((part) => part === '..')) return 'Path traversal is not allowed.';

  return null;
};

const normalizeRepoRelativePath = (workspaceRoot: string, filePath: string): string => {
  const rootNormalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  let normalized = filePath.replace(/\\/g, '/').trim();
  if (normalized === rootNormalized) {
    normalized = '';
  } else if (normalized.startsWith(`${rootNormalized}/`)) {
    normalized = normalized.slice(rootNormalized.length);
  }
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^\.\//, '');
  normalized = normalized.replace(/\/\.\//g, '/');
  normalized = normalized.replace(/\/{2,}/g, '/');
  return normalized;
};

const resolveWorkspaceRelativePath = (workspaceRoot: string, filePath: string): string => {
  return normalizeRepoRelativePath(workspaceRoot, filePath);
};

const normalizeContentForCompare = (content: string): string => {
  return content.replace(/\r\n/g, '\n').replace(/\n+$/g, '');
};

const applyEditOperation = (currentContent: string, operation: FileOperation) => {
  if (operation.mode === 'insert' && operation.line && operation.newContent) {
    const lines = currentContent.split('\n');
    const insertIdx = Math.max(0, Math.min(operation.line - 1, lines.length));
    lines.splice(insertIdx, 0, operation.newContent);
    const updatedContent = lines.join('\n');
    return { updatedContent, changed: updatedContent !== currentContent };
  }

  const oldContent = operation.oldContent ?? '';
  const newContent = operation.newContent ?? '';
  const oldTrimmed = oldContent.trim();
  const newTrimmed = newContent.trim();

  const candidates: Array<{ oldText: string; newText: string }> = [];
  if (oldContent && newContent) {
    candidates.push({ oldText: oldContent, newText: newContent });
  }
  if (oldTrimmed && newTrimmed) {
    candidates.push({ oldText: oldTrimmed, newText: newTrimmed });
  }

  for (const { oldText, newText } of candidates) {
    if (currentContent.includes(oldText)) {
      const updatedContent = currentContent.replace(oldText, newText);
      return { updatedContent, changed: updatedContent !== currentContent };
    }
  }

  const normalizedContent = currentContent.replace(/\r\n/g, '\n');
  for (const { oldText, newText } of candidates) {
    const normalizedOld = oldText.replace(/\r\n/g, '\n');
    const normalizedNew = newText.replace(/\r\n/g, '\n');
    if (normalizedOld && normalizedContent.includes(normalizedOld)) {
      const updatedContent = normalizedContent.replace(normalizedOld, normalizedNew);
      return { updatedContent, changed: updatedContent !== normalizedContent };
    }
  }

  if (newTrimmed && currentContent.includes(newTrimmed)) {
    return { updatedContent: currentContent, changed: false, reason: 'already-applied' as const };
  }

  return { updatedContent: currentContent, changed: false, reason: 'no-match' as const };
};

const readWorkspaceFile = async (workspaceRoot: string | null, filePath: string): Promise<string | null> => {
  if (!workspaceRoot) return null;
  const invalidReason = getInvalidPathReason(filePath, workspaceRoot);
  if (invalidReason) return null;
  const normalizedPath = normalizeRepoRelativePath(workspaceRoot, filePath);
  if (!normalizedPath) return null;
  const fullPath = `${workspaceRoot}/${normalizedPath}`.replace(/\/+/g, '/');
  try {
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
};

const getDiffStatusFromOperation = (operation: FileOperation): 'added' | 'deleted' | 'modified' => {
  if (operation.type === 'create') return 'added';
  if (operation.type === 'delete') return 'deleted';
  return 'modified';
};

const buildAIOperationDiffFromDisk = async (
  workspaceRoot: string | null,
  operation: FileOperation,
  pending?: PendingFileOperation
): Promise<{
  oldContent: string;
  newContent: string;
  operationType: 'create' | 'edit' | 'delete';
  requiresOverwrite?: boolean;
}> => {
  const operationType = operation.type;
  const opContent = operation.content ?? '';
  const opOld = operation.oldContent ?? '';
  const opNew = operation.newContent ?? opContent;

  const diskContent = await readWorkspaceFile(workspaceRoot, operation.path);
  const previousContent = pending?.previousContent;

  if (operationType === 'create') {
    const existingContent = previousContent ?? diskContent ?? '';
    const normalizedExisting = normalizeContentForCompare(existingContent);
    const normalizedIncoming = normalizeContentForCompare(opContent);
    const requiresOverwrite = Boolean(
      normalizedExisting && normalizedIncoming && normalizedExisting !== normalizedIncoming
    );
    const newContent = opContent || diskContent || '';
    return { oldContent: existingContent, newContent, operationType, requiresOverwrite };
  }

  if (operationType === 'delete') {
    const oldContent = previousContent ?? diskContent ?? opOld;
    return { oldContent, newContent: '', operationType, requiresOverwrite: false };
  }

  if (previousContent && diskContent) {
    return { oldContent: previousContent, newContent: diskContent, operationType, requiresOverwrite: false };
  }

  const baseContent = previousContent ?? diskContent ?? opOld;
  if (baseContent) {
    const { updatedContent, changed } = applyEditOperation(baseContent, operation);
    if (changed) {
      return { oldContent: baseContent, newContent: updatedContent, operationType, requiresOverwrite: false };
    }
    // Apply simulation failed (content mismatch), fall back to operation's proposed diff
  }

  return { oldContent: opOld, newContent: opNew, operationType, requiresOverwrite: false };
};

const buildDiscardCandidates = (
  workspaceRoot: string,
  filePath: string,
  statusPaths: string[]
): string[] => {
  const normalized = normalizeRepoRelativePath(workspaceRoot, filePath);
  const candidates = new Set<string>();
  if (normalized) {
    candidates.add(normalized);
  }
  const basename = normalized.split('/').pop() || normalized;
  statusPaths.forEach((path) => {
    if (!path) return;
    if (path === normalized || path.endsWith(`/${normalized}`)) {
      candidates.add(path);
    }
    if (basename && (path === basename || path.endsWith(`/${basename}`))) {
      candidates.add(path);
    }
  });
  return Array.from(candidates);
};

const discardGitChanges = async (
  workspaceRoot: string,
  filePath: string,
  statusPaths?: string[]
): Promise<boolean> => {
  try {
    const isRepo = await git.isGitRepo(workspaceRoot);
    if (!isRepo) return false;
    let paths = statusPaths;
    if (!paths) {
      const status = await git.status(workspaceRoot);
      paths = [
        ...status.staged.map((entry) => entry.path),
        ...status.unstaged.map((entry) => entry.path),
        ...status.untracked.map((entry) => entry.path),
      ];
    }
    const candidates = buildDiscardCandidates(workspaceRoot, filePath, paths);
    for (const candidate of candidates) {
      try {
        await useGitStore.getState().discardChanges(candidate);
        return true;
      } catch (error) {
        console.warn('Discard candidate failed:', candidate, error);
      }
    }
    return false;
  } catch (error) {
    console.warn('Failed to discard git changes:', error);
    return false;
  }
};

// Detect actionable tasks in plan mode responses
// Looks for numbered lists with actionable items
function detectActionableTasks(content: string): string[] {
  const tasks: string[] = [];
  
  // Match numbered lists patterns
  // Pattern 1: "1. Task name - description" or "1. Task name"
  // Pattern 2: Inside "What to Do Next?" sections
  const lines = content.split('\n');
  
  let inActionableSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for "What to Do Next?" or similar headers
    if (/^#+\s*(what\s+to\s+do\s+next|next\s+steps|action\s+items|ready\s+to\s+start)/i.test(line)) {
      inActionableSection = true;
      continue;
    }
    
    // Reset section flag on new header
    if (line.startsWith('#') && inActionableSection && !(/next|action|step|todo/i.test(line))) {
      inActionableSection = false;
    }
    
    // Match numbered list items: "1. Task" or "1) Task"
    const numberedMatch = line.match(/^(\d+)[\.\)]\s+(.+)/);
    if (numberedMatch && (inActionableSection || tasks.length > 0)) {
      const taskText = numberedMatch[2]
        .replace(/^Build\s+the\s+site\s+locally\s+-\s+/i, 'Build the site locally: ')
        .replace(/^Set\s+up\s+GitHub\s+repo\s+-\s+/i, 'Set up GitHub repo: ')
        .replace(/^Configure\s+Netlify\s+-\s+/i, 'Configure Netlify: ')
        .replace(/^DNS\s+setup\s+-\s+/i, 'DNS setup: ')
        .replace(/\s*🚀\s*$/, '')
        .trim();
      
      tasks.push(taskText);
    }
    
    // Also detect "Ready to start?" patterns
    if (/ready\s+to\s+start|which\s+would\s+you\s+like|which.*first/i.test(line)) {
      inActionableSection = true;
    }
  }
  
  // Filter out very short or generic tasks
  return tasks.filter(task => 
    task.length > 10 && 
    !task.match(/^(see|view|read|check)/i)
  );
}

// Parse file operations from AI response
function parseFileOperations(content: string, workspaceRoot?: string): FileOperation[] {
  const operations: FileOperation[] = [];
  const combineReasons = (...reasons: Array<string | null | undefined>) =>
    reasons.filter(Boolean).join(' ');
  const hasCodeFence = (value?: string) => Boolean(value && /```/.test(value));
  const looksLikePath = (value: string) => {
    if (!value) return false;
    if (value.length > 500) return false;
    if (MARKDOWN_PATH_HINT_REGEX.test(value)) return false;
    const hasInvalid = INVALID_PATH_CHARS_REGEX.test(value) && !/^[a-zA-Z]:\//.test(value);
    if (hasInvalid) return false;
    return /[\/\.]/.test(value) && !value.endsWith('/');
  };
  const coerceOperationPath = (raw: string) => {
    let cleaned = sanitizeOperationPath(raw)
      .replace(/^`+|`+$/g, '')
      .replace(/^"+|"+$/g, '')
      .trim();

    // If the model appends descriptions like `path="foo/bar.txt: ..."`, keep the likely prefix.
    const splitCandidates: number[] = [];
    const firstColon = cleaned.indexOf(':');
    const isWindowsDrive = /^[a-zA-Z]:\//.test(cleaned);
    if (firstColon !== -1 && !(isWindowsDrive && firstColon === 1)) {
      splitCandidates.push(firstColon);
    }
    const firstNewline = cleaned.search(/[\r\n]/);
    if (firstNewline !== -1) splitCandidates.push(firstNewline);
    const firstSpace = cleaned.indexOf(' ');
    if (firstSpace !== -1) splitCandidates.push(firstSpace);

    const cutAt = Math.min(...splitCandidates.filter((n) => n >= 0), Number.POSITIVE_INFINITY);
    if (Number.isFinite(cutAt) && cutAt > 0) {
      const prefix = cleaned.slice(0, cutAt).trim();
      if (looksLikePath(prefix)) cleaned = prefix;
    }

    return cleaned;
  };
  
  // Parse create_file tags — complete (with closing tag) only
  const createRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    const path = coerceOperationPath(match[1]);
    const opContent = match[2].trim();
    const invalidReason = combineReasons(
      getInvalidPathReason(path, workspaceRoot),
      !opContent ? 'Create operations must include file content.' : null,
      hasCodeFence(opContent) ? 'Code fences are not allowed inside file operation tags.' : null
    );
    operations.push({
      type: 'create',
      path,
      content: opContent,
      invalidReason: invalidReason || undefined,
    });
  }
  
  // Parse edit_file tags - first find all edit_file blocks, then extract old/new content
  const editBlockRegex = /<edit_file\s+path="([^"]+)"(?:\s+mode="(replace|insert)")?(?:\s+line="(\d+)")?>([\s\S]*?)<\/edit_file>/g;
  while ((match = editBlockRegex.exec(content)) !== null) {
    const path = coerceOperationPath(match[1]);
    const mode = (match[2] as 'replace' | 'insert') || 'replace';
    const line = match[3] ? parseInt(match[3]) : undefined;
    const body = match[4];
    
    // Extract old_content and new_content from the body
    const oldMatch = body.match(/<old_content>([\s\S]*?)<\/old_content>/);
    const newMatch = body.match(/<new_content>([\s\S]*?)<\/new_content>/);
    
    let oldContent = oldMatch ? oldMatch[1].trim() : undefined;
    let newContent = newMatch ? newMatch[1].trim() : undefined;
    
    if (!oldContent && !newContent && mode === 'insert') {
      newContent = body.trim();
    }

    const missingReplaceContent = mode === 'replace' && (!oldContent || !newContent);
    const missingInsertContent = mode === 'insert' && !newContent;
    const invalidLine = mode === 'insert' && (!line || Number.isNaN(line) || line < 1);
    const invalidReason = combineReasons(
      getInvalidPathReason(path, workspaceRoot),
      hasCodeFence(oldContent) || hasCodeFence(newContent) || hasCodeFence(body)
        ? 'Code fences are not allowed inside file operation tags.'
        : null,
      missingReplaceContent ? 'Edit operations must include <old_content> and <new_content>.' : null,
      missingInsertContent ? 'Insert operations must include content.' : null,
      invalidLine ? 'Insert operations require a valid line number.' : null
    );
    
    operations.push({
      type: 'edit',
      path,
      mode,
      line,
      oldContent,
      newContent,
      invalidReason: invalidReason || undefined,
    });
  }
  
  // Parse delete_file tags
  const deleteRegex = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  while ((match = deleteRegex.exec(content)) !== null) {
    const path = coerceOperationPath(match[1]);
    const invalidReason = getInvalidPathReason(path, workspaceRoot);
    operations.push({
      type: 'delete',
      path,
      invalidReason: invalidReason || undefined,
    });
  }
  
  // Deduplication: Remove duplicate operations on the same path
  // Keep the last operation for each path (most recent wins)
  const seenPaths = new Map<string, number>();
  const deduplicatedOps: FileOperation[] = [];
  
  for (let i = operations.length - 1; i >= 0; i--) {
    const op = operations[i];
    const key = `${op.type}:${op.path}`;
    
    if (!seenPaths.has(key)) {
      seenPaths.set(key, i);
      deduplicatedOps.unshift(op);
    } else {
      // For create operations, if we see duplicates, the content might be different
      // Check if content is identical to avoid losing unique operations
      const existingIdx = seenPaths.get(key)!;
      const existingOp = operations[existingIdx];
      
      if (op.type === 'create' && existingOp.type === 'create') {
        // Keep both if content differs significantly
        const contentSimilar = op.content === existingOp.content || 
          (op.content && existingOp.content && 
           Math.abs(op.content.length - existingOp.content.length) < 50 &&
           op.content.substring(0, 100) === existingOp.content.substring(0, 100));
        
        if (!contentSimilar) {
          // Mark the earlier one as potentially conflicting
          const conflictOp = { ...op, invalidReason: op.invalidReason || 'Duplicate operation detected - review carefully.' };
          deduplicatedOps.unshift(conflictOp);
        }
      }
    }
  }
  
  // Validate operation sequence: warn if delete followed by create on same path
  const pathOperationOrder = new Map<string, string[]>();
  for (const op of deduplicatedOps) {
    const ops = pathOperationOrder.get(op.path) || [];
    ops.push(op.type);
    pathOperationOrder.set(op.path, ops);
  }
  
  // Mark potential issues
  for (let i = 0; i < deduplicatedOps.length; i++) {
    const op = deduplicatedOps[i];
    const pathOps = pathOperationOrder.get(op.path) || [];
    
    // If there's a delete followed by create on same path, that's a recreate pattern - acceptable
    // If there's create followed by edit on same path, that's normal
    // If there's multiple creates with different content, warn
    if (op.type === 'create' && pathOps.filter(t => t === 'create').length > 1 && !op.invalidReason) {
      deduplicatedOps[i] = { 
        ...op, 
        invalidReason: 'Multiple create operations for same file - review for conflicts.' 
      };
    }
  }
  
  return deduplicatedOps;
}

// Interactive question types for AI clarification
interface QuestionOption {
  id: string;
  label: string;
  recommended?: boolean;
}

interface PendingQuestion {
  id: string;
  title?: string;
  question: string;
  options: QuestionOption[];
  answered?: boolean;
  selectedOptionId?: string;
  selectedOptionLabel?: string;
}

// Parse interactive questions from AI response
function parseQuestions(content: string): PendingQuestion[] {
  const questions: PendingQuestion[] = [];
  
  // Match <ask_question> tags with id and optional title
  const questionRegex = /<ask_question\s+id="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/ask_question>/g;
  let match;
  
  while ((match = questionRegex.exec(content)) !== null) {
    const id = match[1];
    const title = match[2] || undefined;
    const body = match[3];
    
    // Extract the question text
    const questionMatch = /<question>([\s\S]*?)<\/question>/.exec(body);
    const questionText = questionMatch ? questionMatch[1].trim() : '';
    
    if (!questionText) continue;
    
    // Extract options
    const options: QuestionOption[] = [];
    const optionRegex = /<option\s+id="([^"]+)"(?:\s+recommended="(true)")?\s*>([\s\S]*?)<\/option>/g;
    let optionMatch;
    
    while ((optionMatch = optionRegex.exec(body)) !== null) {
      options.push({
        id: optionMatch[1],
        label: optionMatch[3].trim(),
        recommended: optionMatch[2] === 'true',
      });
    }
    
    // Only add if we have at least 2 options
    if (options.length >= 2) {
      questions.push({
        id,
        title,
        question: questionText,
        options,
        answered: false,
      });
    }
  }
  
  return questions;
}

// Clean question tags from content for display
function cleanQuestionTags(content: string): string {
  return content.replace(/<ask_question\s+id="[^"]+"(?:\s+title="[^"]*")?\s*>[\s\S]*?<\/ask_question>/g, '').trim();
}

// Workspace operation types for creating new projects outside current workspace
interface WorkspaceOperation {
  type: 'create_workspace';
  path: string;
  name: string;
  description?: string;
  invalidReason?: string;
}

// Parse workspace creation operations from AI response
function parseWorkspaceOperations(content: string): WorkspaceOperation[] {
  const operations: WorkspaceOperation[] = [];
  
  // Match <create_workspace> tags with path and name attributes
  const workspaceRegex = /<create_workspace\s+path="([^"]+)"\s+name="([^"]+)"(?:\s*>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/create_workspace>|\s*\/>)/g;
  let match;
  
  while ((match = workspaceRegex.exec(content)) !== null) {
    const path = match[1].trim();
    const name = match[2].trim();
    const description = match[3]?.trim();
    
    // Basic validation
    let invalidReason: string | undefined;
    if (!path) {
      invalidReason = 'Workspace path is empty.';
    } else if (!name) {
      invalidReason = 'Workspace name is empty.';
    } else if (!/^\/|^[a-zA-Z]:[\\/]/.test(path)) {
      invalidReason = 'Workspace path must be an absolute path.';
    } else if (/\.\./.test(path)) {
      invalidReason = 'Path traversal is not allowed in workspace paths.';
    }
    
    operations.push({
      type: 'create_workspace',
      path,
      name,
      description,
      invalidReason,
    });
  }
  
  return operations;
}

// Clean workspace operation tags from content for display
function cleanWorkspaceOperationTags(content: string): string {
  return content
    .replace(/<create_workspace\s+path="[^"]+"\s+name="[^"]+"(?:\s*>[\s\S]*?<\/create_workspace>|\s*\/>)/g, '')
    .trim();
}

// Command operation types for terminal command execution
interface ParsedCommand {
  command: string;
  description?: string;
  sandbox?: boolean;
}

// Parse command operations from AI response
function parseCommandOperations(content: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  
  // Match <run_command> tags with optional description and sandbox attributes
  const commandRegex = /<run_command(?:\s+description="([^"]*)")?(?:\s+sandbox="(true|false)")?\s*>([\s\S]*?)<\/run_command>/g;
  let match;
  
  while ((match = commandRegex.exec(content)) !== null) {
    const description = match[1] || undefined;
    const sandbox = match[2] === 'true';
    const command = match[3].trim();
    
    if (command) {
      commands.push({
        command,
        description,
        sandbox,
      });
    }
  }
  
  return commands;
}

// Clean command tags from content for display
function cleanCommandTags(content: string): string {
  return content
    .replace(/<run_command(?:\s+description="[^"]*")?(?:\s+sandbox="(?:true|false)")?\s*>[\s\S]*?<\/run_command>/g, '')
    .trim();
}

// Plan mode types
interface PlanApproach {
  name: string;
  recommended?: boolean;
  pros: string[];
  cons: string[];
}

interface PlanTask {
  id: string;
  text: string;
  status: 'pending' | 'in-progress' | 'completed' | 'skipped';
}

interface Plan {
  title: string;
  overview?: string;
  approaches: PlanApproach[];
  tasks: PlanTask[];
  architecture?: string;
  considerations?: string[];
}

interface Checklist {
  title: string;
  items: string[];
}

interface Decision {
  question: string;
  content: string;
}

// Parse plan components from AI response
function parsePlanComponents(content: string): {
  plans: Plan[];
  checklists: Checklist[];
  decisions: Decision[];
} {
  const plans: Plan[] = [];
  const checklists: Checklist[] = [];
  const decisions: Decision[] = [];

  // Parse <plan> tags
  const planRegex = /<plan\s+title="([^"]+)">([\s\S]*?)<\/plan>/g;
  let match;
  while ((match = planRegex.exec(content)) !== null) {
    const title = match[1];
    const planContent = match[2];
    
    // Extract overview
    const overviewMatch = /<overview>([\s\S]*?)<\/overview>/.exec(planContent);
    const overview = overviewMatch ? overviewMatch[1].trim() : undefined;
    
    // Extract approaches
    const approaches: PlanApproach[] = [];
    const approachRegex = /<approach\s+name="([^"]+)"(?:\s+recommended="(true|false)")?>[\s\S]*?(?:<pros>([\s\S]*?)<\/pros>)?[\s\S]*?(?:<cons>([\s\S]*?)<\/cons>)?[\s\S]*?<\/approach>/g;
    let approachMatch;
    while ((approachMatch = approachRegex.exec(planContent)) !== null) {
      const prosText = approachMatch[3] || '';
      const consText = approachMatch[4] || '';
      approaches.push({
        name: approachMatch[1],
        recommended: approachMatch[2] === 'true',
        pros: prosText.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().substring(1).trim()),
        cons: consText.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().substring(1).trim()),
      });
    }
    
    // Extract tasks
    const tasksMatch = /<tasks>([\s\S]*?)<\/tasks>/.exec(planContent);
    const tasks: PlanTask[] = tasksMatch 
      ? tasksMatch[1].split('\n')
          .filter(l => l.trim().startsWith('- ['))
          .map((l, idx) => {
            const line = l.trim();
            // Parse checkbox: - [ ], - [x], - [>], - [-]
            const checkboxMatch = line.match(/^- \[(.)\]\s*(.+)$/);
            if (!checkboxMatch) return null;
            
            const marker = checkboxMatch[1].toLowerCase();
            const text = checkboxMatch[2].trim();
            
            // Map markers to status
            let status: 'pending' | 'in-progress' | 'completed' | 'skipped' = 'pending';
            if (marker === 'x') status = 'completed';
            else if (marker === '>') status = 'in-progress';
            else if (marker === '-') status = 'skipped';
            
            return {
              id: `task-${idx}-${Date.now()}`,
              text,
              status
            };
          })
          .filter((t): t is PlanTask => t !== null)
      : [];
    
    // Extract architecture
    const archMatch = /<architecture>([\s\S]*?)<\/architecture>/.exec(planContent);
    let architecture = archMatch ? archMatch[1].trim() : undefined;
    
    // Clean up architecture content - remove markdown code fences if present
    if (architecture) {
      // Remove ```mermaid and ``` wrappers
      architecture = architecture.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trim();
      // Only use if there's actual content left
      if (!architecture) {
        architecture = undefined;
      }
    }
    
    // Extract considerations
    const considerationsMatch = /<considerations>([\s\S]*?)<\/considerations>/.exec(planContent);
    const considerations = considerationsMatch
      ? considerationsMatch[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().substring(1).trim())
      : [];
    
    plans.push({ title, overview, approaches, tasks, architecture, considerations });
  }

  // Parse <checklist> tags (support any attributes, extract title if present)
  // First, parse complete checklist tags
  const checklistRegex = /<checklist([^>]*)>([\s\S]*?)<\/checklist>/g;
  const completedChecklistPositions = new Set<number>();
  while ((match = checklistRegex.exec(content)) !== null) {
    completedChecklistPositions.add(match.index);
    const attrs = match[1];
    const titleMatch = attrs.match(/title="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1] : 'Checklist';
    const items = match[2].split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('-'))
      // Strip leading "- [ ] ", "- [x] ", "- [X] ", "- " etc. to get plain task text
      .map(l => l.replace(/^-\s*(?:\[[ xX>-]\]\s*)?/, '').trim())
      .filter(l => l.length > 0);
    checklists.push({ title, items });
  }
  
  // Then, parse incomplete checklist tags (streaming support)
  // Only match if there's no closing tag and at least one list item
  const incompleteChecklistRegex = /<checklist([^>]*)>([\s\S]*)$/g;
  while ((match = incompleteChecklistRegex.exec(content)) !== null) {
    // Skip if this position was already matched as a complete checklist
    if (completedChecklistPositions.has(match.index)) continue;
    // Only process if content doesn't contain a closing tag (truly incomplete)
    if (match[2].includes('</checklist>')) continue;
    
    const attrs = match[1];
    const titleMatch = attrs.match(/title="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1] : 'Checklist';
    const items = match[2].split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('-'))
      .map(l => l.replace(/^-\s*(?:\[[ xX>-]\]\s*)?/, '').trim())
      .filter(l => l.length > 0);
    // Only add if we have at least one item
    if (items.length > 0) {
      checklists.push({ title, items });
    }
  }

  // Parse <decision> tags
  const decisionRegex = /<decision\s+question="([^"]+)">([\s\S]*?)<\/decision>/g;
  while ((match = decisionRegex.exec(content)) !== null) {
    decisions.push({
      question: match[1],
      content: match[2].trim(),
    });
  }

  return { plans, checklists, decisions };
}

// Component to display a plan
function PlanView({ plan, onProceedWithApproach }: { plan: Plan; onProceedWithApproach?: (approach: PlanApproach) => void }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview', 'approaches', 'tasks']));
  const [tasks, setTasks] = useState<PlanTask[]>(plan.tasks);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { currentWorkspace } = useWorkspaceStore();
  
  // Default to recommended approach, or first one if none recommended
  const defaultApproachIdx = plan.approaches.findIndex(a => a.recommended);
  const [selectedApproachIdx, setSelectedApproachIdx] = useState<number>(defaultApproachIdx >= 0 ? defaultApproachIdx : 0);
  const [approachConfirmed, setApproachConfirmed] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const cycleTaskStatus = (taskId: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      
      // Cycle through: pending → in-progress → completed → skipped → pending
      const statusCycle: Record<string, 'pending' | 'in-progress' | 'completed' | 'skipped'> = {
        'pending': 'in-progress',
        'in-progress': 'completed',
        'completed': 'skipped',
        'skipped': 'pending'
      };
      
      return { ...task, status: statusCycle[task.status] };
    }));
  };

  const addTask = () => {
    if (!newTaskText.trim()) return;
    
    const newTask: PlanTask = {
      id: `task-${Date.now()}`,
      text: newTaskText.trim(),
      status: 'pending'
    };
    
    setTasks(prev => [...prev, newTask]);
    setNewTaskText('');
  };

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(task => task.id !== taskId));
  };

  const startEditTask = (task: PlanTask) => {
    setEditingTaskId(task.id);
    setEditingText(task.text);
  };

  const saveEditTask = (taskId: string) => {
    if (!editingText.trim()) return;
    
    setTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, text: editingText.trim() } : task
    ));
    setEditingTaskId(null);
    setEditingText('');
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditingText('');
  };

  const taskCounts = useMemo(() => {
    const counts = { total: tasks.length, completed: 0, skipped: 0, inProgress: 0, pending: 0 };
    tasks.forEach((task) => {
      if (task.status === 'completed') counts.completed += 1;
      else if (task.status === 'skipped') counts.skipped += 1;
      else if (task.status === 'in-progress') counts.inProgress += 1;
      else counts.pending += 1;
    });
    const addressed = counts.completed + counts.skipped;
    const remaining = Math.max(0, counts.total - addressed);
    return { ...counts, addressed, remaining };
  }, [tasks]);

  const getTaskStatusIcon = (status: 'pending' | 'in-progress' | 'completed' | 'skipped') => {
    switch (status) {
      case 'pending': return { icon: '○', color: '#808080', label: 'Pending (click to start)' };
      case 'in-progress': return { icon: '◐', color: '#2196f3', label: 'In Progress (click to complete)' };
      case 'completed': return { icon: '✓', color: '#4caf50', label: 'Completed (click to skip)' };
      case 'skipped': return { icon: '⊘', color: '#ff9800', label: 'Skipped (click to reset)' };
    }
  };

  const saveToPlanFile = async () => {
    if (!currentWorkspace) {
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: 'No workspace open', type: 'error' }
      }));
      return;
    }

    setIsSaving(true);
    
    try {
      const { usePlanStore } = await import('../../store/planStore');
      const planStore = usePlanStore.getState();
      
      // Build markdown content for the plan body
      let content = '';
      
      if (plan.approaches.length > 0) {
        content += `## Approaches\n\n`;
        plan.approaches.forEach((approach) => {
          content += `### ${approach.name}${approach.recommended ? ' (Recommended)' : ''}\n\n`;
          if (approach.pros.length > 0) {
            content += `**Pros:**\n`;
            approach.pros.forEach(pro => content += `- ${pro}\n`);
            content += '\n';
          }
          if (approach.cons.length > 0) {
            content += `**Cons:**\n`;
            approach.cons.forEach(con => content += `- ${con}\n`);
            content += '\n';
          }
        });
      }
      
      if (plan.architecture) {
        content += `## Architecture\n\n\`\`\`mermaid\n${plan.architecture}\n\`\`\`\n\n`;
      }
      
      if (plan.considerations && plan.considerations.length > 0) {
        content += `## Considerations\n\n`;
        plan.considerations.forEach(consideration => content += `- ${consideration}\n`);
        content += '\n';
      }
      
      // Convert tasks to PlanTodo format
      const todos = tasks.map(task => ({
        id: task.id,
        content: task.text,
        status: task.status === 'in-progress' ? 'in_progress' as const : task.status as 'pending' | 'completed' | 'skipped',
      }));
      
      // Create plan using planStore
      const savedPlan = await planStore.createPlan(
        plan.title,
        content,
        todos
      );
      
      // Open the plan file in editor
      await planStore.openPlanInEditor(savedPlan.id);
      
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Plan saved and opened: ${plan.title}`, type: 'success' }
      }));
      
    } catch (error) {
      console.error('Failed to save plan:', error);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Failed to save plan: ${error}`, type: 'error' }
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const exportPlan = () => {
    let markdown = `# ${plan.title}\n\n`;
    
    if (plan.overview) {
      markdown += `## Overview\n\n${plan.overview}\n\n`;
    }
    
    if (plan.approaches.length > 0) {
      markdown += `## Approaches\n\n`;
      plan.approaches.forEach((approach) => {
        markdown += `### ${approach.name}${approach.recommended ? ' ⭐ (Recommended)' : ''}\n\n`;
        if (approach.pros.length > 0) {
          markdown += `**Pros:**\n`;
          approach.pros.forEach(pro => markdown += `- ${pro}\n`);
          markdown += '\n';
        }
        if (approach.cons.length > 0) {
          markdown += `**Cons:**\n`;
          approach.cons.forEach(con => markdown += `- ${con}\n`);
          markdown += '\n';
        }
      });
    }
    
    if (plan.tasks.length > 0) {
      markdown += `## Implementation Steps\n\n`;
      plan.tasks.forEach(task => markdown += `${task}\n`);
      markdown += '\n';
    }
    
    if (plan.architecture) {
      markdown += `## Architecture\n\n${plan.architecture}\n\n`;
    }
    
    if (plan.considerations && plan.considerations.length > 0) {
      markdown += `## Considerations\n\n`;
      plan.considerations.forEach(consideration => markdown += `- ${consideration}\n`);
    }
    
    // Copy to clipboard
    navigator.clipboard.writeText(markdown);
    window.dispatchEvent(new CustomEvent('show-notification', {
      detail: { message: 'Plan exported to clipboard', type: 'success' }
    }));
  };

  return (
    <div className={styles.planContainer}>
      <div className={styles.planHeader}>
        <div className={styles.planHeaderLeft}>
          <span className={styles.planIcon}>📋</span>
          <div className={styles.planHeaderText}>
            <h3 className={styles.planTitle}>{plan.title}</h3>
            {taskCounts.total > 0 && (
              <div className={styles.planStatus}>
                {taskCounts.addressed} addressed · {taskCounts.remaining} remaining
                {taskCounts.inProgress > 0 && ` · ${taskCounts.inProgress} in progress`}
              </div>
            )}
          </div>
        </div>
        <div className={styles.planHeaderActions}>
          <button 
            className={styles.savePlanBtn} 
            onClick={saveToPlanFile} 
            disabled={isSaving}
            title="Save to .plan.md file"
          >
            {isSaving ? <RefreshCw size={14} className={styles.spinning} /> : <FolderOpen size={14} />}
            <span>Save to File</span>
          </button>
          <button className={styles.exportPlanBtn} onClick={exportPlan} title="Copy to clipboard">
            <Copy size={14} />
          </button>
        </div>
      </div>
      
      {plan.overview && (
        <div className={styles.planSection}>
          <div className={styles.planSectionHeader} onClick={() => toggleSection('overview')}>
            <span className={styles.planSectionTitle}>Overview</span>
            <span className={styles.planToggle}>{expandedSections.has('overview') ? '−' : '+'}</span>
          </div>
          {expandedSections.has('overview') && (
            <div className={styles.planSectionContent}>
              <p>{plan.overview}</p>
            </div>
          )}
        </div>
      )}

      {plan.approaches.length > 0 && (
        <div className={styles.planSection}>
          <div className={styles.planSectionHeader} onClick={() => toggleSection('approaches')}>
            <span className={styles.planSectionTitle}>Approaches</span>
            <span className={styles.planToggle}>{expandedSections.has('approaches') ? '−' : '+'}</span>
          </div>
          {expandedSections.has('approaches') && (
            <div className={styles.planSectionContent}>
              {plan.approaches.map((approach, idx) => (
                <div 
                  key={idx} 
                  className={`${styles.approach} ${approach.recommended ? styles.recommended : ''} ${selectedApproachIdx === idx ? styles.approachSelected : ''} ${!approachConfirmed ? styles.approachSelectable : ''}`}
                  onClick={() => !approachConfirmed && setSelectedApproachIdx(idx)}
                  style={{ cursor: approachConfirmed ? 'default' : 'pointer' }}
                >
                  <div className={styles.approachHeader}>
                    <span className={styles.approachName}>
                      {!approachConfirmed && (
                        <span className={styles.approachRadio}>
                          {selectedApproachIdx === idx ? '◉' : '○'}
                        </span>
                      )}
                      {approach.name}
                    </span>
                    {approach.recommended && <span className={styles.recommendedBadge}>Recommended</span>}
                    {approachConfirmed && selectedApproachIdx === idx && <span className={styles.selectedBadge}>Selected</span>}
                  </div>
                  {approach.pros.length > 0 && (
                    <div className={styles.approachList}>
                      <div className={styles.prosLabel}>✓ Pros</div>
                      <ul className={styles.prosList}>
                        {approach.pros.map((pro, i) => <li key={i}>{pro}</li>)}
                      </ul>
                    </div>
                  )}
                  {approach.cons.length > 0 && (
                    <div className={styles.approachList}>
                      <div className={styles.consLabel}>✗ Cons</div>
                      <ul className={styles.consList}>
                        {approach.cons.map((con, i) => <li key={i}>{con}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
              {!approachConfirmed && plan.approaches.length > 0 && onProceedWithApproach && (
                <div className={styles.approachActions}>
                  <button 
                    className={styles.confirmApproachBtn}
                    onClick={() => {
                      setApproachConfirmed(true);
                      onProceedWithApproach(plan.approaches[selectedApproachIdx]);
                    }}
                  >
                    Confirm & Proceed with {plan.approaches[selectedApproachIdx]?.name || 'Selected Approach'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <div className={styles.planSection}>
          <div className={styles.planSectionHeader} onClick={() => toggleSection('tasks')}>
            <span className={styles.planSectionTitle}>
              Tasks ({tasks.filter(t => t.status === 'completed').length}/{tasks.length} completed)
            </span>
            <span className={styles.planToggle}>{expandedSections.has('tasks') ? '−' : '+'}</span>
          </div>
          {expandedSections.has('tasks') && (
            <div className={styles.planSectionContent}>
              <ul className={styles.taskList}>
                {tasks.map((task) => {
                  const statusInfo = getTaskStatusIcon(task.status);
                  return (
                    <li 
                      key={task.id} 
                      className={`${styles.taskItem} ${styles[`taskStatus${task.status.charAt(0).toUpperCase()}${task.status.slice(1).replace('-', '')}`]}`}
                    >
                      <button
                        className={styles.taskStatusBtn}
                        onClick={() => cycleTaskStatus(task.id)}
                        title={statusInfo.label}
                        style={{ color: statusInfo.color }}
                      >
                        {statusInfo.icon}
                      </button>
                      {editingTaskId === task.id ? (
                        <div className={styles.taskEditContainer}>
                          <input
                            type="text"
                            className={styles.taskEditInput}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditTask(task.id);
                              if (e.key === 'Escape') cancelEditTask();
                            }}
                            autoFocus
                          />
                          <button 
                            className={styles.taskSaveBtn}
                            onClick={() => saveEditTask(task.id)}
                            title="Save"
                          >
                            ✓
                          </button>
                          <button 
                            className={styles.taskCancelBtn}
                            onClick={cancelEditTask}
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className={styles.taskText}>{task.text}</span>
                          <div className={styles.taskActions}>
                            <button
                              className={styles.taskActionBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditTask(task);
                              }}
                              title="Edit task"
                            >
                              ✎
                            </button>
                            <button
                              className={styles.taskActionBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(task.id);
                              }}
                              title="Delete task"
                            >
                              🗑
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className={styles.addTaskContainer}>
                <input
                  type="text"
                  className={styles.addTaskInput}
                  placeholder="Add a new task..."
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTask();
                  }}
                />
                <button 
                  className={styles.addTaskBtn}
                  onClick={addTask}
                  disabled={!newTaskText.trim()}
                >
                  <Plus size={14} />
                  Add Task
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {plan.architecture && (
        <div className={styles.planSection}>
          <div className={styles.planSectionHeader} onClick={() => toggleSection('architecture')}>
            <span className={styles.planSectionTitle}>Architecture</span>
            <span className={styles.planToggle}>{expandedSections.has('architecture') ? '−' : '+'}</span>
          </div>
          {expandedSections.has('architecture') && (
            <div className={styles.planSectionContent}>
              <MermaidDiagram chart={plan.architecture} id={`plan-${plan.title}`} />
            </div>
          )}
        </div>
      )}

      {plan.considerations && plan.considerations.length > 0 && (
        <div className={styles.planSection}>
          <div className={styles.planSectionHeader} onClick={() => toggleSection('considerations')}>
            <span className={styles.planSectionTitle}>Considerations</span>
            <span className={styles.planToggle}>{expandedSections.has('considerations') ? '−' : '+'}</span>
          </div>
          {expandedSections.has('considerations') && (
            <div className={styles.planSectionContent}>
              <ul className={styles.considerationsList}>
                {plan.considerations.map((consideration, idx) => (
                  <li key={idx}>{consideration}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Component to display a checklist
function ChecklistView({ checklist, onImplementInAgent }: {
  checklist: Checklist;
  onImplementInAgent?: (tasks: string[]) => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(() =>
    new Array(checklist.items.length).fill(false)
  );

  const completedCount = checked.filter(Boolean).length;
  const totalCount = checklist.items.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const remainingCount = Math.max(0, totalCount - completedCount);


  return (
    <div className={styles.checklistContainer}>
      <div className={styles.checklistHeader}>
        <div className={styles.checklistHeaderLeft}>
          <ListChecks size={15} className={styles.checklistIcon} />
          <div className={styles.checklistHeaderText}>
            <h4 className={styles.checklistTitle}>{checklist.title}</h4>
            {totalCount > 0 && (
              <div className={styles.checklistStatus}>
                {completedCount} addressed · {remainingCount} remaining
              </div>
            )}
          </div>
        </div>
        <div className={styles.checklistHeaderRight}>
          <span className={styles.checklistProgress}>
            {completedCount}/{totalCount}
          </span>
          {onImplementInAgent && remainingCount > 0 && (
            <button
              className={styles.checklistFixBtn}
              onClick={() => onImplementInAgent(checklist.items.filter((_, idx) => !checked[idx]))}
              title="Fix remaining items in Agent Mode"
            >
              <Zap size={12} />
              Fix in Agent Mode
            </button>
          )}
        </div>
      </div>
      <div className={styles.checklistProgressBar}>
        <div
          className={styles.checklistProgressFill}
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className={styles.checklistItems}>
        {checklist.items.map((item, idx) => (
          <li
            key={idx}
            className={`${styles.checklistItem} ${checked[idx] ? styles.checklistItemDone : ''}`}
          >
            <span className={checked[idx] ? styles.checklistCircleDone : styles.checklistCircle} />
            <div className={styles.checklistItemText}>
              <MarkdownRenderer content={item} />
            </div>
          </li>
        ))}
      </ul>
      {onImplementInAgent && (
        <div className={styles.checklistFooter}>
          <button
            className={styles.checklistImplementBtn}
            onClick={() => onImplementInAgent(checklist.items)}
          >
            <Zap size={13} />
            Implement in Agent Mode
          </button>
        </div>
      )}
    </div>
  );
}

// Component to display a decision
function DecisionView({ decision }: { decision: Decision }) {
  return (
    <div className={styles.decisionContainer}>
      <div className={styles.decisionHeader}>
        <span className={styles.decisionIcon}>🤔</span>
        <h4 className={styles.decisionQuestion}>{decision.question}</h4>
      </div>
      <div className={styles.decisionContent}>
        <MarkdownRenderer content={decision.content} />
      </div>
    </div>
  );
}

// Component to render Mermaid diagrams
function MermaidDiagram({ chart, id }: { chart: string; id: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderChart = async () => {
      // Validate chart content before rendering
      if (!chart || !chart.trim()) {
        setError('No diagram content provided');
        return;
      }

      // Clean the chart content - remove any markdown wrappers
      let cleanChart = chart.trim();
      cleanChart = cleanChart.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trim();
      
      if (!cleanChart) {
        setError('Empty diagram after cleanup');
        return;
      }

      // Basic validation - check if it looks like mermaid syntax
      const validMermaidStarts = ['graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie', 'flowchart', 'gitGraph'];
      const startsWithValid = validMermaidStarts.some(keyword => cleanChart.toLowerCase().startsWith(keyword.toLowerCase()));
      
      if (!startsWithValid) {
        setError('Invalid diagram syntax - must start with a valid Mermaid diagram type');
        return;
      }

      try {
        // Sanitize ID to create valid CSS selector
        // Remove/replace invalid characters: spaces, colons, special chars
        const sanitizedId = id
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
          .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens
        
        const uniqueId = `mermaid-${sanitizedId}-${Date.now()}`;
        const { svg } = await mermaid.render(uniqueId, cleanChart);
        setSvg(svg);
        setError(null);
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    };

    renderChart();
  }, [chart, id]);

  if (error) {
    return (
      <div className={styles.mermaidError}>
        <div className={styles.mermaidErrorHeader}>Diagram Error</div>
        <pre className={styles.codeBlock}>
          <code>{chart}</code>
        </pre>
        <div className={styles.mermaidErrorMsg}>{error}</div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={styles.mermaidLoading}>
        Rendering diagram...
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={styles.mermaidDiagram}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Component to display interactive AI questions with option selection
interface QuestionBlockProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, optionId: string, optionLabel: string) => void;
  disabled?: boolean;
}

function QuestionBlock({ question, onAnswer, disabled }: QuestionBlockProps) {
  const isAnswered = question.answered && question.selectedOptionId;
  
  return (
    <div className={`${styles.questionBlock} ${isAnswered ? styles.questionBlockAnswered : ''}`}>
      <div className={styles.questionHeader}>
        <div className={styles.questionIcon}>
          {isAnswered ? (
            <Check size={16} />
          ) : (
            <MessageSquare size={16} />
          )}
        </div>
        <h4 className={styles.questionTitle}>
          {question.title || 'Question'}
        </h4>
      </div>
      
      <p className={styles.questionText}>{question.question}</p>
      
      <div className={styles.questionOptions}>
        {question.options.map((option) => {
          const isSelected = question.selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              className={`${styles.questionOption} ${option.recommended ? styles.questionOptionRecommended : ''} ${isSelected ? styles.questionOptionSelected : ''}`}
              onClick={() => !disabled && !isAnswered && onAnswer(question.id, option.id, option.label)}
              disabled={disabled || isAnswered}
            >
              <div className={styles.questionOptionRadio} />
              <div className={styles.questionOptionContent}>
                <span className={styles.questionOptionLabel}>
                  {option.label}
                  {option.recommended && (
                    <span className={styles.questionOptionBadge}>
                      <Zap size={10} />
                      Recommended
                    </span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      
      {isAnswered && question.selectedOptionLabel && (
        <div className={styles.questionAnsweredBanner}>
          <div className={styles.questionAnsweredIcon}>
            <Check size={12} />
          </div>
          <span className={styles.questionAnsweredText}>
            Selected: <strong>{question.selectedOptionLabel}</strong>
          </span>
        </div>
      )}
    </div>
  );
}

// Component to display workspace creation request with confirmation
interface WorkspaceCreationBlockProps {
  operation: WorkspaceOperation;
  onConfirm: () => void;
  onCancel: () => void;
  isCreating?: boolean;
  isCreated?: boolean;
}

function WorkspaceCreationBlock({ operation, onConfirm, onCancel, isCreating, isCreated }: WorkspaceCreationBlockProps) {
  if (operation.invalidReason) {
    return (
      <div className={`${styles.workspaceBlock} ${styles.workspaceBlockInvalid}`}>
        <div className={styles.workspaceHeader}>
          <div className={styles.workspaceIcon}>
            <AlertTriangle size={16} />
          </div>
          <h4 className={styles.workspaceTitle}>Invalid Workspace Request</h4>
        </div>
        <p className={styles.workspaceError}>{operation.invalidReason}</p>
        <div className={styles.workspaceDetails}>
          <div className={styles.workspaceDetail}>
            <span className={styles.workspaceDetailLabel}>Path:</span>
            <code className={styles.workspaceDetailValue}>{operation.path}</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.workspaceBlock} ${isCreated ? styles.workspaceBlockCreated : ''}`}>
      <div className={styles.workspaceHeader}>
        <div className={styles.workspaceIcon}>
          {isCreated ? <Check size={16} /> : <FolderOpen size={16} />}
        </div>
        <h4 className={styles.workspaceTitle}>
          {isCreated ? 'Workspace Created' : 'Create New Workspace'}
        </h4>
      </div>
      
      <div className={styles.workspaceDetails}>
        <div className={styles.workspaceDetail}>
          <span className={styles.workspaceDetailLabel}>Name:</span>
          <span className={styles.workspaceDetailValue}>{operation.name}</span>
        </div>
        <div className={styles.workspaceDetail}>
          <span className={styles.workspaceDetailLabel}>Path:</span>
          <code className={styles.workspaceDetailValue}>{operation.path}</code>
        </div>
        {operation.description && (
          <div className={styles.workspaceDetail}>
            <span className={styles.workspaceDetailLabel}>Description:</span>
            <span className={styles.workspaceDetailValue}>{operation.description}</span>
          </div>
        )}
      </div>
      
      {!isCreated && (
        <div className={styles.workspaceActions}>
          <button
            className={styles.workspaceConfirmBtn}
            onClick={onConfirm}
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 size={14} className={styles.spinning} />
                Creating...
              </>
            ) : (
              <>
                <FolderOpen size={14} />
                Create & Open Workspace
              </>
            )}
          </button>
          <button
            className={styles.workspaceCancelBtn}
            onClick={onCancel}
            disabled={isCreating}
          >
            Cancel
          </button>
        </div>
      )}
      
      {isCreated && (
        <div className={styles.workspaceCreatedBanner}>
          <Check size={14} />
          <span>Workspace created and opened successfully!</span>
        </div>
      )}
    </div>
  );
}

// Component to display command execution request with approval buttons
interface CommandApprovalBlockProps {
  command: ParsedCommand;
  commandId: string;
  status: 'pending' | 'approved' | 'running' | 'completed' | 'skipped' | 'failed';
  output?: string;
  exitCode?: number;
  error?: string;
  onSkip: () => void;
  onAlwaysRun: () => void;
  onRun: () => void;
}

function CommandApprovalBlock({
  command,
  commandId,
  status,
  output,
  exitCode,
  error,
  onSkip,
  onAlwaysRun,
  onRun,
}: CommandApprovalBlockProps) {
  const [outputExpanded, setOutputExpanded] = useState(true);

  return (
    <div className={`${styles.commandBlock} ${styles[`commandBlock${status.charAt(0).toUpperCase()}${status.slice(1)}`]}`}>
      <div className={styles.commandHeader}>
        <div className={styles.commandHeaderLeft}>
          <TerminalIcon size={14} className={styles.commandIcon} />
          <span className={styles.commandDescription}>
            {command.description || 'Run command'}
          </span>
          {command.sandbox && (
            <span className={styles.commandSandboxBadge}>Sandbox</span>
          )}
        </div>
        {status === 'running' && (
          <Loader2 size={14} className={styles.spinning} />
        )}
        {status === 'completed' && (
          <Check size={14} className={styles.commandIconCompleted} />
        )}
        {status === 'failed' && (
          <AlertTriangle size={14} className={styles.commandIconFailed} />
        )}
        {status === 'skipped' && (
          <span className={styles.commandSkippedBadge}>Skipped</span>
        )}
      </div>

      <pre className={styles.commandCode}>{command.command}</pre>

      {status === 'pending' && (
        <div className={styles.commandApprovalActions}>
          <span className={styles.commandPendingLabel}>Pending approval</span>
          <div className={styles.commandApprovalButtons}>
            <button
              className={styles.commandSkipBtn}
              onClick={onSkip}
              title="Skip this command"
            >
              Skip
            </button>
            <button
              className={styles.commandAlwaysRunBtn}
              onClick={onAlwaysRun}
              title="Always run commands like this"
            >
              Always Run
            </button>
            <button
              className={styles.commandRunBtn}
              onClick={onRun}
              title="Run this command"
            >
              Run
            </button>
          </div>
        </div>
      )}

      {(status === 'running' || status === 'completed' || status === 'failed') && output && (
        <div className={styles.commandOutput}>
          <div
            className={styles.commandOutputHeader}
            onClick={() => setOutputExpanded(!outputExpanded)}
          >
            {outputExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Output</span>
            {status === 'completed' && exitCode !== undefined && (
              <span className={styles.commandExitCode}>
                Exit code: {exitCode}
              </span>
            )}
          </div>
          {outputExpanded && (
            <pre className={styles.commandOutputContent}>{output}</pre>
          )}
        </div>
      )}

      {status === 'failed' && error && (
        <div className={styles.commandError}>
          <AlertTriangle size={12} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// Component to warn about code blocks being filtered in Plan Mode
function CodeBlockWarning({ count, onSwitchToAgent }: { count: number; onSwitchToAgent: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={styles.codeBlockWarning}>
      <div className={styles.warningHeader}>
        <div className={styles.warningIcon}>⚠️</div>
        <div className={styles.warningTitle}>Code blocks detected in Plan Mode</div>
        <button 
          className={styles.warningDismiss}
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.warningContent}>
        <p className={styles.warningText}>
          {count} code {count === 1 ? 'block was' : 'blocks were'} removed. Plan Mode is for strategic planning only—no code implementation.
        </p>
        <p className={styles.warningText}>
          Switch to <strong>Agent Mode</strong> to see actual code, file operations, and implementation details.
        </p>
        <div className={styles.warningActions}>
          <button 
            className={styles.warningPrimaryBtn}
            onClick={onSwitchToAgent}
          >
            <TerminalIcon size={14} />
            Switch to Agent Mode
          </button>
          <button 
            className={styles.warningSecondaryBtn}
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// Component to suggest converting actionable tasks to todos and switching to Agent mode
function ActionableTasksSuggestion({ tasks, onSwitchToAgent }: { tasks: string[]; onSwitchToAgent: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={styles.actionableSuggestion}>
      <div className={styles.suggestionHeader}>
        <div className={styles.suggestionIcon}>💡</div>
        <div className={styles.suggestionTitle}>Ready to implement these steps?</div>
        <button 
          className={styles.suggestionDismiss}
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.suggestionContent}>
        <p className={styles.suggestionText}>
          I've identified {tasks.length} actionable tasks. Switch to <strong>Agent Mode</strong> to start development with interactive file operations and code generation.
        </p>
        <div className={styles.suggestionTasks}>
          {tasks.map((task, idx) => (
            <div key={idx} className={styles.suggestionTask}>
              <span className={styles.suggestionTaskNumber}>{idx + 1}</span>
              <span className={styles.suggestionTaskText}>{task}</span>
            </div>
          ))}
        </div>
        <div className={styles.suggestionActions}>
          <button 
            className={styles.suggestionPrimaryBtn}
            onClick={onSwitchToAgent}
          >
            <TerminalIcon size={14} />
            Switch to Agent Mode
          </button>
          <button 
            className={styles.suggestionSecondaryBtn}
            onClick={() => setDismissed(true)}
          >
            Stay in Plan Mode
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Switch to Agent Mode Prompt (shown when AI suggests switching to Agent mode) ─────
function SwitchToAgentPrompt({
  onSwitchToAgent
}: {
  onSwitchToAgent: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={styles.switchToAgentPrompt}>
      <div className={styles.suggestionHeader}>
        <div className={styles.suggestionIcon}>⚡</div>
        <div className={styles.suggestionTitle}>Switch to Agent Mode for Implementation</div>
        <button
          className={styles.suggestionDismiss}
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.suggestionContent}>
        <p className={styles.suggestionText}>
          The AI recommends switching to <strong>Agent Mode</strong> to implement these changes.
          Agent Mode can create, edit, and delete files in your workspace.
        </p>
        <div className={styles.suggestionActions}>
          <button
            className={styles.suggestionPrimaryBtn}
            onClick={onSwitchToAgent}
          >
            <TerminalIcon size={14} />
            Switch to Agent Mode
          </button>
          <button
            className={styles.suggestionSecondaryBtn}
            onClick={() => setDismissed(true)}
          >
            Stay in Current Mode
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Implementation Offer Prompt (shown in Chat mode when AI offers to implement) ─────
function ImplementationOfferPrompt({
  onSwitchToAgent
}: {
  onSwitchToAgent: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={styles.implementationOffer}>
      <div className={styles.suggestionHeader}>
        <div className={styles.suggestionIcon}>🚀</div>
        <div className={styles.suggestionTitle}>Ready to implement?</div>
        <button
          className={styles.suggestionDismiss}
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.suggestionContent}>
        <p className={styles.suggestionText}>
          Switch to <strong>Agent Mode</strong> to let the AI create and edit files in your workspace.
        </p>
        <div className={styles.suggestionActions}>
          <button
            className={styles.suggestionPrimaryBtn}
            onClick={onSwitchToAgent}
          >
            <TerminalIcon size={14} />
            Switch to Agent Mode
          </button>
          <button 
            className={styles.suggestionSecondaryBtn}
            onClick={() => setDismissed(true)}
          >
            Stay in Chat
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Diff Parser & Viewer Components ─────────────────────────────────────────

interface ParsedFileDiff {
  filePath: string;
  oldPath: string;
  newPath: string;
  rawContent: string;
  additions: number;
  deletions: number;
  isTruncated: boolean;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

interface ParsedDiffResult {
  files: ParsedFileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  contextInfo: string | null;
}

function parseDiffIntoFiles(text: string): ParsedDiffResult {
  const files: ParsedFileDiff[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let contextInfo: string | null = null;

  // Extract context info (e.g., "=== Pull Request ===" section or "=== Commit ===" section)
  const contextMatch = text.match(/^=== (Pull Request|Commit|Commit Range|Changes) ===\n([\s\S]*?)(?=\n===|\n--- BEGIN DIFF|$)/m);
  if (contextMatch) {
    contextInfo = contextMatch[2].trim();
  }

  // Split by file boundaries: either "--- BEGIN DIFF" markers or "diff --git" lines
  const fileChunks: { path: string | null; content: string }[] = [];
  
  // First, try to split by BEGIN DIFF markers (our custom format)
  const beginDiffRegex = /--- BEGIN DIFF(?: \(([^)]+)\))? ---/g;
  const endDiffRegex = /--- END DIFF(?: \([^)]+\))? ---/g;
  
  let hasBeginDiffMarkers = beginDiffRegex.test(text);
  beginDiffRegex.lastIndex = 0;
  
  if (hasBeginDiffMarkers) {
    let match;
    let lastEnd = 0;
    const markers: { start: number; end: number; path: string | null }[] = [];
    
    while ((match = beginDiffRegex.exec(text)) !== null) {
      const startIdx = match.index;
      const path = match[1] || null;
      const contentStart = startIdx + match[0].length;
      
      // Find corresponding END DIFF
      endDiffRegex.lastIndex = contentStart;
      const endMatch = endDiffRegex.exec(text);
      const contentEnd = endMatch ? endMatch.index : text.length;
      
      markers.push({ start: contentStart, end: contentEnd, path });
      lastEnd = endMatch ? endMatch.index + endMatch[0].length : text.length;
    }
    
    markers.forEach(({ start, end, path }) => {
      const content = text.slice(start, end).trim();
      if (content) {
        fileChunks.push({ path, content });
      }
    });
  } else {
    // Fallback: split by "diff --git" lines
    const diffGitRegex = /^diff --git a\/(.+?) b\/(.+)$/gm;
    let match;
    const boundaries: { index: number; path: string }[] = [];
    
    while ((match = diffGitRegex.exec(text)) !== null) {
      boundaries.push({ index: match.index, path: match[2] });
    }
    
    if (boundaries.length === 0 && text.trim()) {
      // No structured diff, treat whole text as single chunk
      fileChunks.push({ path: null, content: text });
    } else {
      boundaries.forEach((boundary, i) => {
        const start = boundary.index;
        const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
        const content = text.slice(start, end).trim();
        if (content) {
          fileChunks.push({ path: boundary.path, content });
        }
      });
    }
  }

  // Parse each chunk into a ParsedFileDiff
  fileChunks.forEach(({ path, content }) => {
    // Try to extract path from content if not provided
    let filePath = path || 'unknown';
    let oldPath = filePath;
    let newPath = filePath;
    
    const gitMatch = content.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (gitMatch) {
      oldPath = gitMatch[1];
      newPath = gitMatch[2];
      filePath = newPath;
    }
    
    // Check for new/deleted file markers
    const isNewFile = /^new file mode/m.test(content);
    const isDeletedFile = /^deleted file mode/m.test(content);
    
    // Count additions and deletions (only real +/- lines, not headers)
    let additions = 0;
    let deletions = 0;
    const lines = content.split('\n');
    lines.forEach((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    });
    
    // Check for truncation
    const isTruncated = content.includes('...[truncated]');
    
    files.push({
      filePath,
      oldPath,
      newPath,
      rawContent: content,
      additions,
      deletions,
      isTruncated,
      isNewFile,
      isDeletedFile,
    });
    
    totalAdditions += additions;
    totalDeletions += deletions;
  });

  return { files, totalAdditions, totalDeletions, contextInfo };
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    py: '🐍', rs: '🦀', go: '🔷', java: '☕',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄', css: '🎨', scss: '🎨',
    html: '🌐', vue: '💚', svelte: '🧡',
  };
  return iconMap[ext] || '📄';
}

function DiffFileSection({ 
  file, 
  defaultExpanded,
  onToggle,
}: { 
  file: ParsedFileDiff;
  defaultExpanded: boolean;
  onToggle?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggleExpanded = () => {
    setExpanded((v) => !v);
    onToggle?.();
  };

  const renderDiffLines = (content: string) => {
    const lines = content.split('\n');
    return (
      <div className={styles.diffFileLines}>
        {lines.map((line, idx) => {
          const isHunk = line.startsWith('@@');
          const isHeader =
            line.startsWith('diff --git ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('index ') ||
            line.startsWith('new file mode ') ||
            line.startsWith('deleted file mode ');
          const isAdd = line.startsWith('+') && !line.startsWith('+++');
          const isDel = line.startsWith('-') && !line.startsWith('---');

          const lineClass = isHunk
            ? styles.diffLineHunk
            : isHeader
            ? styles.diffLineHeader
            : isAdd
            ? styles.diffLineAdd
            : isDel
            ? styles.diffLineDel
            : styles.diffLineContext;

          return (
            <div key={idx} className={`${styles.diffFileLine} ${lineClass}`}>
              <span className={styles.diffLineNumber}>{idx + 1}</span>
              <span className={styles.diffLineContent}>{line || ' '}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.diffFileCard}>
      <button className={styles.diffFileHeader} onClick={toggleExpanded} type="button">
        <span className={styles.diffFileChevron}>{expanded ? '▼' : '▶'}</span>
        <span className={styles.diffFileIcon}>{getFileIcon(file.filePath)}</span>
        <span className={styles.diffFilePath}>{file.filePath}</span>
        {file.isNewFile && <span className={styles.diffFileBadgeNew}>new</span>}
        {file.isDeletedFile && <span className={styles.diffFileBadgeDeleted}>deleted</span>}
        {file.isTruncated && <span className={styles.diffFileBadgeTruncated}>truncated</span>}
        <span className={styles.diffFileStats}>
          {file.additions > 0 && <span className={styles.diffStatsAdd}>+{file.additions}</span>}
          {file.deletions > 0 && <span className={styles.diffStatsDel}>-{file.deletions}</span>}
        </span>
      </button>
      {expanded && (
        <div className={styles.diffFileContent}>
          {renderDiffLines(file.rawContent)}
        </div>
      )}
    </div>
  );
}

function DiffViewer({ text, title }: { text: string; title?: string }) {
  const parsed = useMemo(() => parseDiffIntoFiles(text), [text]);
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandKey, setExpandKey] = useState(0);

  const handleExpandAll = () => {
    setAllExpanded(true);
    setExpandKey((k) => k + 1);
  };

  const handleCollapseAll = () => {
    setAllExpanded(false);
    setExpandKey((k) => k + 1);
  };

  const copyAll = () => {
    navigator.clipboard.writeText(text);
  };

  if (parsed.files.length === 0) {
    return (
      <div className={styles.diffViewer}>
        <div className={styles.diffViewerHeader}>
          <span className={styles.diffViewerTitle}>{title || 'Review Input'}</span>
          <span className={styles.diffViewerMeta}>No files</span>
        </div>
        <pre className={styles.diffViewerEmpty}>{text}</pre>
      </div>
    );
  }

  return (
    <div className={styles.diffViewer}>
      <div className={styles.diffViewerHeader}>
        <div className={styles.diffViewerHeaderLeft}>
          <span className={styles.diffViewerTitle}>{title || 'Review Input'}</span>
          <span className={styles.diffViewerMeta}>
            {parsed.files.length} {parsed.files.length === 1 ? 'file' : 'files'}
          </span>
          <span className={styles.diffViewerStats}>
            {parsed.totalAdditions > 0 && (
              <span className={styles.diffStatsAdd}>+{parsed.totalAdditions}</span>
            )}
            {parsed.totalDeletions > 0 && (
              <span className={styles.diffStatsDel}>-{parsed.totalDeletions}</span>
            )}
          </span>
        </div>
        <div className={styles.diffViewerActions}>
          <button 
            className={styles.diffViewerBtn} 
            onClick={handleExpandAll}
            type="button"
            title="Expand all files"
          >
            Expand All
          </button>
          <button 
            className={styles.diffViewerBtn} 
            onClick={handleCollapseAll}
            type="button"
            title="Collapse all files"
          >
            Collapse All
          </button>
          <button 
            className={styles.diffViewerBtn} 
            onClick={copyAll}
            type="button"
            title="Copy all"
          >
            Copy
          </button>
        </div>
      </div>
      {parsed.contextInfo && (
        <div className={styles.diffViewerContext}>
          {parsed.contextInfo.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      <div className={styles.diffViewerFiles}>
        {parsed.files.map((file, idx) => (
          <DiffFileSection
            key={`${file.filePath}-${idx}-${expandKey}`}
            file={file}
            defaultExpanded={allExpanded}
          />
        ))}
      </div>
    </div>
  );
}

type PlainTextKind = 'text' | 'diff';

function MessageBubble({ message, onOperationsChange, renderAsPlainText, plainTextTitle, plainTextDefaultExpanded, plainTextKind, onImagePreview }: {
  message: AIMessage;
  onOperationsChange?: (ops: FileOperation[]) => void;
  renderAsPlainText?: boolean;
  plainTextTitle?: string;
  plainTextDefaultExpanded?: boolean;
  plainTextKind?: PlainTextKind;
  onImagePreview?: (src: string, name: string) => void;
}) {
  const isUser = message.role === 'user';
  const [pendingOps, setPendingOps] = useState<FileOperation[]>([]);
  const [planComponents, setPlanComponents] = useState<{ plans: Plan[]; checklists: Checklist[]; decisions: Decision[] }>({ plans: [], checklists: [], decisions: [] });
  const [actionableTasks, setActionableTasks] = useState<string[]>([]);
  const [codeBlockTasks, setCodeBlockTasks] = useState<string[]>([]);
  const [hasImplementationOffer, setHasImplementationOffer] = useState(false);
  const [hasSwitchToAgentSuggestion, setHasSwitchToAgentSuggestion] = useState(false);
  const [localQuestions, setLocalQuestions] = useState<PendingQuestion[]>([]);
  const [workspaceOps, setWorkspaceOps] = useState<WorkspaceOperation[]>([]);
  const [workspaceCreating, setWorkspaceCreating] = useState<string | null>(null);
  const [workspaceCreated, setWorkspaceCreated] = useState<string | null>(null);
  const [localCommands, setLocalCommands] = useState<{ parsed: ParsedCommand; operation: CommandOperation }[]>([]);
  const { currentWorkspace, createAndOpenWorkspace } = useWorkspaceStore();
  const { openFile } = useEditorStore();
  const { 
    agentMode, 
    setAgentMode, 
    sendMessage, 
    setAgentTasks, 
    queuePrompt,
    pendingQuestions,
    setPendingQuestions,
    answerQuestion,
    setQuestionBlockingStream,
    activeConversation,
    pendingCommands,
    setPendingCommands,
    addPendingCommand,
    updateCommandStatus,
    skipCommand,
    runCommand,
    addToCommandAllowlist,
    isCommandAllowed,
  } = useAIStore();

  const removeChecklistSections = useCallback((content: string, checklists: Checklist[]): string => {
    if (checklists.length === 0) return content;
    const titles = checklists
      .map((c) => c.title.trim().toLowerCase())
      .filter((t) => t.length > 0);
    if (titles.length === 0) return content;

    const lines = content.split('\n');
    const result: string[] = [];
    let skipping = false;

    const isHeading = (line: string) => /^#{1,6}\s+/.test(line.trim());
    const isChecklistItem = (line: string) =>
      /^[\s]*[-*+]\s+/.test(line) ||
      /^[\s]*\d+\.\s+/.test(line) ||
      /^[\s]*\[[ xX]\]\s+/.test(line) ||
      /^[\s]*[-*+]\s*\[[ xX>-]\]\s+/.test(line);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      const matchesTitle = titles.some((title) => lower.includes(title));

      if (!skipping && matchesTitle && (isHeading(trimmed) || lower === titles.find((t) => lower === t) || lower.includes('review fix plan'))) {
        skipping = true;
        continue;
      }

      if (skipping) {
        if (trimmed.length === 0 || isChecklistItem(line)) {
          continue;
        }
        if (isHeading(trimmed) && !matchesTitle) {
          skipping = false;
          result.push(line);
          continue;
        }
        if (!isChecklistItem(line)) {
          skipping = false;
          result.push(line);
          continue;
        }
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
  };

  // Handle workspace creation
  const handleCreateWorkspace = useCallback(async (operation: WorkspaceOperation) => {
    if (operation.invalidReason || !createAndOpenWorkspace) return;
    
    setWorkspaceCreating(operation.path);
    try {
      await createAndOpenWorkspace(operation.path, operation.name);
      setWorkspaceCreated(operation.path);
      setWorkspaceCreating(null);
      
      // Send a confirmation message to continue the conversation
      sendMessage(`Workspace "${operation.name}" has been created at ${operation.path}. Please proceed with setting up the project.`);
    } catch (error) {
      console.error('Failed to create workspace:', error);
      setWorkspaceCreating(null);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Failed to create workspace: ${error}`, type: 'error' }
      }));
    }
  }, [createAndOpenWorkspace, sendMessage]);

  const handleCancelWorkspace = useCallback(() => {
    // Just dismiss the workspace creation block
    setWorkspaceOps([]);
    sendMessage('I decided not to create this workspace. Please suggest an alternative approach or let me create the project manually.');
  }, [sendMessage]);

  // Handle command actions
  const handleSkipCommand = useCallback((commandId: string) => {
    skipCommand(commandId);
    setLocalCommands(prev => prev.map(c => 
      c.operation.id === commandId 
        ? { ...c, operation: { ...c.operation, status: 'skipped' as CommandStatus } }
        : c
    ));
  }, [skipCommand]);

  const handleAlwaysRunCommand = useCallback((commandId: string, command: string) => {
    // Add to allowlist (pattern is the first part of the command up to first space or first 20 chars)
    const pattern = command.split(' ')[0];
    addToCommandAllowlist(pattern);
    
    // Then run the command
    runCommand(commandId);
    setLocalCommands(prev => prev.map(c => 
      c.operation.id === commandId 
        ? { ...c, operation: { ...c.operation, status: 'running' as CommandStatus } }
        : c
    ));
  }, [addToCommandAllowlist, runCommand]);

  const handleRunCommand = useCallback((commandId: string) => {
    runCommand(commandId);
    setLocalCommands(prev => prev.map(c => 
      c.operation.id === commandId 
        ? { ...c, operation: { ...c.operation, status: 'running' as CommandStatus } }
        : c
    ));
  }, [runCommand]);

  // Handle answering an interactive question
  const handleAnswerQuestion = useCallback((questionId: string, optionId: string, optionLabel: string) => {
    // Update local state
    setLocalQuestions(prev => prev.map(q => 
      q.id === questionId 
        ? { ...q, answered: true, selectedOptionId: optionId, selectedOptionLabel: optionLabel }
        : q
    ));
    
    // Update store state
    answerQuestion(questionId, optionId, optionLabel);
    
    // Check if all questions are now answered
    const updatedQuestions = localQuestions.map(q => 
      q.id === questionId ? { ...q, answered: true } : q
    );
    const allAnswered = updatedQuestions.every(q => q.answered);
    
    if (allAnswered) {
      // Build the answer context and send as a follow-up message
      const answersText = updatedQuestions.map(q => {
        const selected = q.id === questionId 
          ? optionLabel 
          : q.selectedOptionLabel || '';
        return `**${q.title || 'Question'}:** ${selected}`;
      }).join('\n');
      
      // Send the answers as user response to continue the conversation
      sendMessage(`Based on my selections:\n\n${answersText}\n\nPlease proceed with the implementation.`);
      setQuestionBlockingStream(false);
    }
  }, [localQuestions, answerQuestion, sendMessage, setQuestionBlockingStream]);

  // Switch to agent mode and auto-send tasks one-by-one so progress can be tracked
  const handleImplementInAgent = useCallback((tasks: string[]) => {
    if (tasks.length === 0) return;
    setAgentMode('agent');
    setAgentTasks(tasks);
    // Send first task immediately; queue the rest so each gets its own focused response
    sendMessage(
      `Implement task 1 of ${tasks.length}: ${tasks[0]}\n\nCreate or edit files as needed. Reply when done.`
    );
    tasks.slice(1).forEach((task, i) => {
      queuePrompt(
        `Implement task ${i + 2} of ${tasks.length}: ${task}\n\nCreate or edit files as needed. Reply when done.`
      );
    });
  }, [setAgentMode, sendMessage, setAgentTasks, queuePrompt]);

  // Listen for file operations cleared event (from Undo All / Dismiss)
  useEffect(() => {
    const handleFileOpsCleared = () => {
      setPendingOps([]);
      if (onOperationsChange) {
        onOperationsChange([]);
      }
    };
    window.addEventListener('file-ops-cleared', handleFileOpsCleared);
    return () => window.removeEventListener('file-ops-cleared', handleFileOpsCleared);
  }, [onOperationsChange]);

  // Parse file operations and plan components from assistant messages
  useEffect(() => {
    if (!isUser && message.content) {
      // Only parse file operations in Agent mode - skip for Chat and Plan modes
      if (agentMode === 'agent') {
        const ops = parseFileOperations(message.content, currentWorkspace?.rootPath);
        setPendingOps(ops);
        // Notify parent of operations
        if (onOperationsChange) {
          onOperationsChange(ops);
        }
      } else {
        setPendingOps([]); // Clear any file operations in non-agent modes
        if (onOperationsChange) {
          onOperationsChange([]);
        }
      }
      
      const planComps = parsePlanComponents(message.content);
      setPlanComponents(planComps);
      
      // Debug logging
      if (planComps.plans.length > 0 || planComps.checklists.length > 0 || planComps.decisions.length > 0) {
        console.log('Parsed plan components:', {
          plans: planComps.plans.length,
          checklists: planComps.checklists.length,
          decisions: planComps.decisions.length
        });
      }
      
      // Parse interactive questions
      const questions = parseQuestions(message.content);
      if (questions.length > 0) {
        // Merge with existing answered state from store
        const storeQuestions = pendingQuestions.filter(q => q.messageId === message.id);
        const mergedQuestions = questions.map(q => {
          const existing = storeQuestions.find(sq => sq.id === q.id);
          if (existing) {
            return { ...q, answered: existing.answered, selectedOptionId: existing.selectedOptionId, selectedOptionLabel: existing.selectedOptionLabel };
          }
          return q;
        });
        setLocalQuestions(mergedQuestions);
        
        // If there are unanswered questions, update the store
        const unansweredQuestions = mergedQuestions.filter(q => !q.answered);
        if (unansweredQuestions.length > 0 && activeConversation) {
          const storeFormatQuestions: StorePendingQuestion[] = mergedQuestions.map(q => ({
            ...q,
            messageId: message.id,
            conversationId: activeConversation.id,
          }));
          setPendingQuestions(storeFormatQuestions);
          setQuestionBlockingStream(true);
        }
      } else {
        setLocalQuestions([]);
      }
      
      // Parse workspace creation operations
      const wsOps = parseWorkspaceOperations(message.content);
      setWorkspaceOps(wsOps);
      
      // Parse command operations
      const parsedCmds = parseCommandOperations(message.content);
      if (parsedCmds.length > 0 && activeConversation) {
        // Check existing pending commands from store
        const existingCmds = pendingCommands.filter(c => c.messageId === message.id);
        
        // Create or update command operations
        const commandsWithOps = parsedCmds.map((parsed, idx) => {
          const existing = existingCmds[idx];
          if (existing) {
            return { parsed, operation: existing };
          }
          
          // Check if command is in allowlist and auto-run if so
          const shouldAutoRun = isCommandAllowed(parsed.command);
          
          const newOp: CommandOperation = {
            id: `cmd-${message.id}-${idx}-${Date.now()}`,
            command: parsed.command,
            description: parsed.description,
            sandbox: parsed.sandbox,
            status: shouldAutoRun ? 'approved' : 'pending',
            messageId: message.id,
            conversationId: activeConversation.id,
          };
          
          return { parsed, operation: newOp };
        });
        
        setLocalCommands(commandsWithOps);
        
        // Update store with new pending commands
        const newPendingCmds = commandsWithOps
          .filter(c => c.operation.status === 'pending' || c.operation.status === 'approved')
          .map(c => c.operation);
        if (newPendingCmds.length > 0) {
          setPendingCommands([...pendingCommands.filter(c => c.messageId !== message.id), ...newPendingCmds]);
        }
        
        // Auto-run commands that are in the allowlist
        commandsWithOps.forEach(({ operation }) => {
          if (operation.status === 'approved') {
            runCommand(operation.id);
          }
        });
      } else {
        setLocalCommands([]);
      }
      
      // Detect actionable tasks and code blocks in Plan Mode
      if (agentMode === 'plan') {
        const tasks = detectActionableTasks(message.content);
        setActionableTasks(tasks);

        // Only count code blocks that would actually be hidden (large implementation blocks, not review context)
        const codeBlockRegex = /(```(?!mermaid)(\w*)[^\n]*\n[\s\S]*?```)/g;
        const detectedCodeBlocks: string[] = [];
        let lastIndex = 0;
        let match;
        
        while ((match = codeBlockRegex.exec(message.content)) !== null) {
          const codeBlock = match[1];
          const lang = match[2] || 'code';
          const beforeBlock = message.content.substring(lastIndex, match.index);
          const contextBefore = beforeBlock.slice(-500).toLowerCase();
          
          // Check if this code block is in a review/fix context (same logic as getCleanedContent)
          const isReviewContext = 
            /\b(critical|high|medium|low|info|test)\b.*?(\n|—|:)/i.test(contextBefore) ||
            /\b(fix|change|update|replace|modify|add|remove|should be|should use|instead of|suggested|recommendation|example|correct|incorrect|current|before|after)\b/i.test(contextBefore.slice(-200)) ||
            /\b(review|finding|issue|problem|bug|error|suggestion|improvement)\b/i.test(contextBefore.slice(-300)) ||
            /`[^`]+\.(ts|tsx|js|jsx|py|rs|go|java|cpp|c|rb|php|vue|svelte)`/.test(contextBefore.slice(-150)) ||
            /\b(compare|diff|original|modified|old|new|wrong|right|better|worse)\b/i.test(contextBefore.slice(-150));
          
          const codeLines = codeBlock.split('\n').length;
          const isSmallBlock = codeLines <= 20;
          
          // Only add to detected blocks if it would be hidden
          if (!isReviewContext && !isSmallBlock) {
            const codeContent = codeBlock.replace(/```\w*\n/, '').replace(/\n?```$/, '').trim();
            const preview = codeContent.split('\n').slice(0, 3).join('; ').substring(0, 80);
            detectedCodeBlocks.push(`Implement ${lang}: ${preview}${codeContent.length > 80 ? '...' : ''}`);
          }
          
          lastIndex = match.index + match[0].length;
        }
        setCodeBlockTasks(detectedCodeBlocks);
        setHasImplementationOffer(false);
      } else if (agentMode === 'chat') {
        // Detect when AI offers to implement in Chat mode or generates file operation blocks
        const implementationOfferPatterns = [
          /would you like me to (?:create|implement|write|build|generate|make|add)/i,
          /shall i (?:create|implement|write|build|generate|make|add)/i,
          /i can (?:create|implement|write|build|generate|make|add) (?:this|that|the|it)/i,
          /do you want me to (?:create|implement|write|build|generate|make|add)/i,
          /ready to (?:create|implement|write|build|generate|make|add)/i,
          /let me know if you'?d like me to (?:create|implement|write|build|generate|make|add)/i,
          /want me to (?:go ahead|proceed) (?:and|with) (?:creat|implement|writ|build)/i,
          /\?[\s\S]{0,50}(?:create|implement|write|build|add) (?:this|that|the|it)/i,
        ];
        // Also detect file operation XML blocks that shouldn't be in Chat mode
        const fileOperationPatterns = [
          /<create_file\s+path=/i,
          /<edit_file\s+path=/i,
          /<delete_file\s+path=/i,
          /<file_operation\s+/i,
        ];
        const hasOffer = implementationOfferPatterns.some(p => p.test(message.content));
        const hasFileOps = fileOperationPatterns.some(p => p.test(message.content));
        setHasImplementationOffer(hasOffer || hasFileOps);
        setActionableTasks([]);
        setCodeBlockTasks([]);
      } else {
        setActionableTasks([]);
        setCodeBlockTasks([]);
        setHasImplementationOffer(false);
      }
      
      // Detect when AI suggests switching to Agent mode (applies to all non-agent modes)
      if (agentMode !== 'agent') {
        const switchToAgentPatterns = [
          /switch(?:ing)?\s+to\s+agent\s+mode/i,
          /please\s+switch\s+to\s+agent\s+mode/i,
          /use\s+(?:the\s+)?agent\s+mode/i,
          /to\s+implement\s+(?:these\s+)?changes?,?\s+(?:please\s+)?switch/i,
          /in\s+agent\s+mode,?\s+(?:i\s+can|you\s+can|the\s+ai\s+can)/i,
          /agent\s+mode\s+(?:is\s+required|will\s+allow|enables?|can)/i,
          /(?:need|require)s?\s+agent\s+mode/i,
          /mode\s+selector.*agent/i,
        ];
        const hasSwitchSuggestion = switchToAgentPatterns.some(p => p.test(message.content));
        setHasSwitchToAgentSuggestion(hasSwitchSuggestion);
      } else {
        setHasSwitchToAgentSuggestion(false);
      }
    }
  }, [message.content, isUser, agentMode]);
  // Note: onOperationsChange is intentionally omitted from deps to prevent infinite loops

  // Remove plan XML tags from content for markdown rendering
  const getCleanedContent = (content: string): string => {
    let cleaned = content;
    
    // Remove "Thinking:" sections that some models output
    // Match "Thinking:" followed by text until a double newline or end of string
    cleaned = cleaned.replace(/^Thinking:[\s\S]*?(?=\n\n|$)/i, '');
    // Also remove inline thinking patterns like "Thinking: ... I should"
    cleaned = cleaned.replace(/Thinking:\s*[^.]*\.\s*/gi, '');
    // Remove any remaining "Thinking:" at start of lines
    cleaned = cleaned.replace(/^\s*Thinking:\s*/gim, '');
    
    // In plan mode, selectively hide code blocks
    // KEEP code blocks that are part of code reviews (after severity markers, within "fix" context, etc.)
    // HIDE large implementation code blocks that aren't review-related
    if (agentMode === 'plan') {
      // Split content by code blocks and process contextually
      const codeBlockRegex = /(```(?!mermaid)(\w*)[^\n]*\n[\s\S]*?```)/g;
      let lastIndex = 0;
      let result = '';
      let match;
      
      while ((match = codeBlockRegex.exec(cleaned)) !== null) {
        const beforeBlock = cleaned.substring(lastIndex, match.index);
        const codeBlock = match[1];
        
        // Check if this code block is in a review/fix context
        // Look at the 500 characters before the code block for context
        const contextBefore = beforeBlock.slice(-500).toLowerCase();
        
        const isReviewContext = 
          // Severity indicators
          /\b(critical|high|medium|low|info|test)\b.*?(\n|—|:)/i.test(contextBefore) ||
          // Fix/change/update language
          /\b(fix|change|update|replace|modify|add|remove|should be|should use|instead of|suggested|recommendation|example|correct|incorrect|current|before|after)\b/i.test(contextBefore.slice(-200)) ||
          // Review headers
          /\b(review|finding|issue|problem|bug|error|suggestion|improvement)\b/i.test(contextBefore.slice(-300)) ||
          // File references (usually precede code examples)
          /`[^`]+\.(ts|tsx|js|jsx|py|rs|go|java|cpp|c|rb|php|vue|svelte)`/.test(contextBefore.slice(-150)) ||
          // Code comparison markers
          /\b(compare|diff|original|modified|old|new|wrong|right|better|worse)\b/i.test(contextBefore.slice(-150));
        
        // Also check if it's a small code block (likely an example, not implementation)
        const codeLines = codeBlock.split('\n').length;
        const isSmallBlock = codeLines <= 20;
        
        result += beforeBlock;
        
        if (isReviewContext || isSmallBlock) {
          // Keep the code block for review purposes
          result += codeBlock;
        } else {
          // Hide large implementation blocks
          result += `\n\n> 📋 *Code hidden in Plan Mode — switch to Agent Mode to see implementation*\n\n`;
        }
        
        lastIndex = match.index + match[0].length;
      }
      
      result += cleaned.substring(lastIndex);
      cleaned = result;
    }
    
    const langFromPath = (p: string): string => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      const m: Record<string, string> = {
        'ts': 'typescript', 'tsx': 'typescript', 'js': 'javascript', 'jsx': 'javascript',
        'css': 'css', 'html': 'html', 'json': 'json', 'md': 'markdown',
        'py': 'python', 'rs': 'rust', 'go': 'go', 'java': 'java',
        'sh': 'bash', 'toml': 'toml', 'yaml': 'yaml', 'yml': 'yaml',
      };
      return m[ext] || ext;
    };

    // ── Step 1: Replace COMPLETE file-op tags with a labelled code block ──────
    // create_file (with closing tag)
    cleaned = cleaned.replace(
      /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/gi,
      (_, path, code) =>
        `\n\n**Creating \`${path}\`**\n\n\`\`\`${langFromPath(path)}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`
    );
    // edit_file (with closing tag) — show new content if available, else show whole block
    cleaned = cleaned.replace(
      /<edit_file\s+([^>]*)>([\s\S]*?)<\/edit_file>/gi,
      (_, attrs, body) => {
        const pathMatch = attrs.match(/path="([^"]+)"/i);
        const path = pathMatch ? pathMatch[1] : 'file';
        const newMatch = body.match(/<new_content>([\s\S]*?)<\/new_content>/i);
        const code = newMatch ? newMatch[1] : body;
        return `\n\n**Editing \`${path}\`**\n\n\`\`\`${langFromPath(path)}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`;
      }
    );
    // delete_file
    cleaned = cleaned.replace(
      /<delete_file\s+path="([^"]+)"\s*\/>/gi,
      (_, path) => `\n\n~~Deleting \`${path}\`~~\n\n`
    );

    // ── Step 2: Handle INCOMPLETE (streaming) file-op tags ────────────────────
    // Process each incomplete create_file individually by repeatedly replacing
    // the first open tag up to (but not including) the next open tag or end of string.
    let safetyLimit = 20;
    while (safetyLimit-- > 0) {
      const incompleteCreate = /<create_file\s+path="([^"]+)">([\s\S]*?)(?=<create_file|<edit_file|<delete_file|$)/i;
      const m2 = incompleteCreate.exec(cleaned);
      if (!m2) break;
      const path = m2[1];
      const code = m2[2];
      const replacement = `\n\n**Creating \`${path}\`** *(writing...)*\n\n\`\`\`${langFromPath(path)}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`;
      cleaned = cleaned.slice(0, m2.index) + replacement + cleaned.slice(m2.index + m2[0].length);
    }
    // Same for incomplete edit_file
    safetyLimit = 20;
    while (safetyLimit-- > 0) {
      const incompleteEdit = /<edit_file\s+([^>]*)>([\s\S]*?)(?=<create_file|<edit_file|<delete_file|$)/i;
      const m3 = incompleteEdit.exec(cleaned);
      if (!m3) break;
      const attrs = m3[1];
      const body = m3[2];
      const pathMatch = attrs.match(/path="([^"]+)"/i);
      const path = pathMatch ? pathMatch[1] : 'file';
      const newMatch = body.match(/<new_content>([\s\S]*?)(?:<\/new_content>|$)/i);
      const code = newMatch ? newMatch[1] : body;
      const replacement = `\n\n**Editing \`${path}\`** *(writing...)*\n\n\`\`\`${langFromPath(path)}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`;
      cleaned = cleaned.slice(0, m3.index) + replacement + cleaned.slice(m3.index + m3[0].length);
    }
    
    // Remove <plan>...</plan> blocks (entire block) - any attributes
    cleaned = cleaned.replace(/<plan(?:\s[^>]*)?>([\s\S]*?)<\/plan>/gi, '');
    
    // Remove <checklist>...</checklist> blocks (any attributes)
    cleaned = cleaned.replace(/<checklist(?:\s[^>]*)?>([\s\S]*?)<\/checklist>/gi, '');
    
    // Remove <decision>...</decision> blocks (any attributes)
    cleaned = cleaned.replace(/<decision(?:\s[^>]*)?>([\s\S]*?)<\/decision>/gi, '');
    
    // Remove individual plan component tags (in case they appear outside of plan blocks)
    cleaned = cleaned.replace(/<overview>[\s\S]*?<\/overview>/gi, '');
    cleaned = cleaned.replace(/<approach(?:\s+[^>]*)?>[\s\S]*?<\/approach>/gi, '');
    cleaned = cleaned.replace(/<pros>[\s\S]*?<\/pros>/gi, '');
    cleaned = cleaned.replace(/<cons>[\s\S]*?<\/cons>/gi, '');
    cleaned = cleaned.replace(/<tasks>[\s\S]*?<\/tasks>/gi, '');
    cleaned = cleaned.replace(/<architecture>[\s\S]*?<\/architecture>/gi, '');
    cleaned = cleaned.replace(/<considerations>[\s\S]*?<\/considerations>/gi, '');
    cleaned = cleaned.replace(/<old_content>[\s\S]*?<\/old_content>/gi, '');
    cleaned = cleaned.replace(/<new_content>[\s\S]*?<\/new_content>/gi, '');
    
    // Handle read_file tags - convert to readable format
    cleaned = cleaned.replace(
      /<read_file\s+path="([^"]+)"\s*\/?>/gi,
      (_, path) => `\n\n*Reading \`${path}\`*\n\n`
    );
    // Handle malformed read_file tags (missing quotes, etc.)
    cleaned = cleaned.replace(
      /<read_file\s+path[^>]*\/?>/gi,
      ''
    );
    
    // Handle other common tool/function call XML patterns
    cleaned = cleaned.replace(/<search_files[^>]*>[\s\S]*?<\/search_files>/gi, '');
    cleaned = cleaned.replace(/<search_files[^>]*\/?>/gi, '');
    cleaned = cleaned.replace(/<execute_command[^>]*>[\s\S]*?<\/execute_command>/gi, '');
    cleaned = cleaned.replace(/<execute_command[^>]*\/?>/gi, '');
    cleaned = cleaned.replace(/<list_files[^>]*>[\s\S]*?<\/list_files>/gi, '');
    cleaned = cleaned.replace(/<list_files[^>]*\/?>/gi, '');
    cleaned = cleaned.replace(/<write_to_file[^>]*>[\s\S]*?<\/write_to_file>/gi, '');
    cleaned = cleaned.replace(/<ask_followup_question[^>]*>[\s\S]*?<\/ask_followup_question>/gi, '');
    cleaned = cleaned.replace(/<attempt_completion[^>]*>[\s\S]*?<\/attempt_completion>/gi, '');
    
    // Remove any remaining known plan component wrapper tags (opening and closing, no content strip)
    // Only target the specific known tag names to avoid eating real words in the response.
    const knownTags = ['plan', 'checklist', 'decision', 'overview', 'approach', 'pros', 'cons',
      'tasks', 'architecture', 'considerations', 'old_content', 'new_content',
      'create_file', 'edit_file', 'delete_file', 'read_file', 'search_files', 
      'execute_command', 'list_files', 'write_to_file', 'ask_followup_question',
      'attempt_completion', 'summary', 'thinking', 'result', 'output', 'response'];
    const knownTagPattern = knownTags.join('|');
    // Remove paired known tags that still have content inside
    cleaned = cleaned.replace(
      new RegExp(`<(${knownTagPattern})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'gi'), ''
    );
    // Remove any leftover standalone opening/closing tags for known names only
    cleaned = cleaned.replace(
      new RegExp(`<\\/?(?:${knownTagPattern})(?:\\s[^>]*)?\\s*/?>`, 'gi'), ''
    );
    
    // Remove any remaining malformed XML-like tags that look like tool calls
    // Match patterns like <tag_name ... /> or <tag_name ...> with underscores
    cleaned = cleaned.replace(/<[a-z_]+(?:\s+[^>]*)?\s*\/?>/gi, (match) => {
      // Only remove if it looks like a tool call (has underscore or specific patterns)
      if (match.includes('_') || /^<(read|write|search|list|execute|create|edit|delete|get|set|run)/i.test(match)) {
        return '';
      }
      return match;
    });
    
    // Clean up stray XML closing tags
    cleaned = cleaned.replace(/<\/[a-z_]+>/gi, (match) => {
      if (match.includes('_')) return '';
      return match;
    });
    
    // Clean up stray XML-like fragments - be conservative to avoid false positives
    // Remove stray " /> or '/> patterns (remnants of self-closing tags)
    cleaned = cleaned.replace(/^["']\s*\/>\s*$/gm, '');
    cleaned = cleaned.replace(/["']\s*\/>\s*(?=\n|$)/g, '');
    // Remove stray /> at the start of lines (only if alone or followed by whitespace)
    cleaned = cleaned.replace(/^\s*\/>\s*$/gm, '');
    // Remove incomplete tool-call tags (only known prefixes to avoid false positives)
    const toolPrefixes = 'read_file|write_file|create_file|edit_file|delete_file|search_files|list_files|execute_command|checklist|chec';
    cleaned = cleaned.replace(new RegExp(`<(?:${toolPrefixes})(?:=["'][^"']*)?["']?\\s*>?`, 'gi'), '');
    // Remove stray quotes at start of lines (only if that's the entire line)
    cleaned = cleaned.replace(/^\s*["']\s*$/gm, '');
    // Remove lines that are just XML remnants
    cleaned = cleaned.replace(/^\s*[\/>"']{1,3}\s*$/gm, '');
    
    // Clean up excessive whitespace/newlines that may be left
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    
    return cleaned;
  };

  const assistantContent = useMemo(() => {
    let cleaned = getCleanedContent(message.content);
    // Clean question tags from display since they're rendered separately
    cleaned = cleanQuestionTags(cleaned);
    // Clean workspace operation tags from display since they're rendered separately
    cleaned = cleanWorkspaceOperationTags(cleaned);
    // Clean command tags from display since they're rendered separately
    cleaned = cleanCommandTags(cleaned);
    return removeChecklistSections(cleaned, planComponents.checklists);
  }, [message.content, planComponents.checklists, removeChecklistSections]);

  const [plainExpanded, setPlainExpanded] = useState(Boolean(plainTextDefaultExpanded));
  useEffect(() => {
    if (plainTextDefaultExpanded) setPlainExpanded(true);
  }, [plainTextDefaultExpanded]);

  return (
    <div className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      <div className={styles.messageHeader}>
        <div className={styles.avatar}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </div>
        <span className={styles.role}>{isUser ? 'You' : 'Assistant'}</span>
        <button className={styles.copyBtn} onClick={copyToClipboard} title="Copy">
          <Copy size={12} />
        </button>
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className={styles.messageAttachments}>
          {message.attachments.map((attachment) => (
            <div key={attachment.id} className={styles.messageAttachment}>
              {attachment.type === 'image' && attachment.data ? (
                <img 
                  src={attachment.data} 
                  alt={attachment.name} 
                  className={styles.messageAttachmentImage}
                  onClick={() => onImagePreview?.(attachment.data!, attachment.name)}
                  style={{ cursor: 'pointer' }}
                />
              ) : (
                <div className={styles.messageAttachmentFile}>
                  <Paperclip size={14} />
                  <span>{attachment.name}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className={styles.messageContent}>
        {renderAsPlainText ? (
          plainTextKind === 'diff' ? (
            <DiffViewer 
              text={isUser ? message.content : assistantContent} 
              title={plainTextTitle || 'Review Input'}
            />
          ) : (
            <div className={styles.plainTextBlock}>
              <div className={styles.plainTextHeader}>
                <div className={styles.plainTextHeaderLeft}>
                  <span className={styles.plainTextTitle}>{plainTextTitle || (isUser ? 'Input' : 'Streaming')}</span>
                  <span className={styles.plainTextMeta}>{(isUser ? message.content.length : assistantContent.length).toLocaleString()} chars</span>
                </div>
                <div className={styles.plainTextActions}>
                  <button
                    className={styles.plainTextActionBtn}
                    onClick={() => navigator.clipboard.writeText(isUser ? message.content : assistantContent)}
                    type="button"
                    title="Copy"
                  >
                    Copy
                  </button>
                  <button
                    className={styles.plainTextActionBtn}
                    onClick={() => setPlainExpanded((v) => !v)}
                    type="button"
                    title={plainExpanded ? 'Collapse' : 'Expand'}
                  >
                    {plainExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
              <pre className={`${styles.plainTextPre} ${plainExpanded ? styles.plainTextPreExpanded : ''}`}>
                {isUser ? message.content : assistantContent}
              </pre>
            </div>
          )
        ) : isUser ? (
          <MarkdownRenderer content={message.content} disableLooseCodeDetection={false} />
        ) : (
          <MarkdownRenderer content={assistantContent} disableLooseCodeDetection={agentMode === 'plan'} />
        )}
      </div>
      {!isUser && pendingOps.length > 0 && (
        <div className={styles.fileOperations}>
          <div className={styles.fileOpsHeader}>
            <span className={styles.fileOpsTitle}>File Operations</span>
            <span className={styles.fileOpsCount}>{pendingOps.length} changes</span>
          </div>
          {pendingOps.map((op, idx) => (
            <FileOperationPreview
              key={idx}
              operation={op}
            />
          ))}
        </div>
      )}
      {!isUser && (planComponents.plans.length > 0 || planComponents.checklists.length > 0 || planComponents.decisions.length > 0) && (
        <div className={styles.planComponents}>
          {planComponents.plans.map((plan, idx) => (
            <PlanView 
              key={idx} 
              plan={plan} 
              onProceedWithApproach={(approach) => {
                sendMessage(`Proceed with "${approach.name}". Please break down the implementation steps and begin execution.`);
              }}
            />
          ))}
          {planComponents.checklists.map((checklist, idx) => (
            <ChecklistView
              key={idx}
              checklist={checklist}
              onImplementInAgent={agentMode !== 'agent' ? handleImplementInAgent : undefined}
            />
          ))}
          {planComponents.decisions.map((decision, idx) => (
            <DecisionView key={idx} decision={decision} />
          ))}
        </div>
      )}
      {!isUser && localQuestions.length > 0 && (
        <div className={styles.questionsContainer}>
          {localQuestions.map((question) => (
            <QuestionBlock
              key={question.id}
              question={question}
              onAnswer={handleAnswerQuestion}
              disabled={false}
            />
          ))}
        </div>
      )}
      {!isUser && workspaceOps.length > 0 && (
        <div className={styles.workspaceOpsContainer}>
          {workspaceOps.map((op) => (
            <WorkspaceCreationBlock
              key={op.path}
              operation={op}
              onConfirm={() => handleCreateWorkspace(op)}
              onCancel={handleCancelWorkspace}
              isCreating={workspaceCreating === op.path}
              isCreated={workspaceCreated === op.path}
            />
          ))}
        </div>
      )}
      {!isUser && localCommands.length > 0 && (
        <div className={styles.commandOpsContainer}>
          {localCommands.map(({ parsed, operation }) => {
            // Get the latest status from store if available
            const storeCmd = pendingCommands.find(c => c.id === operation.id);
            const currentStatus = storeCmd?.status || operation.status;
            const currentOutput = storeCmd?.output || operation.output;
            const currentExitCode = storeCmd?.exitCode ?? operation.exitCode;
            const currentError = storeCmd?.error || operation.error;
            
            return (
              <CommandApprovalBlock
                key={operation.id}
                command={parsed}
                commandId={operation.id}
                status={currentStatus}
                output={currentOutput}
                exitCode={currentExitCode}
                error={currentError}
                onSkip={() => handleSkipCommand(operation.id)}
                onAlwaysRun={() => handleAlwaysRunCommand(operation.id, parsed.command)}
                onRun={() => handleRunCommand(operation.id)}
              />
            );
          })}
        </div>
      )}
      {!isUser && agentMode === 'plan' && codeBlockTasks.length > 0 && (
        <CodeBlockWarning 
          count={codeBlockTasks.length}
          onSwitchToAgent={() => setAgentMode('agent')} 
        />
      )}
      {!isUser && agentMode === 'plan' && actionableTasks.length >= 2 && (
        <ActionableTasksSuggestion 
          tasks={actionableTasks} 
          onSwitchToAgent={() => handleImplementInAgent(actionableTasks)} 
        />
      )}
      {!isUser && agentMode === 'chat' && hasImplementationOffer && (
        <ImplementationOfferPrompt 
          onSwitchToAgent={() => setAgentMode('agent')} 
        />
      )}
      {!isUser && agentMode !== 'agent' && hasSwitchToAgentSuggestion && !hasImplementationOffer && (
        <SwitchToAgentPrompt 
          onSwitchToAgent={() => setAgentMode('agent')} 
        />
      )}
      {!isUser && message.usage && (
        <div className={styles.messageUsage}>
          <span className={styles.messageUsageTokens}>
            {message.usage.totalTokens.toLocaleString()} tokens
          </span>
          {message.usage.estimatedCostUsd > 0 && (
            <span className={styles.messageUsageCost}>
              ${message.usage.estimatedCostUsd.toFixed(4)}
            </span>
          )}
          {(message.usage.cacheCreationTokens > 0 || message.usage.cacheReadTokens > 0) && (
            <span className={styles.messageUsageCache}>
              cache: {message.usage.cacheReadTokens > 0 
                ? `${Math.round((message.usage.cacheReadTokens / (message.usage.promptTokens + message.usage.cacheReadTokens)) * 100)}% hit`
                : 'miss'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const MemoizedMessageBubble = memo(
  MessageBubble,
  (prev, next) => {
    if (prev.message.id !== next.message.id) return false;
    if (prev.message.role !== next.message.role) return false;
    if (prev.message.content !== next.message.content) return false;
    if ((prev.message.attachments?.length || 0) !== (next.message.attachments?.length || 0)) return false;
    if (prev.renderAsPlainText !== next.renderAsPlainText) return false;
    if (prev.plainTextTitle !== next.plainTextTitle) return false;
    if (prev.plainTextDefaultExpanded !== next.plainTextDefaultExpanded) return false;
    if (prev.plainTextKind !== next.plainTextKind) return false;
    const prevAttachmentIds = prev.message.attachments?.map(a => a.id).join(',') || '';
    const nextAttachmentIds = next.message.attachments?.map(a => a.id).join(',') || '';
    if (prevAttachmentIds !== nextAttachmentIds) return false;
    const prevUsage = prev.message.usage;
    const nextUsage = next.message.usage;
    if (prevUsage || nextUsage) {
      if (!prevUsage || !nextUsage) return false;
      if (prevUsage.totalTokens !== nextUsage.totalTokens) return false;
      if (prevUsage.promptTokens !== nextUsage.promptTokens) return false;
      if (prevUsage.completionTokens !== nextUsage.completionTokens) return false;
      if (prevUsage.cacheCreationTokens !== nextUsage.cacheCreationTokens) return false;
      if (prevUsage.cacheReadTokens !== nextUsage.cacheReadTokens) return false;
      if (prevUsage.estimatedCostUsd !== nextUsage.estimatedCostUsd) return false;
    }
    return true;
  }
);

// ─── Agent Task Progress Panel ────────────────────────────────────────────────
function AgentTaskProgress({ tasks, onClear }: { tasks: AgentTask[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed === total;

  return (
    <div className={`${styles.agentTaskProgress} ${allDone ? styles.agentTaskProgressDone : ''}`}>
      <div
        className={styles.agentTaskProgressHeader}
        onClick={() => setCollapsed(v => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setCollapsed(v => !v)}
      >
        <div className={styles.agentTaskProgressTitle}>
          <ListChecks size={13} />
          <span>Agent Tasks</span>
          <span className={styles.agentTaskProgressCount}>{completed}/{total}</span>
          {allDone && <span className={styles.agentTaskDoneLabel}>All done</span>}
        </div>
        <div className={styles.agentTaskProgressActions}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <button
            className={styles.agentTaskClearBtn}
            onClick={e => { e.stopPropagation(); onClear(); }}
            title="Clear task list"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className={styles.agentTaskProgressBarWrap}>
        <div
          className={styles.agentTaskProgressBarFill}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {!collapsed && (
        <div className={styles.agentTaskList}>
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`${styles.agentTaskItem} ${styles[`agentTaskStatus_${task.status.replace('-', '_')}`]}`}
            >
              <span className={styles.agentTaskIcon}>
                {task.status === 'completed' ? (
                  <Check size={12} />
                ) : task.status === 'in-progress' ? (
                  <Loader size={12} className={styles.agentTaskSpinner} />
                ) : (
                  <Circle size={12} />
                )}
              </span>
              <span className={styles.agentTaskText}>{task.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkdownRenderer({ content, disableLooseCodeDetection }: { content: string; disableLooseCodeDetection?: boolean }) {
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code blocks - match ``` at start (with optional whitespace) or just ```
      const codeBlockMatch = line.match(/^(\s*)```(\w*)\s*$/);
      if (codeBlockMatch || line.trim().startsWith('```')) {
        const lang = codeBlockMatch ? codeBlockMatch[2] : line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length) {
          const currentLine = lines[i];
          // Check for closing ``` (with optional whitespace)
          if (currentLine.trim() === '```' || currentLine.match(/^\s*```\s*$/)) {
            i++;
            break;
          }
          codeLines.push(currentLine);
          i++;
        }
        
        // Render mermaid diagrams specially
        if (lang.toLowerCase() === 'mermaid') {
          elements.push(
            <MermaidDiagram key={key++} chart={codeLines.join('\n')} id={`diagram-${key}`} />
          );
        } else {
          const codeContent = codeLines.join('\n');
          
          // Check if content inside code block is actually a table
          // (has pipe separators and a separator row with dashes)
          const isTableContent = (() => {
            if (codeLines.length < 2) return false;
            const hasHeaders = codeLines[0].includes('|');
            const hasSeparator = codeLines.some(l => {
              const trimmed = l.trim();
              const withoutPipes = trimmed.replace(/^\||\|$/g, '');
              const cells = withoutPipes.split('|');
              return cells.length > 0 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
            });
            const hasDataRows = codeLines.filter(l => l.includes('|')).length >= 2;
            return hasHeaders && hasSeparator && hasDataRows;
          })();
          
          // If it's a table, render as table instead of code block
          // Note: 'code' is excluded - if user explicitly uses ```code, respect that
          if (isTableContent && (lang === '' || lang === 'text' || lang === 'plaintext')) {
            const tableRows: string[][] = [];
            let hasHeader = false;
            
            const parseRow = (row: string): string[] => {
              let trimmed = row.trim();
              if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
              if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
              return trimmed.split('|').map(cell => cell.trim());
            };
            
            const isSepRow = (row: string): boolean => {
              const trimmed = row.trim().replace(/^\||\|$/g, '');
              const cells = trimmed.split('|');
              return cells.length > 0 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
            };
            
            for (const codeLine of codeLines) {
              if (isSepRow(codeLine)) {
                hasHeader = tableRows.length > 0;
                continue;
              }
              if (codeLine.includes('|')) {
                tableRows.push(parseRow(codeLine));
              }
            }
            
            if (tableRows.length > 0) {
              const headerRow = hasHeader ? tableRows[0] : null;
              const bodyRows = hasHeader ? tableRows.slice(1) : tableRows;
              
              elements.push(
                <div key={key++} className={styles.tableWrapper}>
                  <table className={styles.mdTable}>
                    {headerRow && (
                      <thead>
                        <tr>
                          {headerRow.map((cell, idx) => (
                            <th key={idx}>{renderInline(cell)}</th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {bodyRows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <td key={cellIdx}>{renderInline(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              continue;
            }
          }
          
          // Check if content is a checklist (lines with checkbox symbols or [ ] syntax)
          const isChecklistContent = (() => {
            if (codeLines.length === 0) return false;
            // Match lines with checkbox symbols or [ ] syntax
            const checkboxSymbolPattern = /^[\s]*\d*[\s]*[□☐☑☒✓✗✔✅❌]\s+.+$/;
            const checkboxBracketPattern = /^[\s]*\d*[\s]*\[[ xX]\]\s+.+$/;
            const nonEmptyLines = codeLines.filter(l => l.trim().length > 0);
            return nonEmptyLines.length > 0 && nonEmptyLines.every(l => 
              checkboxSymbolPattern.test(l) || checkboxBracketPattern.test(l)
            );
          })();
          
          // Note: 'code' is excluded - if user explicitly uses ```code, respect that
          if (isChecklistContent && (lang === '' || lang === 'text' || lang === 'plaintext')) {
            const listItems: React.ReactNode[] = [];
            codeLines.forEach((codeLine, idx) => {
              if (codeLine.trim().length === 0) return;
              
              // Remove leading number if present
              let itemText = codeLine.replace(/^[\s]*\d+[\s.]*/, '').trim();
              
              // Check for checkbox symbols (□☐☑☒✓✗✔✅)
              const symbolMatch = itemText.match(/^([□☐☑☒✓✗✔✅❌])\s+(.+)$/);
              if (symbolMatch) {
                const symbol = symbolMatch[1];
                const text = symbolMatch[2];
                const isChecked = ['☑', '☒', '✓', '✗', '✔', '✅'].includes(symbol);
                listItems.push(
                  <li key={idx} className={styles.mdChecklistItem}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      readOnly 
                      className={styles.mdCheckbox}
                    />
                    <span>{renderInline(text)}</span>
                  </li>
                );
                return;
              }
              
              // Check for markdown checkbox syntax: [ ] or [x] or [X]
              const checkboxMatch = itemText.match(/^\[( |x|X)\]\s+(.+)$/);
              if (checkboxMatch) {
                const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                const text = checkboxMatch[2];
                listItems.push(
                  <li key={idx} className={styles.mdChecklistItem}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      readOnly 
                      className={styles.mdCheckbox}
                    />
                    <span>{renderInline(text)}</span>
                  </li>
                );
              }
            });
            
            if (listItems.length > 0) {
              elements.push(<ul key={key++} className={styles.mdList}>{listItems}</ul>);
              continue;
            }
          }
          
          // Check if content is markdown (has headers, bold, lists, tables, etc.) - render as markdown instead of code
          // CONSERVATIVE APPROACH: Require multiple indicators and exclude known code languages
          const isMarkdownContent = (() => {
            if (codeLines.length === 0) return false;
            
            // List of explicit code languages that should NEVER be treated as markdown
            const explicitCodeLangs = [
              'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'cpp', 'c', 
              'ruby', 'php', 'swift', 'kotlin', 'scala', 'bash', 'sh', 'zsh', 'shell',
              'sql', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml',
              'toml', 'ini', 'conf', 'lua', 'perl', 'r', 'julia', 'elixir', 'erlang',
              'haskell', 'ocaml', 'fsharp', 'csharp', 'cs', 'vb', 'powershell', 'ps1',
              'dockerfile', 'makefile', 'cmake', 'gradle', 'groovy', 'clojure',
              'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'rs', 'vue', 'svelte'
            ];
            
            const langLower = lang.toLowerCase();
            
            // If language is explicitly a code language, NEVER treat as markdown
            if (explicitCodeLangs.includes(langLower)) {
              return false;
            }
            
            // Check for markdown indicators
            const hasHeaders = codeLines.some(l => /^#{1,6}\s+\S/.test(l.trim()));
            const hasBold = codeLines.some(l => /\*\*[^*]+\*\*/.test(l));
            const hasLists = codeLines.some(l => /^[\s]*[-*+]\s\S/.test(l) || /^[\s]*\d+\.\s\S/.test(l));
            const hasBlockquotes = codeLines.some(l => /^>\s/.test(l.trim()));
            const hasTables = codeLines.some(l => (l.match(/\|/g) || []).length >= 2 && l.trim().startsWith('|'));
            
            // Count how many different markdown indicators are present
            const markdownIndicatorCount = [hasHeaders, hasBold, hasLists, hasBlockquotes, hasTables].filter(Boolean).length;
            
            // Check for code patterns that should PREVENT markdown rendering
            const hasCodePatterns = codeLines.some(l => {
              const trimmed = l.trim();
              return (
                // JavaScript/TypeScript patterns
                /^(const|let|var|function|class|import|export|if|else|for|while|return|async|await|interface|type|enum)\s/.test(trimmed) ||
                // Python patterns
                /^(def|class|import|from|if|elif|else|for|while|return|try|except|with|async|await)\s/.test(trimmed) ||
                // Rust/Go/C patterns
                /^(fn|pub|impl|struct|enum|use|mod|let|mut|match|unsafe|extern|crate)\s/.test(trimmed) ||
                /^(func|package|import|type|struct|interface|var|const|defer|go|select)\s/.test(trimmed) ||
                // Common code endings
                /[{};]\s*$/.test(trimmed) ||
                /=>\s*[{(]/.test(l) ||
                /\(\s*\)\s*=>/.test(l) ||
                // Comment patterns that look like code (not markdown headers)
                /^\/\/\s/.test(trimmed) ||  // JS/C++ comments
                /^#!\s*\//.test(trimmed) ||  // Shebang
                /^#\s*include\s/.test(trimmed) ||  // C includes
                /^#\s*define\s/.test(trimmed) ||   // C defines
                /^#\s*pragma\s/.test(trimmed)      // C pragmas
              );
            });
            
            // If code patterns found, don't treat as markdown
            if (hasCodePatterns) {
              return false;
            }
            
            // Check for Python/Shell comment-heavy files that might false-positive on headers
            const hashCommentCount = codeLines.filter(l => /^\s*#[^#!\s]/.test(l) || /^\s*#\s+[a-z]/.test(l.toLowerCase())).length;
            const totalNonEmpty = codeLines.filter(l => l.trim().length > 0).length;
            
            // If more than 40% of lines are hash-style comments, likely code not markdown
            if (totalNonEmpty > 0 && hashCommentCount / totalNonEmpty > 0.4) {
              return false;
            }
            
            // For text/plaintext blocks, require at least 2 different markdown indicators
            const isTextLang = lang === '' || lang === 'text' || lang === 'plaintext' || lang === 'markdown' || lang === 'md';
            if (isTextLang && markdownIndicatorCount >= 2) {
              return true;
            }
            
            // For 'code' language hint, NEVER treat as markdown (explicit code request)
            if (langLower === 'code') {
              return false;
            }
            
            // For explicit markdown/md, always treat as markdown
            if (langLower === 'markdown' || langLower === 'md') {
              return true;
            }
            
            // For empty/text lang with only 1 indicator, don't treat as markdown
            return false;
          })();
          
          if (isMarkdownContent && (lang === '' || lang === 'text' || lang === 'plaintext' || lang === 'markdown' || lang === 'md')) {
            const markdownContent = codeContent;
            const mdLines = markdownContent.split('\n');
            let mdIndex = 0;
            
            while (mdIndex < mdLines.length) {
              const mdLine = mdLines[mdIndex];
              
              const mdHeadingMatch = mdLine.match(/^(#{1,6})\s*(.*)/);
              if (mdHeadingMatch && mdHeadingMatch[2].trim().length > 0) {
                const level = mdHeadingMatch[1].length;
                const headingContent = renderInline(mdHeadingMatch[2].trim());
                if (level === 1) elements.push(<h1 key={key++} className={styles.mdH1}>{headingContent}</h1>);
                else if (level === 2) elements.push(<h2 key={key++} className={styles.mdH2}>{headingContent}</h2>);
                else if (level === 3) elements.push(<h3 key={key++} className={styles.mdH3}>{headingContent}</h3>);
                else elements.push(<h4 key={key++} className={styles.mdH4}>{headingContent}</h4>);
                mdIndex++;
                continue;
              }
              
              if (mdLine.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
                elements.push(<hr key={key++} className={styles.mdHr} />);
                mdIndex++;
                continue;
              }
              
              if (mdLine.match(/^[\s]*[-*+]\s/)) {
                const listItems: React.ReactNode[] = [];
                while (mdIndex < mdLines.length && mdLines[mdIndex].match(/^[\s]*[-*+]\s/)) {
                  const itemContent = mdLines[mdIndex].replace(/^[\s]*[-*+]\s/, '');
                  listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
                  mdIndex++;
                }
                elements.push(<ul key={key++} className={styles.mdList}>{listItems}</ul>);
                continue;
              }
              
              if (mdLine.match(/^[\s]*\d+\.\s/)) {
                const listItems: React.ReactNode[] = [];
                while (mdIndex < mdLines.length && mdLines[mdIndex].match(/^[\s]*\d+\.\s/)) {
                  const itemContent = mdLines[mdIndex].replace(/^[\s]*\d+\.\s/, '');
                  listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
                  mdIndex++;
                }
                elements.push(<ol key={key++} className={styles.mdList}>{listItems}</ol>);
                continue;
              }
              
              if (mdLine.startsWith('> ')) {
                const quoteLines: string[] = [];
                while (mdIndex < mdLines.length && mdLines[mdIndex].startsWith('> ')) {
                  quoteLines.push(mdLines[mdIndex].slice(2));
                  mdIndex++;
                }
                elements.push(
                  <blockquote key={key++} className={styles.mdBlockquote}>
                    {quoteLines.map((l, idx) => <p key={idx}>{renderInline(l)}</p>)}
                  </blockquote>
                );
                continue;
              }
              
              if (mdLine.trim().length === 0) {
                mdIndex++;
                continue;
              }
              
              // Table detection for markdown inside code blocks
              const mdTrimmedLine = mdLine.trim();
              const mdPipeCount = (mdLine.match(/\|/g) || []).length;
              const mdLooksLikeTableRow = mdTrimmedLine.startsWith('|') || mdPipeCount >= 2;
              const mdNextLine = mdIndex + 1 < mdLines.length ? mdLines[mdIndex + 1] : '';
              
              const mdIsSeparatorLine = (l: string): boolean => {
                const trimmed = l.trim();
                const withoutOuterPipes = trimmed.startsWith('|') && trimmed.endsWith('|') 
                  ? trimmed.slice(1, -1) 
                  : trimmed;
                const cells = withoutOuterPipes.split('|');
                return cells.length >= 1 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
              };
              
              const mdHasSeparatorCells = (l: string): boolean => {
                const trimmed = l.trim();
                if (!trimmed.includes('|')) return false;
                const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
                return cells.some(cell => {
                  const dashCount = (cell.match(/-/g) || []).length;
                  return dashCount >= 3 && dashCount >= cell.length * 0.7;
                });
              };
              
              const mdIsSeparatorCell = (cell: string): boolean => {
                const trimmed = cell.trim();
                if (!trimmed) return false;
                const dashCount = (trimmed.match(/-/g) || []).length;
                return dashCount >= 2 && dashCount >= trimmed.length * 0.5;
              };
              
              // Also check if next line is another pipe row
              const mdNextLineIsPipeRow = mdNextLine.trim().startsWith('|') && (mdNextLine.match(/\|/g) || []).length >= 2;
              
              // Table starts if: current line has pipes AND (next line is separator OR next line has separator cells OR next line is pipe row)
              const mdIsTableStart = mdLooksLikeTableRow && (
                mdIsSeparatorLine(mdNextLine) || 
                mdHasSeparatorCells(mdNextLine) ||
                /\|[\s:-]*-{2,}[\s:-]*\|/.test(mdTrimmedLine) ||
                mdNextLineIsPipeRow
              );
              
              if (mdIsTableStart) {
                const tableRows: string[][] = [];
                let hasHeader = false;
                
                while (mdIndex < mdLines.length) {
                  const row = mdLines[mdIndex];
                  const rowTrimmed = row.trim();
                  const rowPipeCount = (row.match(/\|/g) || []).length;
                  
                  if (!rowTrimmed.startsWith('|') && rowPipeCount < 2) break;
                  
                  if (mdIsSeparatorLine(row)) {
                    hasHeader = tableRows.length > 0;
                    mdIndex++;
                    continue;
                  }
                  
                  const rawCells = rowTrimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
                  const dataCells = rawCells.filter(c => c.length > 0 && !mdIsSeparatorCell(c));
                  
                  if (dataCells.length > 0) {
                    tableRows.push(dataCells);
                  }
                  
                  if (rawCells.some(c => c.length > 0 && mdIsSeparatorCell(c)) && tableRows.length > 0) {
                    hasHeader = true;
                  }
                  
                  mdIndex++;
                }
                
                if (tableRows.length > 0) {
                  const headerRow = hasHeader ? tableRows[0] : null;
                  const bodyRows = hasHeader ? tableRows.slice(1) : tableRows;
                  
                  elements.push(
                    <div key={key++} className={styles.tableWrapper}>
                      <table className={styles.mdTable}>
                        {headerRow && (
                          <thead>
                            <tr>
                              {headerRow.map((cell, idx) => (
                                <th key={idx}>{renderInline(cell)}</th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {bodyRows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <td key={cellIdx}>{renderInline(cell)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                continue;
              }
              
              // Check if this is a standalone pipe-delimited row (render as simple table row)
              if (mdPipeCount >= 2 && mdTrimmedLine.startsWith('|') && mdTrimmedLine.endsWith('|')) {
                const cells = mdTrimmedLine.slice(1, -1).split('|').map(c => c.trim()).filter(c => c.length > 0);
                if (cells.length >= 2) {
                  elements.push(
                    <div key={key++} className={styles.tableWrapper}>
                      <table className={styles.mdTable}>
                        <tbody>
                          <tr>
                            {cells.map((cell, idx) => (
                              <td key={idx}>{renderInline(cell)}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                  mdIndex++;
                  continue;
                }
              }
              
              elements.push(<p key={key++} className={styles.mdParagraph}>{renderInline(mdLine)}</p>);
              mdIndex++;
            }
            continue;
          }
          
          // Check if this is a diff (has +/- lines)
          const isDiff = lang.toLowerCase() === 'diff' || 
            codeLines.some(l => l.startsWith('+') || l.startsWith('-')) &&
            codeLines.filter(l => l.startsWith('+') || l.startsWith('-')).length > codeLines.length * 0.3;
          
          // Try to extract filename from language hint (e.g., "typescript:src/app.ts" or just a path)
          let filename: string | undefined;
          let actualLang = lang;
          if (lang.includes(':')) {
            const parts = lang.split(':');
            actualLang = parts[0];
            filename = parts[1];
          } else if (lang.includes('/') || lang.includes('.')) {
            filename = lang;
            // Infer language from extension
            const ext = lang.split('.').pop()?.toLowerCase();
            const extMap: Record<string, string> = {
              'js': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
              'jsx': 'javascript', 'py': 'python', 'rb': 'ruby',
              'rs': 'rust', 'go': 'go', 'java': 'java', 'cpp': 'cpp',
              'c': 'c', 'css': 'css', 'html': 'html', 'json': 'json',
              'yaml': 'yaml', 'yml': 'yaml', 'md': 'markdown', 'sh': 'bash'
            };
            actualLang = ext ? (extMap[ext] || ext) : 'text';
          }
          
          elements.push(
            <CodeBlock 
              key={key++} 
              code={codeContent} 
              language={actualLang}
              filename={filename}
              isDiff={isDiff}
            />
          );
        }
        continue;
      }

      // Headers — match `# ` with optional space so `##✅ Title` and `## Title` both work
      const headingMatch = line.match(/^(#{1,6})\s*(.*)/);
      if (headingMatch && headingMatch[2].trim().length > 0) {
        const level = headingMatch[1].length;
        const headingContent = renderInline(headingMatch[2].trim());
        if (level === 1) elements.push(<h1 key={key++} className={styles.mdH1}>{headingContent}</h1>);
        else if (level === 2) elements.push(<h2 key={key++} className={styles.mdH2}>{headingContent}</h2>);
        else if (level === 3) elements.push(<h3 key={key++} className={styles.mdH3}>{headingContent}</h3>);
        else elements.push(<h4 key={key++} className={styles.mdH4}>{headingContent}</h4>);
        i++;
        continue;
      }

      // Horizontal rule
      if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
        elements.push(<hr key={key++} className={styles.mdHr} />);
        i++;
        continue;
      }

      // Standalone checkbox lines (without list prefix): [ ] or [x] at start of line
      if (line.match(/^[\s]*\[[ xX]\]\s+/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^[\s]*\[[ xX]\]\s+/)) {
          const checkboxMatch = lines[i].match(/^[\s]*(\[[ xX]\])\s+(.+)$/);
          if (checkboxMatch) {
            const isChecked = checkboxMatch[1].toLowerCase() === '[x]';
            const text = checkboxMatch[2];
            listItems.push(
              <li key={key++} className={styles.mdChecklistItem}>
                <input 
                  type="checkbox" 
                  checked={isChecked} 
                  readOnly 
                  className={styles.mdCheckbox}
                />
                <span>{renderInline(text)}</span>
              </li>
            );
          }
          i++;
        }
        if (listItems.length > 0) {
          elements.push(<ul key={key++} className={styles.mdList}>{listItems}</ul>);
        }
        continue;
      }

      // Unordered lists (including checkboxes)
      if (line.match(/^[\s]*[-*+]\s/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
          const itemContent = lines[i].replace(/^[\s]*[-*+]\s/, '');
          
          // Check for checkbox syntax: [ ] or [x] or [X] (with or without space after bracket)
          const checkboxMatch = itemContent.match(/^(\[[ xX]\])\s*(.+)$/);
          if (checkboxMatch) {
            const isChecked = checkboxMatch[1].toLowerCase() === '[x]';
            const text = checkboxMatch[2];
            listItems.push(
              <li key={key++} className={styles.mdChecklistItem}>
                <input 
                  type="checkbox" 
                  checked={isChecked} 
                  readOnly 
                  className={styles.mdCheckbox}
                />
                <span>{renderInline(text)}</span>
              </li>
            );
          } else {
            listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
          }
          i++;
        }
        elements.push(<ul key={key++} className={styles.mdList}>{listItems}</ul>);
        continue;
      }

      // Ordered lists
      if (line.match(/^[\s]*\d+\.\s/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s/)) {
          const itemContent = lines[i].replace(/^[\s]*\d+\.\s/, '');
          listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
          i++;
        }
        elements.push(<ol key={key++} className={styles.mdList}>{listItems}</ol>);
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          quoteLines.push(lines[i].slice(2));
          i++;
        }
        elements.push(
          <blockquote key={key++} className={styles.mdBlockquote}>
            {quoteLines.map((l, idx) => <p key={idx}>{renderInline(l)}</p>)}
          </blockquote>
        );
        continue;
      }

      // Tables - detect lines that look like proper table rows (start with | or have 2+ pipes)
      const trimmedLine = line.trim();
      const pipeCount = (line.match(/\|/g) || []).length;
      // A proper table row must start with | OR have at least 2 | separators in the middle
      const looksLikeTableRow = trimmedLine.startsWith('|') || pipeCount >= 2;
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      
      const isSeparatorLine = (l: string): boolean => {
        // Separator can be |---|---| or just ---|---
        const trimmed = l.trim();
        const withoutOuterPipes = trimmed.startsWith('|') && trimmed.endsWith('|') 
          ? trimmed.slice(1, -1) 
          : trimmed;
        const cells = withoutOuterPipes.split('|');
        return cells.length >= 1 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
      };
      
      // Check if separator is embedded in current line (malformed AI output like "Header | Col |---|---|")
      const hasEmbeddedSeparator = /\|[\s:-]*-{2,}[\s:-]*\|/.test(trimmedLine);
      
      // Also check if line has a separator-like cell pattern (e.g., "|--------|" at end)
      const hasTrailingSeparator = /\|-{3,}\|?\s*$/.test(trimmedLine);
      
      // Check if next line has any separator cells (for malformed tables where sep is mixed with data)
      const nextLineHasSeparatorCells = (() => {
        const trimmed = nextLine.trim();
        if (!trimmed.includes('|')) return false;
        const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        return cells.some(cell => {
          const dashCount = (cell.match(/-/g) || []).length;
          return dashCount >= 3 && dashCount >= cell.length * 0.7;
        });
      })();
      
      // Detect table: next line is separator OR has separator cells OR current line has embedded separator
      // Also check if next line is another table row (consecutive pipes)
      const nextLineIsPipeRow = nextLine.trim().startsWith('|') && (nextLine.match(/\|/g) || []).length >= 2;
      
      const isTableStart = looksLikeTableRow && (
        isSeparatorLine(nextLine) || 
        nextLineHasSeparatorCells ||
        (hasEmbeddedSeparator && pipeCount >= 3) ||
        (hasTrailingSeparator && pipeCount >= 2) ||
        nextLineIsPipeRow
      );
      
      if (isTableStart) {
        const tableRows: string[][] = [];
        let hasHeader = false;
        
        // Helper to parse a table row - filters out separator cells (cells that are mostly dashes)
        const parseTableRow = (row: string): string[] => {
          let trimmed = row.trim();
          // Remove outer pipes if present
          if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
          if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
          // Split and filter out separator-like cells
          return trimmed.split('|')
            .map(cell => cell.trim())
            .filter(cell => {
              if (!cell) return false;
              const dashCount = (cell.match(/-/g) || []).length;
              // Keep cell if it has actual content (less than 50% dashes)
              return dashCount < cell.length * 0.5 || dashCount < 2;
            });
        };
        
        // Helper to check if line is part of the table (starts with | or has 2+ pipes)
        const isTableRow = (l: string): boolean => {
          const t = l.trim();
          return t.startsWith('|') || (l.match(/\|/g) || []).length >= 2;
        };
        
        // Helper to check if a cell looks like a separator (contains mostly dashes)
        const isSeparatorCell = (cell: string): boolean => {
          const trimmed = cell.trim();
          if (!trimmed) return false;
          // Cell is a separator if it's mostly dashes/colons/spaces
          const dashCount = (trimmed.match(/-/g) || []).length;
          return dashCount >= 2 && dashCount >= trimmed.length * 0.5;
        };
        
        // Collect all table rows
        while (i < lines.length && isTableRow(lines[i])) {
          const row = lines[i];
          // Check if this is a pure separator row
          if (isSeparatorLine(row)) {
            hasHeader = tableRows.length > 0;
            i++;
            continue;
          }
          
          // Check if row has embedded separator (malformed output) - extract only data cells
          const rawCells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          const dataCells = rawCells.filter(c => c.length > 0 && !isSeparatorCell(c));
          const hasSeparatorCells = rawCells.some(c => c.length > 0 && isSeparatorCell(c));
          
          if (dataCells.length > 0) {
            tableRows.push(dataCells);
          }
          
          // If this row had separator cells mixed in, treat rows before as header
          if (hasSeparatorCells && tableRows.length > 0) {
            hasHeader = true;
          }
          
          i++;
        }
        
        if (tableRows.length > 0) {
          const headerRow = hasHeader ? tableRows[0] : null;
          const bodyRows = hasHeader ? tableRows.slice(1) : tableRows;
          
          elements.push(
            <div key={key++} className={styles.tableWrapper}>
              <table className={styles.mdTable}>
                {headerRow && (
                  <thead>
                    <tr>
                      {headerRow.map((cell, idx) => (
                        <th key={idx}>{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {bodyRows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Check if this is a standalone pipe-delimited row (render as simple table - collect consecutive pipe rows)
      const lineTrimmed = line.trim();
      const linePipeCount = (line.match(/\|/g) || []).length;
      if (linePipeCount >= 2 && lineTrimmed.startsWith('|')) {
        const tableRows: string[][] = [];
        
        // Collect consecutive pipe rows
        while (i < lines.length) {
          const currentLine = lines[i];
          const currentTrimmed = currentLine.trim();
          const currentPipeCount = (currentLine.match(/\|/g) || []).length;
          
          if (currentPipeCount < 2 || !currentTrimmed.startsWith('|')) break;
          
          const cells = currentTrimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(c => {
            if (!c) return false;
            const dashCount = (c.match(/-/g) || []).length;
            return dashCount < c.length * 0.5 || dashCount < 2;
          });
          
          if (cells.length >= 1) {
            tableRows.push(cells);
          }
          i++;
        }
        
        if (tableRows.length > 0) {
          elements.push(
            <div key={key++} className={styles.tableWrapper}>
              <table className={styles.mdTable}>
                <tbody>
                  {tableRows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // Detect loose code (code without fences) - check if line looks like code.
      // Disable this in Plan Mode to avoid misclassifying checklists/review prose as code blocks.
      const guessLooseCodeLanguage = (snippet: string): string => {
        const s = snippet.slice(0, 2000);
        if (/\bplugins\s*\{/.test(s) || /\bdependencies\s*\{/.test(s) || /\brootProject\.name\b/.test(s) || /\binclude\s+['"][^'"]+['"]/.test(s)) return 'gradle';
        if (/\bpackage\s+[a-zA-Z_][\w.]*\s*;/.test(s) || /\bpublic\s+class\s+\w+/.test(s) || /\bimport\s+[\w.]+\s*;/.test(s)) return 'java';
        if (/^\s*(def|class)\s+\w+/m.test(s) || (/^\s*import\s+\w+/m.test(s) && !/;/.test(s))) return 'python';
        if (/\bfn\s+\w+/.test(s) || /\bpub\s+fn\s+/.test(s) || /\bstruct\s+\w+/.test(s) || /\bimpl\s+\w+/.test(s)) return 'rust';
        if (/\bfunc\s+\w+/.test(s) || /\bpackage\s+\w+/.test(s) && !/;/.test(s)) return 'go';
        if (/\binterface\s+\w+/.test(s) || /:\s*(string|number|boolean|any|unknown)\b/.test(s) || /\btype\s+\w+\s*=/.test(s)) return 'typescript';
        if (/\b(const|let|var|function|export|import)\b/.test(s) || /=>/.test(s)) return 'javascript';
        return 'code';
      };

      const highlightLooseCodeLine = (lineText: string, lang: string) => {
        let tokenKey = 0;
        const patterns: { regex: RegExp; className: string }[] = [];
        const langLower = (lang || '').toLowerCase();

        if (['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'rust', 'go', 'swift', 'gradle', 'groovy', 'kotlin', 'code'].includes(langLower)) {
          patterns.push({ regex: /(\/\/.*$)/, className: styles.syntaxComment });
          patterns.push({ regex: /(\/\*[\s\S]*?\*\/)/, className: styles.syntaxComment });
        }
        if (['python', 'py', 'ruby', 'bash', 'sh', 'shell', 'yaml', 'yml'].includes(langLower)) {
          patterns.push({ regex: /(#.*$)/, className: styles.syntaxComment });
        }

        patterns.push({ regex: /("(?:[^"\\]|\\.)*")/, className: styles.syntaxString });
        patterns.push({ regex: /('(?:[^'\\]|\\.)*')/, className: styles.syntaxString });
        patterns.push({ regex: /(`(?:[^`\\]|\\.)*`)/, className: styles.syntaxString });

        const baseKeywords = [
          'const','let','var','function','return','if','else','for','while','class','interface','type','import','export','from',
          'async','await','try','catch','throw','new','this','super','extends','implements','public','private','protected','static','readonly',
          'package','def','fn','pub','mod','use','struct','enum','impl','trait','match','loop','break','continue',
          'true','false','null','undefined','None','True','False','self','nil'
        ];
        const gradleKeywords = [
          'plugins','dependencies','repositories','mavenCentral','gradlePluginPortal',
          'implementation','api','compileOnly','runtimeOnly','testImplementation','annotationProcessor',
          'group','version','id','java','test','sourceCompatibility','targetCompatibility','subprojects','allprojects','tasks'
        ];
        const keywordList = (langLower === 'gradle' || langLower === 'groovy' || langLower === 'kotlin')
          ? [...baseKeywords, ...gradleKeywords]
          : baseKeywords;
        const keywords = new RegExp(`\\b(${keywordList.map(k => k.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
        patterns.push({ regex: keywords, className: styles.syntaxKeyword });
        patterns.push({ regex: /\b(\d+\.?\d*)\b/, className: styles.syntaxNumber });
        patterns.push({ regex: /\b([a-zA-Z_]\w*)\s*(?=\()/, className: styles.syntaxFunction });

        const replacements: { start: number; end: number; element: React.ReactNode }[] = [];

        patterns.forEach(({ regex, className }) => {
          const globalRegex = new RegExp(regex.source, 'g');
          let match;
          while ((match = globalRegex.exec(lineText)) !== null) {
            const overlaps = replacements.some(r =>
              (match!.index >= r.start && match!.index < r.end) ||
              (match!.index + match![0].length > r.start && match!.index + match![0].length <= r.end)
            );
            if (!overlaps) {
              replacements.push({
                start: match.index,
                end: match.index + match[0].length,
                element: <span key={`tok-${tokenKey++}`} className={className}>{match[0]}</span>,
              });
            }
          }
        });

        replacements.sort((a, b) => a.start - b.start);
        if (replacements.length === 0) return lineText;

        const parts: React.ReactNode[] = [];
        let lastEnd = 0;
        replacements.forEach((r, idx) => {
          if (r.start > lastEnd) parts.push(<span key={`t-${idx}`}>{lineText.slice(lastEnd, r.start)}</span>);
          parts.push(r.element);
          lastEnd = r.end;
        });
        if (lastEnd < lineText.length) parts.push(<span key="t-end">{lineText.slice(lastEnd)}</span>);
        return <>{parts}</>;
      };

      const looksLikeCodeLine = (l: string): boolean => {
        const trimmed = l.trim();
        // Skip very short lines or lines that look like prose
        if (trimmed.length < 3) return false;
        if (/^[A-Z][a-z].*[.!?]$/.test(trimmed)) return false; // Sentence

        const wordCount = trimmed.split(/\s+/).length;
        const hasMarkdown =
          /\*\*.+\*\*/.test(trimmed) ||
          /`[^`]+`/.test(trimmed) ||
          /^[\s]*[-*+]\s+\S/.test(trimmed) ||
          /^[\s]*\d+\.\s+\S/.test(trimmed);
        if (hasMarkdown) return false;

        // Parentheses are extremely common in prose; don't treat them as "code punctuation" by themselves.
        const hasStrongCodePunctuation = /[{};=<>[\]]/.test(trimmed);
        if (wordCount >= 5 && !hasStrongCodePunctuation) return false;

        return (
          // Keywords at start of line
          /^(const|let|var|function|class|import|export|if|else|for|while|return|async|await|try|catch|throw|switch|case|default|break|continue)\s/.test(trimmed) ||
          /^(public|private|protected|static|readonly|interface|type|enum|namespace|module|declare)\s/.test(trimmed) ||
          // Import statements
          /^import\s*[{*]/.test(trimmed) ||
          /^import\s+\w+/.test(trimmed) ||
          /from\s+['"]/.test(trimmed) ||
          // Lines ending with code characters
          /[{};]\s*$/.test(trimmed) ||
          /[)\]]\s*[;,]?\s*$/.test(trimmed) && /[({[]/.test(trimmed) ||
          // Comments
          /^\s*(\/\/|\/\*|\*)/.test(trimmed) ||
          // Arrow functions
          /=>\s*[{(]/.test(trimmed) ||
          /\(\s*\)\s*=>/.test(trimmed) ||
          /=>\s*\{?\s*$/.test(trimmed) ||
          // Method chaining
          /^\s*[.]\w+\(/.test(trimmed) ||
          // Control flow continuations
          /^\s*\}\s*(else|catch|finally)/.test(trimmed) ||
          // Closing brackets
          /^\s*[\])}]+[;,]?\s*$/.test(trimmed) ||
          // Object properties with values
          /^\s*\w+\s*:\s*['"\[\{]/.test(trimmed) ||
          /^\s*\w+:\s*\[/.test(trimmed) ||
          // Variable assignments
          /^\s*\w+\s*=\s*[^=]/.test(trimmed) && !/^[A-Z]/.test(trimmed) ||
          // Function calls
          /^\s*\w+\(.*\)[;,]?\s*$/.test(trimmed) ||
          // Type annotations
          /:\s*(string|number|boolean|any|void|null|undefined)\s*[;,]?\s*$/.test(trimmed) ||
          // JSX-like patterns
          /^<\w+/.test(trimmed) || /^\s*<\/\w+>/.test(trimmed) ||
          // Query patterns (react-query, etc)
          /queryKey\s*:/.test(trimmed) ||
          /queryFn\s*:/.test(trimmed) ||
          // Response patterns
          /response\.\w+/.test(trimmed) ||
          // API/fetch patterns
          /fetch\(/.test(trimmed) ||
          /await\s+\w+/.test(trimmed)
        );
      };

      if (!disableLooseCodeDetection && looksLikeCodeLine(line)) {
        const codeLines: string[] = [];
        while (i < lines.length && (looksLikeCodeLine(lines[i]) || lines[i].trim() === '' || /^\s+/.test(lines[i]))) {
          if (lines[i].trim() === '' && codeLines.length > 0 && i + 1 < lines.length && !looksLikeCodeLine(lines[i + 1]) && !/^\s+/.test(lines[i + 1])) {
            break;
          }
          codeLines.push(lines[i]);
          i++;
        }
        
        if (codeLines.length > 0) {
          const codeContent = codeLines.join('\n');
          const inferredLang = guessLooseCodeLanguage(codeContent);
          const highlighted = codeContent.split('\n').map((l, idx) => (
            <span key={idx}>
              {highlightLooseCodeLine(l, inferredLang)}
              {idx < codeLines.length - 1 ? '\n' : ''}
            </span>
          ));
          elements.push(
            <div key={key++} className={styles.codeBlock}>
              <div className={styles.codeBlockHeader}>
                <span className={styles.codeBlockLang}>{inferredLang}</span>
                <button 
                  className={styles.copyButton}
                  onClick={() => navigator.clipboard.writeText(codeContent)}
                >
                  Copy
                </button>
              </div>
              <div className={styles.codeBlockContent}>
                <pre><code>{highlighted}</code></pre>
              </div>
            </div>
          );
          continue;
        }
      }

      // Regular paragraph
      elements.push(<p key={key++} className={styles.mdParagraph}>{renderInline(line)}</p>);
      i++;
    }

    return elements;
  };

  // Helper to render inline code within nested contexts (for bold/italic containing code)
  const renderInlineInner = (text: string): React.ReactNode => {
    const codeRegex = /`([^`]+)`/g;
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    let match: RegExpExecArray | null;
    let innerKey = 0;
    
    while ((match = codeRegex.exec(text)) !== null) {
      if (match.index > lastEnd) {
        parts.push(text.slice(lastEnd, match.index));
      }
      parts.push(<code key={`inner-${innerKey++}`} className={styles.inlineCode}>{match[1]}</code>);
      lastEnd = match.index + match[0].length;
    }
    
    if (lastEnd < text.length) {
      parts.push(text.slice(lastEnd));
    }
    
    return parts.length > 0 ? <>{parts}</> : text;
  };

  const renderInline = (rawText: string): React.ReactNode => {
    // Safety check for null/undefined/empty
    if (!rawText || typeof rawText !== 'string') {
      return rawText || '';
    }
    
    // Clean up orphaned markers that the model sometimes outputs mid-stream or after list-stripping.
    // Orphaned ** (odd count) → strip the extra one.
    // Orphaned ` (odd count outside triple fences) → strip the extra one.
    let text = rawText;
    const boldMarkerCount = (text.match(/\*\*/g) || []).length;
    if (boldMarkerCount % 2 !== 0) {
      // Remove the last unmatched ** 
      text = text.replace(/\*\*(?!.*\*\*)/, '');
    }
    
    // Safe backtick counting (avoid lookbehind on older browsers)
    let backtickCount = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '`' && text[i-1] !== '`' && text[i+1] !== '`') {
        backtickCount++;
      }
    }
    if (backtickCount % 2 !== 0) {
      // Remove the last unmatched single backtick
      text = text.replace(/`(?=[^`]*$)/, '');
    }

    interface InlineMatch {
      start: number;
      end: number;
      element: React.ReactNode;
    }

    const matches: InlineMatch[] = [];
    let key = 0;

    const noOverlap = (start: number, end: number) =>
      !matches.some(m => start < m.end && end > m.start);
    
    // Helper to check if a position is inside any existing match
    const isInsideMatch = (pos: number) =>
      matches.some(m => pos >= m.start && pos < m.end);

    // Severity badges like:
    // - **[CRITICAL]** foo
    // - HIGH: foo
    // - SEVERITY: MEDIUM — foo
    // - Severity - Low / Code Quality: foo
    // - CRITICAL ISSUES:** foo (AI often outputs this pattern)
    // - HIGH SEVERITY:** foo
    // (process first, at start of line)
    const severityRegex = /^\s*(\*\*)?(?:SEVERITY\s*[:\-–—]\s*)?\[?(CRITICAL|HIGH|MEDIUM|LOW|INFO|TEST)(?:\s*\/\s*(CODE QUALITY))?\]?(\*\*)?(?:\s+(?:ISSUES|SEVERITY)\s*:\s*\*\*)?(?=\s|$)/i;
    const severityMatch = text.match(severityRegex);
    if (severityMatch) {
      const severity = severityMatch[2].toUpperCase();
      const suffix = severityMatch[3] ? ` / ${severityMatch[3].toUpperCase()}` : '';
      const end = severityMatch[0].length;
      matches.push({
        start: 0,
        end,
        element: (
          <span
            key={key++}
            className={`${styles.severityBadge} ${getSeverityClassName(severity)}`}
          >
            {`${severity}${suffix}`}
          </span>
        ),
      });
    }

    // Bold **text** — process BEFORE inline code, recursively handle nested patterns
    const boldRegex = /\*\*(.+?)\*\*/g;
    let m: RegExpExecArray | null;
    while ((m = boldRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        // Recursively render inner content to support nested patterns like **Delete `code`**
        const innerContent = m[1];
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <strong key={key++}>{renderInlineInner(innerContent)}</strong>,
        });
      }
    }

    // Italic *text* — process BEFORE inline code, exclude ** by checking neighbors
    const italicRegex = /\*([^*]+)\*/g;
    while ((m = italicRegex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Skip if this is part of a ** sequence
      const prevChar = text[start - 1];
      const nextChar = text[end];
      if (prevChar === '*' || nextChar === '*') {
        continue; // Part of bold **text** pattern
      }
      if (noOverlap(start, end)) {
        // Recursively render inner content
        const innerContent = m[1];
        matches.push({
          start,
          end,
          element: <em key={key++}>{renderInlineInner(innerContent)}</em>,
        });
      }
    }

    // Inline code `text` — process AFTER bold/italic so container elements handle their own nested code
    const codeRegex = /`([^`]+)`/g;
    while ((m = codeRegex.exec(text)) !== null) {
      // Skip if this inline code is inside a bold/italic match (already handled by renderInlineInner)
      if (!isInsideMatch(m.index) && noOverlap(m.index, m.index + m[0].length)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <code key={key++} className={styles.inlineCode}>{m[1]}</code>,
        });
      }
    }

    // Inline checkboxes [ ] or [x] or [X]
    const checkboxRegex = /\[[ xX]\]/g;
    while ((m = checkboxRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        const isChecked = m[0].toLowerCase() === '[x]';
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: (
            <input 
              key={key++}
              type="checkbox" 
              checked={isChecked} 
              readOnly 
              className={styles.mdCheckboxInline}
            />
          ),
        });
      }
    }

    // Links [text](url) — recursively process link text for inline code
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        const linkText = m[1];
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer">{renderInlineInner(linkText)}</a>,
        });
      }
    }

    if (matches.length === 0) return text;

    matches.sort((a, b) => a.start - b.start);

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    for (const match of matches) {
      // Skip overlapping matches (can happen with the lazy regexes)
      if (match.start < lastEnd) continue;
      if (match.start > lastEnd) parts.push(text.slice(lastEnd, match.start));
      parts.push(match.element);
      lastEnd = match.end;
    }
    if (lastEnd < text.length) parts.push(text.slice(lastEnd));

    return <>{parts}</>;
  };

  return <div className={styles.markdown}>{renderMarkdown(content)}</div>;
}

// Component to display file operations for approval
function FileOperationPreview({ operation, onApprove, onReject }: { 
  operation: FileOperation; 
  onApprove?: () => void; 
  onReject?: () => void; 
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { openAIDiff } = useEditorStore();

  const languageFromPath = (p: string): string => {
    const ext = (p.split('.').pop() || '').toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      yml: 'yaml',
      yaml: 'yaml',
      json: 'json',
      md: 'markdown',
      sh: 'bash',
      gradle: 'gradle',
      groovy: 'groovy',
      properties: 'properties',
      xml: 'xml',
      toml: 'toml',
    };
    return map[ext] || ext || 'text';
  };

  const getOperationTitle = () => {
    switch (operation.type) {
      case 'create': return `Create ${operation.path}`;
      case 'edit': return `Edit ${operation.path}`;
      case 'delete': return `Delete ${operation.path}`;
    }
  };

  const getOperationIcon = () => {
    switch (operation.type) {
      case 'create': return '+';
      case 'edit': return '~';
      case 'delete': return '-';
    }
  };

  const handleViewInEditor = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { currentWorkspace } = useWorkspaceStore.getState();
    if (!currentWorkspace) return;

    const diffPayload = await buildAIOperationDiffFromDisk(currentWorkspace.rootPath, operation);
    openAIDiff(
      operation.path,
      diffPayload.oldContent,
      diffPayload.newContent,
      diffPayload.operationType,
      diffPayload.requiresOverwrite,
      false
    );
  };
  
  const getLineStats = () => {
    if (operation.type === 'create' && operation.content) {
      return `+${operation.content.split('\n').length}`;
    }
    if (operation.type === 'edit') {
      const added = operation.newContent?.split('\n').length || 0;
      const removed = operation.oldContent?.split('\n').length || 0;
      return `+${added} -${removed}`;
    }
    return '';
  };

  const renderCodeBlock = (content: string | undefined, className: string) => {
    if (!content) return null;

    return (
      <div className={styles.codeBlockWrapper}>
        <CodeBlock
          code={content}
          language={languageFromPath(operation.path)}
          filename={operation.path}
          isDiff={false}
        />
      </div>
    );
  };

  const fileName = operation.path.split('/').pop() || operation.path;
  const filePath = operation.path.includes('/') 
    ? operation.path.substring(0, operation.path.lastIndexOf('/'))
    : '';

  return (
    <div className={styles.fileOpPreview}>
      <div className={styles.fileOpHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={`${styles.fileOpIcon} ${styles[`fileOp${operation.type}`]}`}>
          {getOperationIcon()}
        </span>
        <span className={styles.fileOpTitle}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{filePath && `${filePath}/`}</span>
          {fileName}
          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.5 }}>{getLineStats()}</span>
        </span>
        <button 
          className={styles.fileOpViewBtn}
          onClick={handleViewInEditor}
          title="Open git diff"
        >
          <ExternalLink size={12} />
          View Diff
        </button>
        <span className={styles.fileOpExpand}>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {operation.invalidReason && (
        <div className={styles.fileOpInvalid}>
          <AlertTriangle size={12} />
          <span>{operation.invalidReason}</span>
        </div>
      )}
      {isExpanded && (
        <>
          {operation.type === 'create' && (
            <div className={styles.fileOpContent}>
              {renderCodeBlock(operation.content, styles.fileOpCode)}
            </div>
          )}
          {operation.type === 'edit' && operation.mode === 'replace' && (
            <div className={styles.fileOpDiff}>
              <div className={styles.fileOpDiffSection}>
                <div className={styles.fileOpDiffLabel}>
                  <span style={{ color: '#ef9a9a' }}>−</span> Current
                </div>
                {renderCodeBlock(operation.oldContent, styles.fileOpDiffOld)}
              </div>
              <div className={styles.fileOpDiffSection}>
                <div className={styles.fileOpDiffLabel}>
                  <span style={{ color: '#a5d6a7' }}>+</span> Proposed
                </div>
                {renderCodeBlock(operation.newContent, styles.fileOpDiffNew)}
              </div>
            </div>
          )}
          {operation.type === 'edit' && operation.mode === 'insert' && (
            <div className={styles.fileOpContent}>
              <div className={styles.fileOpInsertInfo}>Insert at line {operation.line}:</div>
              {renderCodeBlock(operation.newContent, styles.fileOpCode)}
            </div>
          )}
          {onApprove && onReject && (
            <div className={styles.fileOpActions}>
              <button className={styles.fileOpApprove} onClick={onApprove} disabled={Boolean(operation.invalidReason)}>
                Apply
              </button>
              <button className={styles.fileOpReject} onClick={onReject}>
                Reject
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Group operations by file path
interface GroupedFileOperation {
  path: string; // canonical workspace-relative path (normalized)
  operations: { op: PendingFileOperation; originalIndex: number }[];
  totalAdded: number;
  totalRemoved: number;
  allApplied: boolean;
  anyApplied: boolean;
}

function sanitizeOperationPath(rawPath: string): string {
  // Remove invisible/control characters that can sneak into model output and
  // cause "duplicate" entries + invalid path errors.
  return (rawPath || '')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize odd unicode spaces to regular spaces (then trim).
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .trim()
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\/+/, '');
}

function canonicalizeOperationPath(opPath: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return opPath;
  const cleaned = sanitizeOperationPath(opPath);
  const relativePath = resolveWorkspaceRelativePath(workspaceRoot, cleaned);
  return normalizeRepoRelativePath(workspaceRoot, relativePath);
}

function groupOperationsByFile(operations: PendingFileOperation[], workspaceRoot?: string): GroupedFileOperation[] {
  const groupMap = new Map<string, GroupedFileOperation>();
  
  operations.forEach((op, index) => {
    const path = canonicalizeOperationPath(op.operation.path, workspaceRoot);
    if (!groupMap.has(path)) {
      groupMap.set(path, {
        path,
        operations: [],
        totalAdded: 0,
        totalRemoved: 0,
        allApplied: true,
        anyApplied: false,
      });
    }
    const group = groupMap.get(path)!;
    group.operations.push({ op, originalIndex: index });
    
    // Aggregate line counts
    if (op.operation.type === 'edit' && op.operation.newContent && op.operation.oldContent) {
      const added = op.operation.newContent.split('\n').length;
      const removed = op.operation.oldContent.split('\n').length;
      group.totalAdded += added;
      group.totalRemoved += removed;
    } else if (op.operation.type === 'create' && op.operation.content) {
      group.totalAdded += op.operation.content.split('\n').length;
    }
    
    // Track applied status
    if (!op.applied) group.allApplied = false;
    if (op.applied) group.anyApplied = true;
  });
  
  return Array.from(groupMap.values());
}

// Unified File Operations Control Bar
function FileOperationsBar({ 
  operations, 
  workspaceRoot,
  expanded,
  onToggleExpanded,
  onKeepAll, 
  onUndoAll, 
  onSoftUndoAll,
  onReview,
  onViewAll,
  onDismiss,
  onViewFile,
  onAcceptFile,
  onUndoFile,
  isProcessing = false,
}: { 
  operations: PendingFileOperation[];
  workspaceRoot?: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onKeepAll: () => void;
  onUndoAll: () => void;
  onSoftUndoAll: () => void;
  onReview: () => void;
  onViewAll: () => void;
  onDismiss: () => void;
  onViewFile: (path: string) => void;
  onAcceptFile: (index: number) => void;
  onUndoFile: (index: number) => void;
  isProcessing?: boolean;
}) {
  if (operations.length === 0) return null;

  // Group operations by file path
  const groupedOps = groupOperationsByFile(operations, workspaceRoot);
  const fileCount = groupedOps.length;
  const appliedFileCount = groupedOps.filter(g => g.allApplied).length;
  
  // Count operations that can actually be auto-applied (not already applied, not requiring overwrite, not invalid)
  const canAutoApplyCount = operations.filter(op => 
    !op.applied && !op.requiresOverwrite && !op.operation.invalidReason
  ).length;
  
  const pendingCount = fileCount - appliedFileCount;

  // If all operations are applied, show a dismiss option instead of hiding completely
  const allApplied = appliedFileCount === fileCount && fileCount > 0;

  if (operations.length === 0) return null;

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'create': return '↓';
      case 'edit': return '↓';
      case 'delete': return '↓';
      default: return '↓';
    }
  };

  const getFileIconClass = (type: string) => {
    switch (type) {
      case 'create': return styles.fileIconCreate;
      case 'edit': return styles.fileIconEdit;
      case 'delete': return styles.fileIconDelete;
      default: return '';
    }
  };

  const getLineStats = (operation: FileOperation) => {
    if (operation.type === 'create' && operation.content) {
      const lines = operation.content.split('\n').length;
      return `+${lines}`;
    }
    if (operation.type === 'edit') {
      const added = operation.newContent?.split('\n').length || 0;
      const removed = operation.oldContent?.split('\n').length || 0;
      return `+${added} -${removed}`;
    }
    if (operation.type === 'delete') {
      return '';
    }
    return '';
  };

  const getFileName = (path: string) => {
    return path.split('/').pop() || path;
  };

  const buildUniqueDisplayPaths = (paths: string[]) => {
    const cleanedPaths = paths.map((p) => sanitizeOperationPath(p));
    const partsByPath = new Map<string, string[]>();
    cleanedPaths.forEach((p) => {
      partsByPath.set(p, p.split('/').filter(Boolean));
    });

    const result = new Map<string, string>();
    const minLen = 2;
    const maxLen = Math.max(1, ...cleanedPaths.map((p) => (partsByPath.get(p) || []).length));

    for (let len = minLen; len <= maxLen; len++) {
      const counts = new Map<string, number>();
      cleanedPaths.forEach((p) => {
        if (result.has(p)) return;
        const parts = partsByPath.get(p) || [];
        const sliceLen = Math.min(len, parts.length);
        const suffix = parts.slice(Math.max(0, parts.length - sliceLen)).join('/');
        counts.set(suffix, (counts.get(suffix) || 0) + 1);
      });

      cleanedPaths.forEach((p) => {
        if (result.has(p)) return;
        const parts = partsByPath.get(p) || [];
        const sliceLen = Math.min(len, parts.length);
        const suffix = parts.slice(Math.max(0, parts.length - sliceLen)).join('/');
        if ((counts.get(suffix) || 0) === 1) {
          result.set(p, suffix || p);
        }
      });
    }

    // Fallback to full path for any remaining collisions.
    cleanedPaths.forEach((p) => {
      if (!result.has(p)) result.set(p, p);
    });

    return result;
  };

  const displayPathByCanonical = buildUniqueDisplayPaths(groupedOps.map((g) => g.path));

  // Show batch actions only if there are pending operations
  const showBatchActions = pendingCount > 0;
  // Disable Keep All if there's nothing that can be auto-applied
  const canKeepAll = canAutoApplyCount > 0;

  return (
    <div className={styles.fileOpsBar}>
      <div className={styles.fileOpsBarHeader} onClick={onToggleExpanded}>
        <div className={styles.fileOpsBarHeaderLeft}>
          <span className={styles.fileOpsBarChevron}>{expanded ? '▼' : '▶'}</span>
          <span className={styles.fileOpsBarText}>
            {fileCount} {fileCount === 1 ? 'File' : 'Files'}
            {allApplied ? ' (All Applied)' : appliedFileCount > 0 ? ` (${appliedFileCount} applied)` : ''}
          </span>
        </div>
        {allApplied ? (
          <div className={styles.fileOpsBarActions}>
            <button
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              title="Dismiss file operations"
              disabled={isProcessing}
            >
              Dismiss
            </button>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onUndoAll(); }}
              title="Undo All"
              disabled={isProcessing}
            >
              Undo All
            </button>
            <button
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onSoftUndoAll(); }}
              title="Soft undo (restore pre-apply content only)"
              disabled={isProcessing}
            >
              Soft Undo
            </button>
            <button
              className={`${styles.fileOpsBarBtn} ${styles.fileOpsBarBtnPrimary}`}
              onClick={(e) => { e.stopPropagation(); onViewAll(); }}
              title="View All Changes"
              disabled={isProcessing}
            >
              View All
            </button>
          </div>
        ) : showBatchActions && (
          <div className={styles.fileOpsBarActions}>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onUndoAll(); }}
              title="Undo All"
              disabled={isProcessing}
            >
              Undo All
            </button>
            <button
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onSoftUndoAll(); }}
              title="Soft undo (restore pre-apply content only)"
              disabled={isProcessing}
            >
              Soft Undo
            </button>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onKeepAll(); }}
              title={canKeepAll ? "Keep All" : "No operations can be auto-applied"}
              disabled={isProcessing || !canKeepAll}
            >
              Keep All
            </button>
            <button 
              className={`${styles.fileOpsBarBtn} ${styles.fileOpsBarBtnPrimary}`}
              onClick={(e) => { e.stopPropagation(); onViewAll(); }}
              title="View All Changes"
              disabled={isProcessing}
            >
              View All
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className={styles.fileOpsList}>
          {groupedOps.map((group, groupIndex) => (
            <div 
              key={groupIndex} 
              className={`${styles.fileOpsItem} ${group.allApplied ? styles.fileOpsItemApplied : ''}`}
              onClick={() => onViewFile(group.path)}
            >
              <span className={`${styles.fileOpsItemIcon} ${getFileIconClass(group.operations[0].op.operation.type)}`}>
                {getFileIcon(group.operations[0].op.operation.type)}
              </span>
              <span className={styles.fileOpsItemName}>
                <span title={group.path}>
                  {displayPathByCanonical.get(sanitizeOperationPath(group.path)) || group.path}
                </span>
              </span>
              <span className={styles.fileOpsItemStats}>
                {group.totalAdded > 0 && <span style={{ color: '#4caf50' }}>+{group.totalAdded}</span>}
                {group.totalAdded > 0 && group.totalRemoved > 0 && ' '}
                {group.totalRemoved > 0 && <span style={{ color: '#f44336' }}>-{group.totalRemoved}</span>}
              </span>
              <div className={styles.fileOpsItemActions}>
                {!group.allApplied ? (
                  <>
                    <button
                      className={styles.fileOpsItemBtnAccept}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Accept all operations for this file
                        group.operations.forEach(({ originalIndex }) => {
                          if (!operations[originalIndex].applied) {
                            onAcceptFile(originalIndex);
                          }
                        });
                      }}
                      title="Accept"
                      disabled={isProcessing}
                    >
                      ✓
                    </button>
                    <button
                      className={styles.fileOpsItemBtnReject}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Reject all operations for this file
                        group.operations.forEach(({ originalIndex }) => {
                          if (!operations[originalIndex].applied) {
                            onUndoFile(originalIndex);
                          }
                        });
                      }}
                      title="Reject"
                      disabled={isProcessing}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.fileOpsItemBtnUndo}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Undo all operations for this file
                      group.operations.forEach(({ originalIndex }) => {
                        if (operations[originalIndex].applied) {
                          onUndoFile(originalIndex);
                        }
                      });
                    }}
                    title="Undo"
                    disabled={isProcessing}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AIPanel() {
  const {
    config,
    activeConversation,
    conversations,
    isStreaming,
    thinkingStatus,
    streamContinuationPending,
    autoContinuePending,
    promptQueue,
    agentMode,
    agentTasks,
    webAccessStatus,
    webAccessTraces,
    pendingQuestions,
    questionBlockingStream,
    setPendingQuestions,
    answerQuestion,
    clearPendingQuestions,
    setQuestionBlockingStream,
    sessionUsage,
    lastMessageUsage,
    contextBreakdown,
    toggleWebAccessTraceExpanded,
    createConversation,
    setActiveConversation,
    setAgentMode,
    sendMessage,
    queuePrompt,
    clearQueue,
    stopStreaming,
    finalizeStreaming,
    refreshAvailableModels,
    availableModels,
    copilotModelsMetadata,
    importConversationsFromFile,
    clearAgentTasks,
    updateSessionUsage,
    resetSessionUsage,
    summarizeConversation,
    isSummarizing,
    circularResponseState,
    resetCircularState,
    agentRunsById,
    agentRunOrder,
    agentRunQueue,
    startAgentRun,
    cancelAgentRun,
    clearAgentRuns,
    workspaceWriteLocked,
    workspaceWriteLockQueue,
  } = useAIStore();

  const { currentWorkspace } = useWorkspaceStore();
  const { setShowEditorPanel } = useLayoutStore();
  const { openDiff, openAIDiff } = useEditorStore();
  const { aiAutoApplyFileOps } = useSettingsStore();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showContextBreakdown, setShowContextBreakdown] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const [allPendingOps, setAllPendingOps] = useState<PendingFileOperation[]>([]);
  const [fileOpsExpanded, setFileOpsExpanded] = useState(true);
  const [showFileOps, setShowFileOps] = useState(false);
  const [isFileOpsProcessing, setIsFileOpsProcessing] = useState(false);
  const [showProcessingIndicator, setShowProcessingIndicator] = useState(false);
  const [pendingResponse, setPendingResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const subagentProfiles = config.subagentProfiles || [];
  const [selectedSubagentProfileId, setSelectedSubagentProfileId] = useState<string>(
    config.defaultSubagentProfileId || subagentProfiles[0]?.id || ''
  );

  useEffect(() => {
    const next = config.defaultSubagentProfileId || subagentProfiles[0]?.id || '';
    if (!selectedSubagentProfileId || !subagentProfiles.some(p => p.id === selectedSubagentProfileId)) {
      setSelectedSubagentProfileId(next);
    }
  }, [config.defaultSubagentProfileId, subagentProfiles, selectedSubagentProfileId]);

  useEffect(() => {
    if (!previewImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { deleteConversation, importConversationsFromPath } = useAIStore();
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollRef = useRef(0);
  const lastAutoSummaryMessageIdRef = useRef<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const autoApplyInFlightRef = useRef(false);
  const lastAutoApplyKeyRef = useRef<string | null>(null);
  const autoApplyArmedRef = useRef(false);
  const verifyOpsInFlightRef = useRef(false);
  const lastPendingOpsCountRef = useRef(0);
  const autoScrollLockRef = useRef(true);
  const [hasReviewedPendingOps, setHasReviewedPendingOps] = useState(false);
  const hasQueuedPrompts = promptQueue.length > 0;
  const displayThinkingStatus = autoContinuePending ? null : thinkingStatus;
  const processingLabel = displayThinkingStatus?.trim()
    || (isStreaming
      ? 'Generating response...'
      : (pendingResponse || streamContinuationPending || autoContinuePending
        ? 'Waiting for model...'
        : (hasQueuedPrompts ? `Queued prompt${promptQueue.length > 1 ? 's' : ''} pending...` : '')));
  const showProcessingStatus = Boolean(processingLabel);
  const showQueueIcon = showProcessingStatus
    && !isStreaming
    && !displayThinkingStatus
    && !pendingResponse
    && !streamContinuationPending
    && !autoContinuePending
    && hasQueuedPrompts;
  const hasFileOps = allPendingOps.length > 0;
  const buildQueuePreview = useCallback((content: string): React.ReactNode => {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '';
    const match = trimmed.match(SEVERITY_PATTERN);
    if (!match) {
      const plain = trimmed.slice(0, 60);
      return trimmed.length > 60 ? `${plain}...` : plain;
    }

    const severity = match[1].toUpperCase();
    const suffix = match[2] ? ` / ${match[2].toUpperCase()}` : '';
    let remainder = trimmed.replace(match[0], '').replace(/\*\*/g, '').trim();
    remainder = remainder.replace(/^\s*[:\-–—]\s*/, '');
    const previewText = remainder.slice(0, 60);
    const preview = remainder.length > 60 ? `${previewText}...` : previewText;

    return (
      <>
        <span className={`${styles.severityBadge} ${getSeverityClassName(severity)}`}>
          {`${severity}${suffix}`}
        </span>
        <span className={styles.queuePreviewText}>{preview}</span>
      </>
    );
  }, []);

  const getModelContextLimit = (model: string) => {
    const lower = model.toLowerCase();
    if (lower.includes('128k')) return 128000;
    if (lower.includes('64k')) return 64000;
    if (lower.includes('32k')) return 32000;
    if (lower.includes('16k')) return 16000;
    if (lower.includes('8k')) return 8000;
    return 32000;
  };

  useEffect(() => {
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }

    if (displayThinkingStatus) {
      setShowProcessingIndicator(true);
    } else if (isStreaming) {
      processingTimerRef.current = setTimeout(() => {
        setShowProcessingIndicator(true);
      }, 1200);
    } else if (pendingResponse || streamContinuationPending || autoContinuePending) {
      processingTimerRef.current = setTimeout(() => {
        setShowProcessingIndicator(true);
      }, 600);
    } else {
      setShowProcessingIndicator(false);
    }

    return () => {
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    };
  }, [isStreaming, displayThinkingStatus, pendingResponse, streamContinuationPending, autoContinuePending]);

  useEffect(() => {
    if (isStreaming || displayThinkingStatus || autoContinuePending) {
      setPendingResponse(false);
    }
  }, [isStreaming, displayThinkingStatus, autoContinuePending]);

  useEffect(() => {
    if (!aiAutoApplyFileOps) {
      autoApplyArmedRef.current = false;
      return;
    }
    if (pendingResponse || isStreaming) {
      autoApplyArmedRef.current = true;
    }
  }, [pendingResponse, isStreaming, aiAutoApplyFileOps]);

  useEffect(() => {
    if (allPendingOps.length > 0) {
      setHasReviewedPendingOps(false);
    }
  }, [allPendingOps]);

  useEffect(() => {
    const prevCount = lastPendingOpsCountRef.current;
    const nextCount = allPendingOps.length;
    if (nextCount > 0 && prevCount === 0) {
      setShowFileOps(true);
    }
    lastPendingOpsCountRef.current = nextCount;
  }, [allPendingOps.length]);

  // Listen for file-op-applied events from AIDiffEditor (when user clicks Overwrite/Apply)
  useEffect(() => {
    const handleFileOpApplied = (e: Event) => {
      const customEvent = e as CustomEvent<{ filePath: string; operationType: string }>;
      const { filePath } = customEvent.detail;
      
      setAllPendingOps(prev => prev.map(op => {
        // Match by normalized path
        const opPath = canonicalizeOperationPath(op.operation.path, currentWorkspace?.rootPath);
        const eventPath = canonicalizeOperationPath(filePath, currentWorkspace?.rootPath);
        if (opPath === eventPath) {
          return { ...op, applied: true, requiresOverwrite: false, wasSkipped: false };
        }
        return op;
      }));
    };
    
    window.addEventListener('file-op-applied', handleFileOpApplied);
    return () => window.removeEventListener('file-op-applied', handleFileOpApplied);
  }, [currentWorkspace?.rootPath]);

  useEffect(() => {
    if (!aiAutoApplyFileOps) return;
    if (!autoApplyArmedRef.current) return;
    if (isStreaming || autoApplyInFlightRef.current) return;
    if (allPendingOps.length === 0) return;

    const pending = allPendingOps.filter((op) => !op.applied);
    if (pending.length === 0) return;

    const applyKey = pending.map((op) => `${op.messageId}:${op.operation.type}:${op.operation.path}`).join('|');
    if (lastAutoApplyKeyRef.current === applyKey) return;

    lastAutoApplyKeyRef.current = applyKey;
    autoApplyInFlightRef.current = true;

    setTimeout(() => {
      void handleKeepAllOperations({ skipReview: true }).finally(() => {
        autoApplyInFlightRef.current = false;
        autoApplyArmedRef.current = false;
      });
    }, 200);
  }, [allPendingOps, isStreaming]);

  useEffect(() => {
    if (!activeConversation || !lastMessageUsage) return;
    if (isStreaming || isSummarizing) return;

    const contextLimit = getModelContextLimit(config.model);
    if (!contextLimit) return;

    const usageRatio = lastMessageUsage.totalTokens / contextLimit;
    const lastMessageId = activeConversation.messages[activeConversation.messages.length - 1]?.id;

    if (!lastMessageId || lastAutoSummaryMessageIdRef.current === lastMessageId) return;

    if (usageRatio >= 0.8) {
      lastAutoSummaryMessageIdRef.current = lastMessageId;
      summarizeConversation('auto');
    }
  }, [activeConversation, lastMessageUsage, isStreaming, isSummarizing, config.model, summarizeConversation]);

  // Verify and update applied status of pending operations based on actual file state
  useEffect(() => {
    if (!currentWorkspace || allPendingOps.length === 0) return;
    if (verifyOpsInFlightRef.current) return;
    verifyOpsInFlightRef.current = true;

    const verifyOperationsStatus = async () => {
      let hasChanges = false;
      let updatedOps = [...allPendingOps];
      let statusPaths: string[] = [];
      let hasStatusPaths = false;

      const matchesStatusPath = (opPath: string) => {
        if (statusPaths.length === 0) return false;
        const normalizedOpPath = normalizeRepoRelativePath(currentWorkspace.rootPath, opPath);
        return statusPaths.some((path) => {
          const normalizedStatus = normalizeRepoRelativePath(currentWorkspace.rootPath, path);
          return normalizedStatus === normalizedOpPath
            || normalizedStatus.endsWith(`/${normalizedOpPath}`)
            || normalizedOpPath.endsWith(`/${normalizedStatus}`);
        });
      };

      try {
        const isRepo = await git.isGitRepo(currentWorkspace.rootPath);
        if (isRepo) {
          const status = await git.status(currentWorkspace.rootPath);
          statusPaths = [
            ...status.staged.map((entry) => entry.path),
            ...status.unstaged.map((entry) => entry.path),
            ...status.untracked.map((entry) => entry.path),
          ];
          hasStatusPaths = statusPaths.length > 0;
        }
      } catch (error) {
        console.warn('Failed to check git status for file ops:', error);
      }
      for (let i = 0; i < updatedOps.length; i++) {
        const item = updatedOps[i];
        const { fullPath, error } = normalizeOperationPath(
          item.operation.path,
          currentWorkspace.rootPath
        );
        if (error) {
          updatedOps[i] = {
            ...item,
            applied: false,
            wasSkipped: true,
            errorMessage: error,
            operation: { ...item.operation, invalidReason: error },
          };
          hasChanges = true;
          continue;
        }
        try {
          let shouldApply = false;
          let requiresOverwrite = false;
          if (item.operation.type === 'create') {
            const exists = await fs.pathExists(fullPath);
            if (exists) {
              const onDisk = await fs.readFile(fullPath);
              const normalizedDisk = normalizeContentForCompare(onDisk);
              const normalizedIncoming = normalizeContentForCompare(item.operation.content || '');
              shouldApply = normalizedDisk === normalizedIncoming && normalizedIncoming.length > 0;
              requiresOverwrite = !shouldApply && normalizedIncoming.length > 0;
            }
          } else if (item.operation.type === 'delete') {
            const exists = await fs.pathExists(fullPath);
            shouldApply = !exists;
          } else if (item.operation.type === 'edit') {
            const onDisk = await fs.readFile(fullPath);
            const { changed, reason } = applyEditOperation(onDisk, item.operation);
            shouldApply = !changed && reason === 'already-applied';
          }

          if (shouldApply && !item.applied) {
            updatedOps[i] = { ...item, applied: true, wasSkipped: true, requiresOverwrite: false };
            hasChanges = true;
          } else if (!shouldApply && item.applied) {
            updatedOps[i] = { ...item, applied: false, wasSkipped: true, requiresOverwrite };
            hasChanges = true;
          } else if (!shouldApply && !item.applied && item.requiresOverwrite !== requiresOverwrite) {
            updatedOps[i] = { ...item, requiresOverwrite };
            hasChanges = true;
          }
        } catch (err) {
          console.error('Error checking file existence:', err);
          if (item.applied) {
            updatedOps[i] = { ...item, applied: false, wasSkipped: true };
            hasChanges = true;
          }
        }
      }

      if (hasStatusPaths) {
        // Remove applied operations that are no longer present in git status
        const prunedOps = updatedOps.filter((item) => {
          if (!item.applied) return true;
          return matchesStatusPath(item.operation.path);
        });
        if (prunedOps.length !== updatedOps.length) {
          updatedOps = prunedOps;
          hasChanges = true;
        }
      }

      // Update state if any operations were marked as applied
      if (hasChanges) {
        setAllPendingOps(updatedOps);
      }
    };

    // Run verification after a short delay to ensure operations are loaded
    const timeoutId = setTimeout(() => {
      void verifyOperationsStatus().finally(() => {
        verifyOpsInFlightRef.current = false;
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      verifyOpsInFlightRef.current = false;
    };
  }, [currentWorkspace?.rootPath, activeConversation?.id, allPendingOps]);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 150;
  }, []);

  const updateScrollLock = useCallback(() => {
    autoScrollLockRef.current = isNearBottom();
  }, [isNearBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current;
    if (!container || container.offsetParent === null) return;
    if (behavior === 'smooth') {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!autoScrollLockRef.current) return;
    const now = Date.now();
    const runScroll = () => {
      scrollToBottom(behavior);
      lastScrollRef.current = Date.now();
      scrollTimerRef.current = null;
    };
    if (now - lastScrollRef.current < 80) {
      if (scrollTimerRef.current) return;
      scrollTimerRef.current = setTimeout(runScroll, 80);
      return;
    }
    runScroll();
  }, [scrollToBottom]);

  // Throttled auto-scroll while near bottom
  useEffect(() => {
    scheduleScrollToBottom('auto');
  }, [activeConversation?.messages, scheduleScrollToBottom]);

  useEffect(() => {
    setShowFileOps(false);
    setAllPendingOps([]);
    autoScrollLockRef.current = true;
    scheduleScrollToBottom('auto');
  }, [activeConversation?.id, scheduleScrollToBottom]);

  const resetScrollLock = useCallback(() => {
    scheduleScrollToBottom('smooth');
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    updateScrollLock();
  }, [updateScrollLock]);

  // Auto-resize textarea based on content
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
    }
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // Auto-resize textarea on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      resizeTextarea();
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [resizeTextarea]);

  // Listen for prefill-ai-input events from MonacoEditor/CodeBlock (line number context menu)
  useEffect(() => {
    const handlePrefillInput = (e: Event) => {
      const customEvent = e as CustomEvent<{
        action: 'review' | 'ask' | 'research';
        lineNumber: number;
        lineContent: string;
        filename?: string;
        language?: string;
        startNewConversation?: boolean;
      }>;
      const { action, lineNumber, lineContent, filename, language, startNewConversation } = customEvent.detail;
      
      // Create new conversation if requested
      if (startNewConversation) {
        createConversation();
      }
      
      // Build a clean, user-friendly prompt for the input
      const actionLabel = action === 'review' ? 'Review' : action === 'ask' ? 'Question about' : 'Research';
      const fileInfo = filename ? ` (${filename}${language ? `, ${language}` : ''})` : '';
      const codeBlock = `\`\`\`${language || ''}\n${lineContent}\n\`\`\``;
      
      // Pre-fill with a clean format - user can add their context
      const prefillText = `${actionLabel} line ${lineNumber}${fileInfo}:\n\n${codeBlock}\n\n`;
      
      setInput(prefillText);
      setTimeout(() => {
        resizeTextarea();
        // Focus the textarea and move cursor to end
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = textareaRef.current.value.length;
          textareaRef.current.selectionEnd = textareaRef.current.value.length;
        }
      }, 100);
    };
    
    window.addEventListener('prefill-ai-input', handlePrefillInput);
    return () => window.removeEventListener('prefill-ai-input', handlePrefillInput);
  }, [createConversation, resizeTextarea]);

  useEffect(() => {
    if (config.provider === 'ollama' || config.provider === 'copilot') {
      refreshAvailableModels();
    }
  }, [config.provider, refreshAvailableModels]);

  // Watch for Copilot login status changes and refresh models when logged in
  useEffect(() => {
    if (config.provider !== 'copilot') return;

    let isActive = true;
    let lastLoggedIn: boolean | null = null;

    const checkLoginAndRefresh = async () => {
      try {
        const status = await ai.copilotLoginStatus();
        if (!isActive) return;
        
        // Only refresh if login status changed to true
        if (status.logged_in && lastLoggedIn !== true) {
          console.log('[AIPanel] Copilot login detected, refreshing models...');
          refreshAvailableModels();
        }
        lastLoggedIn = status.logged_in;
      } catch {
        // Ignore errors
      }
    };

    // Check immediately and then periodically (in case login happens in settings modal)
    checkLoginAndRefresh();
    const interval = setInterval(checkLoginAndRefresh, 3000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [config.provider, refreshAvailableModels]);

  // Listen for token usage events and update session tracking
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      await usage.initDb();
      unlisten = await listenForTokenUsage((event) => {
        const messageUsage = {
          promptTokens: event.prompt_tokens,
          completionTokens: event.completion_tokens,
          totalTokens: event.total_tokens,
          cacheCreationTokens: event.cache_creation_tokens,
          cacheReadTokens: event.cache_read_tokens,
          estimatedCostUsd: event.estimated_cost_usd,
        };
        updateSessionUsage(messageUsage);
        
        // Record to persistent storage
        usage.recordUsage(
          event.model,
          event.provider,
          event.prompt_tokens,
          event.completion_tokens,
          event.cache_creation_tokens,
          event.cache_read_tokens,
          event.estimated_cost_usd
        );

        // If the stream ended without a final done chunk, use token usage as a fallback completion signal.
        const { isStreaming: isStreamingNow, streamContinuationPending } = useAIStore.getState();
        if (isStreamingNow && !streamContinuationPending) {
          finalizeStreaming();
        }
      });
    };
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [updateSessionUsage]);

  // Reset session usage when conversation changes
  useEffect(() => {
    resetSessionUsage();
  }, [activeConversation?.id, resetSessionUsage]);

  const isVisionModel = useCallback(() => {
    if (config.provider === 'openai' || config.provider === 'claude') {
      return true; // OpenAI and Claude support vision
    }
    if (config.provider === 'copilot') {
      return true;
    }
    if (config.provider === 'ollama') {
      const modelLower = config.model.toLowerCase();
      return modelLower.includes('llava') || 
             modelLower.includes('bakllava') || 
             modelLower.includes('qwen2-vl') || 
             modelLower.includes('qwen-vl') ||
             modelLower.includes('qwen3-vl') ||
             modelLower.includes('qwenvl') ||
             modelLower.includes('vision') ||
             modelLower.includes('minicpm-v') ||
             modelLower.includes('paligemma') ||
             modelLower.includes('deepseek-vl') ||
             modelLower.includes('moondream');
    }
    return false;
  }, [config.provider, config.model]);

  const handleAttachClick = async () => {
    console.log('[AIPanel] handleAttachClick called, isVisionModel:', isVisionModel());
    if (!isVisionModel()) {
      const shouldContinue = window.confirm(
        `⚠️ Vision Support Not Available\n\n` +
        `The current model "${config.model}" does not support images.\n\n` +
        `To use images, install and switch to a vision model:\n\n` +
        `Ollama Vision Models:\n` +
        `• ollama pull qwen-vl      (Qwen Vision - check latest version)\n` +
        `• ollama pull llava        (LLaVA - popular choice)\n` +
        `• ollama pull paligemma    (Google PaliGemma)\n` +
        `• ollama pull bakllava     (BakLLaVA variant)\n` +
        `• ollama pull minicpm-v    (MiniCPM Vision)\n\n` +
        `OpenAI: gpt-4o, gpt-4-turbo\n` +
        `Claude: Any Claude 3+ model\n` +
        `Copilot: Any model\n\n` +
        `Do you want to open Settings to change the model?`
      );
      
      if (shouldContinue) {
        setShowSettings(true);
      }
      return;
    }
    
    // Use Tauri's dialog API for file selection (more reliable than hidden file input in webview)
    console.log('[AIPanel] Opening file dialog via Tauri API');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'xml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      console.log('[AIPanel] Dialog returned:', selected);
      
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          await handleFilePathUpload(paths);
        }
      }
    } catch (error) {
      console.error('[AIPanel] Failed to open file dialog:', error);
      // Fallback to hidden file input
      console.log('[AIPanel] Falling back to file input click');
      fileInputRef.current?.click();
    }
  };

  const uint8ToBase64 = useCallback((bytes: Uint8Array) => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }, []);

  const getMimeTypeFromName = useCallback((name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      case 'svg':
      case 'svgz':
        return 'image/svg+xml';
      default:
        return 'application/octet-stream';
    }
  }, []);

  const appendAttachments = useCallback((newAttachments: MessageAttachment[]) => {
    console.log('[AIPanel] appendAttachments called with', newAttachments.length, 'attachments');
    newAttachments.forEach(a => console.log('[AIPanel]   -', a.name, a.type));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const readFileAsDataUrl = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    console.log('[AIPanel] handleFileUpload called with', files.length, 'files');
    const fileArray = Array.from(files);
    const newAttachments: MessageAttachment[] = [];

    for (const file of fileArray) {
      console.log('[AIPanel] Processing file:', file.name, 'type:', file.type, 'size:', file.size);
      const mimeType = file.type || getMimeTypeFromName(file.name);
      const isImage = mimeType.startsWith('image/');
      
      if (isImage) {
        try {
          if (typeof file.arrayBuffer === 'function') {
            const buffer = await file.arrayBuffer();
            const base64 = uint8ToBase64(new Uint8Array(buffer));
            const dataUrl = `data:${mimeType};base64,${base64}`;
            newAttachments.push({
              id: crypto.randomUUID(),
              type: 'image',
              name: file.name,
              data: dataUrl,
              mimeType,
              size: file.size,
            });
          } else {
            const dataUrl = await readFileAsDataUrl(file);
            newAttachments.push({
              id: crypto.randomUUID(),
              type: 'image',
              name: file.name,
              data: dataUrl,
              mimeType,
              size: file.size,
            });
          }
        } catch (error) {
          console.error('Failed to read image attachment:', error);
          newAttachments.push({
            id: crypto.randomUUID(),
            type: 'file',
            name: file.name,
            mimeType,
            size: file.size,
          });
        }

      } else {
        // For other files, just store metadata
        newAttachments.push({
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          mimeType,
          size: file.size,
        });
      }
    }

    appendAttachments(newAttachments);
  }, [appendAttachments, getMimeTypeFromName, readFileAsDataUrl, uint8ToBase64]);

  const handleFilePathUpload = useCallback(async (paths: string[]) => {
    console.log('[AIPanel] handleFilePathUpload called with paths:', paths);
    if (paths.length === 0) {
      console.log('[AIPanel] handleFilePathUpload: no paths, returning');
      return;
    }
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const newAttachments: MessageAttachment[] = [];

    for (const path of paths) {
      try {
        console.log('[AIPanel] Processing path:', path);
        const info = await fs.getFileInfo(path);
        console.log('[AIPanel] File info:', info);
        if (!info.is_file) {
          console.log('[AIPanel] Skipping non-file:', path);
          continue;
        }

        const name = path.split('/').pop() || path;
        const mimeType = getMimeTypeFromName(name);
        const isImage = mimeType.startsWith('image/');
        console.log('[AIPanel] File name:', name, 'mimeType:', mimeType, 'isImage:', isImage);

        if (isImage) {
          console.log('[AIPanel] Reading image file...');
          const bytes = await readFile(path);
          console.log('[AIPanel] Read bytes:', bytes?.length || bytes?.byteLength);
          const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          const base64 = uint8ToBase64(uint8);
          const dataUrl = `data:${mimeType};base64,${base64}`;
          console.log('[AIPanel] Created dataUrl, length:', dataUrl.length);

          newAttachments.push({
            id: crypto.randomUUID(),
            type: 'image',
            name,
            data: dataUrl,
            mimeType,
            size: info.size,
          });
        } else {
          newAttachments.push({
            id: crypto.randomUUID(),
            type: 'file',
            name,
            mimeType,
            size: info.size,
          });
        }
        console.log('[AIPanel] Successfully processed file:', name);
      } catch (error) {
        console.error('[AIPanel] Failed to read dropped file:', path, error);
      }
    }

    if (newAttachments.length > 0) {
      appendAttachments(newAttachments);
    }
  }, [appendAttachments, fs, getMimeTypeFromName, uint8ToBase64]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // Don't process files here - Tauri's native drag-drop handles file processing
    // This handler only manages visual state
  };

  useEffect(() => {
    let mounted = true;
    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      console.log('[AIPanel] Setting up Tauri native file drop listeners');
      try {
        const dropUnsub = await appEvents.onFileDrop(async (paths) => {
          console.log('[AIPanel] Tauri file-drop event received, paths:', paths);
          if (!mounted) {
            console.log('[AIPanel] Component unmounted, ignoring drop event');
            return;
          }
          setIsDragging(false);
          await handleFilePathUpload(paths);
        });
        if (mounted) {
          unlistenDrop = dropUnsub;
        } else {
          dropUnsub();
        }

        const hoverUnsub = await appEvents.onFileDropHover((paths) => {
          console.log('[AIPanel] Tauri file-drop-hover event, paths:', paths);
          if (mounted) setIsDragging(true);
        });
        if (mounted) {
          unlistenHover = hoverUnsub;
        } else {
          hoverUnsub();
        }

        const cancelUnsub = await appEvents.onFileDropCancel(() => {
          console.log('[AIPanel] Tauri file-drop-cancelled event');
          if (mounted) setIsDragging(false);
        });
        if (mounted) {
          unlistenCancel = cancelUnsub;
        } else {
          cancelUnsub();
        }

        console.log('[AIPanel] Tauri native file drop listeners set up successfully');
      } catch (error) {
        console.error('[AIPanel] Failed to set up Tauri file drop listeners:', error);
      }
    };

    setup();

    return () => {
      mounted = false;
      unlistenDrop?.();
      unlistenHover?.();
      unlistenCancel?.();
    };
  }, [handleFilePathUpload]);

  useEffect(() => {
    // Only handle visual feedback for drag state
    // File processing is done by Tauri's native drag-drop events
    const handleWindowDragOver = (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(true);
    };
    const handleWindowDragLeave = (event: DragEvent) => {
      event.preventDefault();
      if (event.target === document.documentElement) {
        setIsDragging(false);
      }
    };
    const handleWindowDrop = (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      // Don't process files here - Tauri's native drag-drop handles it
    };

    window.addEventListener('dragover', handleWindowDragOver, true);
    window.addEventListener('dragleave', handleWindowDragLeave, true);
    window.addEventListener('drop', handleWindowDrop, true);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true);
      window.removeEventListener('dragleave', handleWindowDragLeave, true);
      window.removeEventListener('drop', handleWindowDrop, true);
    };
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter(a => a.id !== id));
  };

  const normalizeOperationPath = (opPath: string, workspaceRoot: string) => {
    const cleaned = sanitizeOperationPath(opPath);
    const invalidReason = getInvalidPathReason(cleaned, workspaceRoot);
    if (invalidReason) {
      return { normalizedOpPath: '', fullPath: '', error: invalidReason };
    }
    const normalizedOpPath = normalizeRepoRelativePath(workspaceRoot, cleaned);
    const rootNormalized = workspaceRoot.replace(/\/+$/, '');
    const fullPath = `${rootNormalized}/${normalizedOpPath}`.replace(/\/+/g, '/');
    if (!fullPath.startsWith(`${rootNormalized}/`) && fullPath !== rootNormalized) {
      return { normalizedOpPath, fullPath, error: 'Path is outside the workspace.' };
    }
    return { normalizedOpPath, fullPath };
  };

  const ensureParentDir = async (absoluteFilePath: string, relativePath: string) => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    if (!currentWorkspace) return;

    // Get parent directory from absolute file path
    const lastSlash = absoluteFilePath.lastIndexOf('/');
    if (lastSlash === -1) return;

    const parentDir = absoluteFilePath.substring(0, lastSlash);

    // Check if parent already exists
    const exists = await fs.pathExists(parentDir);
    if (exists) return;

    // Get the relative path parts to build directories
    const pathParts = relativePath.split('/');
    pathParts.pop(); // Remove filename

    // Build directories incrementally from workspace root
    let currentRelativePath = '';
    for (const part of pathParts) {
      if (!part) continue;
      currentRelativePath += (currentRelativePath ? '/' : '') + part;
      const currentAbsolutePath = `${currentWorkspace.rootPath}/${currentRelativePath}`;

      const dirExists = await fs.pathExists(currentAbsolutePath);
      if (!dirExists) {
        console.log(`Creating directory: ${currentAbsolutePath}`);
        await fs.createDirectory(currentAbsolutePath);
      }
    }
  };

  const handleKeepAllOperations = async (options?: { skipReview?: boolean; openFilesAfterApply?: boolean }) => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { openFile } = useEditorStore.getState();
    const openFilesAfterApply = options?.openFilesAfterApply ?? false;
    
    if (!currentWorkspace) {
      console.error('No workspace open');
      return;
    }

    if (!options?.skipReview && !hasReviewedPendingOps) {
      handleReviewOperations();
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: 'Review opened. Click Keep All again to apply.', type: 'info' }
      }));
      return;
    }

    setIsFileOpsProcessing(true);
    await useAIStore.getState().withWorkspaceWriteLock('fileOps.applyAll', async () => {
      let successCount = 0;
      let skippedCount = 0;
      const overwriteRequiredPaths = new Set<string>();
      let invalidCount = 0;
      const updatedOps = [...allPendingOps];

      // Apply all unapplied operations
      for (let i = 0; i < updatedOps.length; i++) {
        const item = updatedOps[i];
        if (item.applied) {
          skippedCount++;
          continue;
        }

        try {
          if (item.operation.invalidReason) {
            updatedOps[i] = {
              ...updatedOps[i],
              operation: { ...item.operation, invalidReason: item.operation.invalidReason },
              applied: false,
              wasSkipped: true,
              errorMessage: item.operation.invalidReason,
            };
            skippedCount++;
            invalidCount++;
            continue;
          }
          // Normalize paths: remove leading slashes from operation path, normalize double slashes
          const { normalizedOpPath, fullPath, error } = normalizeOperationPath(
            item.operation.path,
            currentWorkspace.rootPath
          );
          if (error) {
            updatedOps[i] = {
              ...updatedOps[i],
              operation: { ...item.operation, invalidReason: error },
              applied: false,
              wasSkipped: true,
              errorMessage: error,
            };
            skippedCount++;
            invalidCount++;
            continue;
          }
          console.log(`[FileOps] Workspace root: ${currentWorkspace.rootPath}`);
          console.log(`[FileOps] Operation path (raw): ${item.operation.path}`);
          console.log(`[FileOps] Operation path (normalized): ${normalizedOpPath}`);
          console.log(`[FileOps] Full path: ${fullPath}`);
          
          if (item.operation.type === 'create') {
            // Check if file already exists
            const fileExists = await fs.pathExists(fullPath);
            if (fileExists) {
              const existingContent = await fs.readFile(fullPath);
              const normalizedExisting = normalizeContentForCompare(existingContent);
              const normalizedIncoming = normalizeContentForCompare(item.operation.content || '');
              if (normalizedExisting === normalizedIncoming && normalizedIncoming.length > 0) {
                console.log(`[FileOps] File already exists, content matches: ${item.operation.path}`);
                // Mark as applied even though we skipped it
                updatedOps[i] = { ...updatedOps[i], applied: true, wasSkipped: true, previousExists: true, previousContent: existingContent };
                skippedCount++;
                continue;
              }

              updatedOps[i] = {
                ...updatedOps[i],
                applied: false,
                wasSkipped: true,
                previousExists: true,
                previousContent: existingContent,
                requiresOverwrite: true,
              };
              skippedCount++;
              overwriteRequiredPaths.add(normalizedOpPath);
              continue;
            }
            
            // Ensure parent directory exists
            await ensureParentDir(fullPath, normalizedOpPath);
            console.log(`[FileOps] Writing file: ${fullPath} (${(item.operation.content || '').length} bytes)`);
            await fs.writeFile(fullPath, item.operation.content || '');
            // Verify write succeeded by checking file exists now
            const verifyExists = await fs.pathExists(fullPath);
            console.log(`[FileOps] Write complete: ${fullPath}, verified exists: ${verifyExists}`);
            // Read back the file to double-verify it was written
            try {
              const readBack = await fs.readFile(fullPath);
              const bytesWritten = (item.operation.content || '').length;
              const bytesRead = readBack.length;
              console.log(`[FileOps] Verification: wrote ${bytesWritten} bytes, read back ${bytesRead} bytes`);
              if (bytesRead !== bytesWritten) {
                console.warn(`[FileOps] WARNING: Byte mismatch! File may not have been written correctly.`);
              }
            } catch (readErr) {
              console.error(`[FileOps] FAILED to read back file - it may not have been created:`, readErr);
            }
            // Save to local history
            await history.save(item.operation.path, item.operation.content || '').catch(console.error);
            if (openFilesAfterApply) {
              await openFile(fullPath);
            }
            updatedOps[i] = {
              ...updatedOps[i],
              applied: true,
              previousExists: false,
              previousContent: '',
              wasSkipped: false,
            };
          } else if (item.operation.type === 'edit') {
            const previousContent = await fs.readFile(fullPath);
            const { updatedContent, changed, reason } = applyEditOperation(previousContent, item.operation);

            if (!changed) {
              if (reason === 'already-applied') {
                updatedOps[i] = {
                  ...updatedOps[i],
                  applied: true,
                  previousExists: true,
                  previousContent,
                  wasSkipped: true,
                };
                skippedCount++;
                continue;
              }
              updatedOps[i] = {
                ...updatedOps[i],
                operation: { ...item.operation, invalidReason: 'Edit failed: <old_content> did not match the file.' },
                applied: false,
                previousExists: true,
                previousContent,
                wasSkipped: true,
                errorMessage: 'Edit failed: <old_content> did not match the file.',
              };
              skippedCount++;
              invalidCount++;
              continue;
            }

            await fs.writeFile(fullPath, updatedContent);
            // Save to local history
            await history.save(item.operation.path, updatedContent).catch(console.error);
            if (openFilesAfterApply) {
              await openFile(fullPath);
            }
            updatedOps[i] = {
              ...updatedOps[i],
              applied: true,
              previousExists: true,
              previousContent,
              wasSkipped: false,
            };
          } else if (item.operation.type === 'delete') {
            // Require manual confirmation for delete operations
            const confirmed = await dialog.confirm(
              `Are you sure you want to delete "${item.operation.path}"?\n\nThis action cannot be undone through the IDE (though the file content is saved for undo).`,
              'Confirm File Deletion'
            );
            
            if (!confirmed) {
              console.log(`[FileOps] Delete cancelled by user: ${item.operation.path}`);
              updatedOps[i] = {
                ...updatedOps[i],
                applied: false,
                wasSkipped: true,
              };
              skippedCount++;
              continue;
            }
            
            const previousContent = await fs.readFile(fullPath);
            await fs.deletePath(fullPath);
            updatedOps[i] = {
              ...updatedOps[i],
              applied: true,
              previousExists: true,
              previousContent,
              wasSkipped: false,
            };
          }

          successCount++;
        } catch (error) {
          console.error('Failed to execute file operation:', error);
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `Failed to ${item.operation.type} ${item.operation.path}: ${error}`, type: 'error' }
          }));
        }
      }

      // Update state once after all operations
      setAllPendingOps(updatedOps);

      // Mark all operations as permanently kept in conversation history
      const { markFileOperationsAsKept } = useAIStore.getState();
      const operationIds = updatedOps.map(item => 
        `${item.messageId}:${item.operation.type}:${item.operation.path}`
      );
      markFileOperationsAsKept(operationIds);

      if (overwriteRequiredPaths.size > 0) {
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: {
            message: `${overwriteRequiredPaths.size} file(s) require overwrite. Review the AI diff to apply.`,
            type: 'info'
          }
        }));
      }

      if (invalidCount > 0) {
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: {
            message: `${invalidCount} file operation(s) were blocked due to invalid paths or unmatched edits.`,
            type: 'error'
          }
        }));
      }

      if (successCount > 0) {
        console.log(`[FileOps] SUCCESS: Applied ${successCount} file(s) to: ${currentWorkspace.rootPath}`);
        // Ensure Explorer reflects new/updated files even if FS watch misses the burst.
        window.dispatchEvent(new CustomEvent('workspace-refresh', { detail: { reason: 'file-ops' } }));
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: { message: `Applied ${successCount} file(s) to ${currentWorkspace.rootPath}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`, type: 'success' }
        }));
      } else if (skippedCount > 0 && overwriteRequiredPaths.size === 0 && invalidCount === 0) {
        // Only show "all applied" if everything was genuinely already applied (not skipped for other reasons)
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: { message: 'All operations already applied', type: 'info' }
        }));
      } else if (skippedCount > 0 && overwriteRequiredPaths.size === 0 && invalidCount > 0) {
        // Some operations were invalid, already notified above
      } else if (skippedCount > 0 && overwriteRequiredPaths.size > 0) {
        // Some operations require overwrite, already notified above
      }
    });
    setIsFileOpsProcessing(false);
  };

  // Auto-apply file operations when streaming ends
  const revertOperation = async (item: PendingFileOperation) => {
    return await useAIStore.getState().withWorkspaceWriteLock('fileOps.revert', async () => {
      const { currentWorkspace } = useWorkspaceStore.getState();
      const { openFile } = useEditorStore.getState();
      if (!currentWorkspace) return false;

      if (item.wasSkipped) return false;

      const { normalizedOpPath, fullPath, error } = normalizeOperationPath(
        item.operation.path,
        currentWorkspace.rootPath
      );
      if (error) return false;

      if (item.operation.type === 'create') {
        if (item.previousExists) return false;
        await fs.deletePath(fullPath);
        return true;
      }

      if (item.previousContent === undefined) return false;

      await ensureParentDir(fullPath, normalizedOpPath);
      await fs.writeFile(fullPath, item.previousContent);
      await history.save(item.operation.path, item.previousContent).catch(console.error);
      await openFile(fullPath);
      return true;
    });
  };

  const handleUndoAllOperations = () => {
    setIsFileOpsProcessing(true);
    void (async () => {
      const { unmarkFileOperationsAsKept } = useAIStore.getState();
      const { clearAllAIState } = useEditorStore.getState();
      let undoneCount = 0;
      const undonePaths = new Set<string>();
      const workspaceRoot = useWorkspaceStore.getState().currentWorkspace?.rootPath;
      const uniquePaths = Array.from(new Set(allPendingOps.map((op) => op.operation.path)));
      const discardResults = new Map<string, boolean>();
      let statusPaths: string[] = [];

      if (workspaceRoot) {
        try {
          const isRepo = await git.isGitRepo(workspaceRoot);
          if (isRepo) {
            const status = await git.status(workspaceRoot);
            statusPaths = [
              ...status.staged.map((entry) => entry.path),
              ...status.unstaged.map((entry) => entry.path),
              ...status.untracked.map((entry) => entry.path),
            ];
          }
        } catch (error) {
          console.warn('Failed to load git status for undo:', error);
        }
        for (const path of uniquePaths) {
          const discarded = await discardGitChanges(workspaceRoot, path, statusPaths);
          discardResults.set(path, discarded);
          if (discarded) {
            undonePaths.add(path);
          }
        }
      }

      for (const item of allPendingOps) {
        if (item.applied) {
          try {
            if (discardResults.get(item.operation.path)) {
              continue;
            }
            const undone = await revertOperation(item);
            if (undone) {
              undonePaths.add(item.operation.path);
            }
          } catch (error) {
            console.error('Failed to undo file operation:', error);
          }
        }
      }
      undoneCount = undonePaths.size;

      const operationIds = allPendingOps.map(item =>
        `${item.messageId}:${item.operation.type}:${item.operation.path}`
      );
      if (operationIds.length > 0) {
        unmarkFileOperationsAsKept(operationIds);
      }

      setAllPendingOps([]);
      clearAllAIState();
      window.dispatchEvent(new CustomEvent('file-ops-cleared'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: undoneCount > 0 ? `Undid ${undoneCount} file(s)` : 'Removed all file operations', type: 'info' }
      }));
      setIsFileOpsProcessing(false);
    })();
  };

  const handleSoftUndoAllOperations = () => {
    setIsFileOpsProcessing(true);
    void (async () => {
      const { unmarkFileOperationsAsKept } = useAIStore.getState();
      const { clearAllAIState } = useEditorStore.getState();
      let undoneCount = 0;

      for (const item of allPendingOps) {
        if (item.applied) {
          try {
            const undone = await revertOperation(item);
            if (undone) undoneCount++;
          } catch (error) {
            console.error('Failed to soft-undo file operation:', error);
          }
        }
      }

      const operationIds = allPendingOps.map(item =>
        `${item.messageId}:${item.operation.type}:${item.operation.path}`
      );
      if (operationIds.length > 0) {
        unmarkFileOperationsAsKept(operationIds);
      }

      setAllPendingOps([]);
      clearAllAIState();
      window.dispatchEvent(new CustomEvent('file-ops-cleared'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: undoneCount > 0 ? `Soft-undoed ${undoneCount} file(s)` : 'Removed all file operations', type: 'info' }
      }));
      setIsFileOpsProcessing(false);
    })();
  };

  const handleDismissFileOperations = () => {
    const { unmarkFileOperationsAsKept } = useAIStore.getState();
    const { clearAllAIState } = useEditorStore.getState();
    const operationIds = allPendingOps.map(item =>
      `${item.messageId}:${item.operation.type}:${item.operation.path}`
    );
    if (operationIds.length > 0) {
      unmarkFileOperationsAsKept(operationIds);
    }
    setAllPendingOps([]);
    setShowFileOps(false);
    clearAllAIState();
    window.dispatchEvent(new CustomEvent('file-ops-cleared'));
    window.dispatchEvent(new CustomEvent('show-notification', {
      detail: { message: 'Dismissed file operations', type: 'info' }
    }));
  };

  const handleAcceptFileOperation = async (index: number) => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { openFile } = useEditorStore.getState();
    
    if (!currentWorkspace) {
      console.error('No workspace open');
      return;
    }

    const item = allPendingOps[index];
    if (!item || item.applied) return;

    await useAIStore.getState().withWorkspaceWriteLock('fileOps.applyOne', async () => {
      try {
      if (item.operation.invalidReason) {
        setAllPendingOps(prev => prev.map((op, idx) =>
          idx === index
            ? { ...op, applied: false, wasSkipped: true, errorMessage: item.operation.invalidReason, operation: { ...op.operation, invalidReason: item.operation.invalidReason } }
            : op
        ));
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: { message: item.operation.invalidReason, type: 'error' }
        }));
        return;
      }
      // Normalize paths: remove leading slashes from operation path, normalize double slashes
      const { normalizedOpPath, fullPath, error } = normalizeOperationPath(
        item.operation.path,
        currentWorkspace.rootPath
      );
      if (error) {
        setAllPendingOps(prev => prev.map((op, idx) =>
          idx === index
            ? { ...op, applied: false, wasSkipped: true, errorMessage: error, operation: { ...op.operation, invalidReason: error } }
            : op
        ));
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: { message: error, type: 'error' }
        }));
        return;
      }
      console.log(`[FileOps] Single accept - full path: ${fullPath}`);
      
        if (item.operation.type === 'create') {
          // Check if file already exists
          const fileExists = await fs.pathExists(fullPath);
          if (fileExists) {
            const existingContent = await fs.readFile(fullPath);
            const normalizedExisting = normalizeContentForCompare(existingContent);
            const normalizedIncoming = normalizeContentForCompare(item.operation.content || '');
            if (normalizedExisting === normalizedIncoming && normalizedIncoming.length > 0) {
              console.log(`[FileOps] File already exists, content matches: ${normalizedOpPath}`);
              // Mark as applied even though we skipped it
              setAllPendingOps(prev => prev.map((op, idx) =>
                idx === index ? { ...op, applied: true, wasSkipped: true, previousExists: true, previousContent: existingContent } : op
              ));
              window.dispatchEvent(new CustomEvent('show-notification', {
                detail: { message: `File already exists: ${normalizedOpPath}`, type: 'info' }
              }));
              return;
            }

            setAllPendingOps(prev => prev.map((op, idx) =>
              idx === index
                ? {
                  ...op,
                  applied: false,
                  wasSkipped: true,
                  previousExists: true,
                  previousContent: existingContent,
                  requiresOverwrite: true,
                }
                : op
            ));
            window.dispatchEvent(new CustomEvent('show-notification', {
              detail: { message: `Overwrite required: ${normalizedOpPath}. Review the AI diff to apply.`, type: 'info' }
            }));
            return;
          }
        
        // Ensure parent directory exists
        await ensureParentDir(fullPath, normalizedOpPath);
        console.log(`[FileOps] Writing file: ${fullPath}`);
        await fs.writeFile(fullPath, item.operation.content || '');
        const verifyExists = await fs.pathExists(fullPath);
        console.log(`[FileOps] Write complete, verified: ${verifyExists}`);
        // Save to local history
        await history.save(normalizedOpPath, item.operation.content || '').catch(console.error);
        await openFile(fullPath);
        setAllPendingOps(prev => prev.map((op, idx) => 
          idx === index ? { ...op, applied: true, previousExists: false, previousContent: '', wasSkipped: false } : op
        ));
      } else if (item.operation.type === 'edit') {
        const previousContent = await fs.readFile(fullPath);
        const { updatedContent, changed, reason } = applyEditOperation(previousContent, item.operation);

        if (!changed) {
          if (reason === 'already-applied') {
            setAllPendingOps(prev => prev.map((op, idx) => 
              idx === index ? { ...op, applied: true, previousExists: true, previousContent, wasSkipped: true } : op
            ));
            window.dispatchEvent(new CustomEvent('show-notification', {
              detail: { message: `No changes applied: ${item.operation.path}`, type: 'info' }
            }));
            return;
          }
          setAllPendingOps(prev => prev.map((op, idx) =>
            idx === index
              ? { ...op, applied: false, previousExists: true, previousContent, wasSkipped: true, errorMessage: 'Edit failed: <old_content> did not match the file.', operation: { ...op.operation, invalidReason: 'Edit failed: <old_content> did not match the file.' } }
              : op
          ));
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `Edit failed for ${item.operation.path}: <old_content> did not match.`, type: 'error' }
          }));
          return;
        }

        await fs.writeFile(fullPath, updatedContent);
        // Save to local history
        await history.save(item.operation.path, updatedContent).catch(console.error);
        await openFile(fullPath);
        setAllPendingOps(prev => prev.map((op, idx) => 
          idx === index ? { ...op, applied: true, previousExists: true, previousContent, wasSkipped: false } : op
        ));
      } else if (item.operation.type === 'delete') {
        // Require manual confirmation for delete operations
        const confirmed = await dialog.confirm(
          `Are you sure you want to delete "${item.operation.path}"?\n\nThis action cannot be undone through the IDE (though the file content is saved for undo).`,
          'Confirm File Deletion'
        );
        
        if (!confirmed) {
          console.log(`[FileOps] Delete cancelled by user: ${item.operation.path}`);
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `Delete cancelled: ${item.operation.path}`, type: 'info' }
          }));
          return;
        }
        
        const previousContent = await fs.readFile(fullPath);
        await fs.deletePath(fullPath);
        setAllPendingOps(prev => prev.map((op, idx) => 
          idx === index ? { ...op, applied: true, previousExists: true, previousContent, wasSkipped: false } : op
        ));
      }

      // Mark operation as permanently kept in conversation history
      const { markFileOperationsAsKept } = useAIStore.getState();
      const operationId = `${item.messageId}:${item.operation.type}:${item.operation.path}`;
      markFileOperationsAsKept([operationId]);

      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Applied: ${item.operation.path}`, type: 'success' }
      }));
      } catch (error) {
        console.error('Failed to execute file operation:', error);
        window.dispatchEvent(new CustomEvent('show-notification', {
          detail: { message: `Failed to ${item.operation.type} ${item.operation.path}: ${error}`, type: 'error' }
        }));
      }
    });
  };

  const handleUndoFileOperation = (index: number) => {
    void (async () => {
      const item = allPendingOps[index];
      if (!item) return;

      const { unmarkFileOperationsAsKept } = useAIStore.getState();
      let undone = false;

      if (item.applied) {
        try {
          const workspaceRoot = useWorkspaceStore.getState().currentWorkspace?.rootPath;
          const discarded = workspaceRoot
            ? await discardGitChanges(workspaceRoot, item.operation.path)
            : false;
          undone = discarded || await revertOperation(item);
        } catch (error) {
          console.error('Failed to undo file operation:', error);
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `Failed to undo ${item.operation.path}: ${error}`, type: 'error' }
          }));
          return;
        }
      }

      const operationId = `${item.messageId}:${item.operation.type}:${item.operation.path}`;
      unmarkFileOperationsAsKept([operationId]);

      setAllPendingOps(prev => prev.filter((_, idx) => idx !== index));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: undone ? `Undid ${item.operation.path}` : 'Removed file operation', type: 'info' }
      }));
    })();
  };

  const openAIOperationPreview = useCallback(async (item: PendingFileOperation) => {
    if (!currentWorkspace) return;
    if (item.applied) {
      const relativePath = resolveWorkspaceRelativePath(currentWorkspace.rootPath, item.operation.path);
      const isRepo = await git.isGitRepo(currentWorkspace.rootPath).catch(() => false);
      if (!isRepo) {
        const diffPayload = await buildAIOperationDiffFromDisk(currentWorkspace.rootPath, item.operation, item);
        openAIDiff(
          item.operation.path,
          diffPayload.oldContent,
          diffPayload.newContent,
          diffPayload.operationType,
          diffPayload.requiresOverwrite,
          item.applied
        );
        return;
      }
      try {
        const status = await git.status(currentWorkspace.rootPath);
        const normalizedTarget = normalizeRepoRelativePath(currentWorkspace.rootPath, relativePath);
        const matchesPath = (entryPath: string) => {
          const normalizedEntry = normalizeRepoRelativePath(currentWorkspace.rootPath, entryPath);
          return normalizedEntry === normalizedTarget
            || normalizedEntry.endsWith(`/${normalizedTarget}`)
            || normalizedTarget.endsWith(`/${normalizedEntry}`);
        };
        const stagedEntry = status.staged.find((entry) => matchesPath(entry.path));
        const unstagedEntry = status.unstaged.find((entry) => matchesPath(entry.path));
        const untrackedEntry = status.untracked.find((entry) => matchesPath(entry.path));
        const entry = stagedEntry ?? unstagedEntry ?? untrackedEntry;
        const diffStatus = (entry?.status as 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed')
          || getDiffStatusFromOperation(item.operation);
        openDiff(currentWorkspace.rootPath, normalizedTarget, Boolean(stagedEntry), diffStatus);
      } catch (error) {
        // If status lookup failed (e.g. repo mis-detected), fall back to a disk-based AI diff.
        const diffPayload = await buildAIOperationDiffFromDisk(currentWorkspace.rootPath, item.operation, item);
        openAIDiff(
          item.operation.path,
          diffPayload.oldContent,
          diffPayload.newContent,
          diffPayload.operationType,
          diffPayload.requiresOverwrite,
          item.applied
        );
      }
      return;
    }
    const diffPayload = await buildAIOperationDiffFromDisk(currentWorkspace.rootPath, item.operation, item);
    openAIDiff(
      item.operation.path,
      diffPayload.oldContent,
      diffPayload.newContent,
      diffPayload.operationType,
      diffPayload.requiresOverwrite,
      item.applied
    );
  }, [currentWorkspace, openAIDiff, openDiff]);

  const handleReviewOperations = async () => {
    if (!currentWorkspace) return;
    setShowEditorPanel(true);
    if (allPendingOps.length === 0) return;
    const grouped = new Map<string, PendingFileOperation[]>();
    allPendingOps.forEach((item) => {
      const key = canonicalizeOperationPath(item.operation.path, currentWorkspace.rootPath);
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    });

    for (const items of grouped.values()) {
      const item = items.find((entry) => entry.applied) || items[0];
      if (item) {
        await openAIOperationPreview(item);
      }
    }
    setHasReviewedPendingOps(true);
  };

  const handleViewFileOperation = async (path: string) => {
    if (!currentWorkspace) return;
    setShowEditorPanel(true);
    const targetKey = canonicalizeOperationPath(path, currentWorkspace.rootPath);
    const matches = allPendingOps.filter((op) =>
      canonicalizeOperationPath(op.operation.path, currentWorkspace.rootPath) === targetKey
    );
    if (matches.length > 0) {
      const item = matches.find((entry) => entry.applied) || matches[0];
      await openAIOperationPreview(item);
      setHasReviewedPendingOps(true);
      return;
    }
    const relativePath = resolveWorkspaceRelativePath(currentWorkspace.rootPath, path);
    const isRepo = await git.isGitRepo(currentWorkspace.rootPath).catch(() => false);
    if (isRepo) {
      openDiff(currentWorkspace.rootPath, relativePath, false);
    } else {
      const { openFile } = useEditorStore.getState();
      const { fullPath, error } = normalizeOperationPath(path, currentWorkspace.rootPath);
      if (!error && fullPath) {
        await openFile(fullPath);
      }
    }
    setHasReviewedPendingOps(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow submission if there's text OR attachments
    if (!input.trim() && attachments.length === 0) return;

    const message = input;
    const messageAttachments = attachments;
    setPendingResponse(true);
    setInput('');
    setAttachments([]);
    resetScrollLock();
    
    // Reset textarea height after clearing input
    setTimeout(() => resizeTextarea(), 0);
    
    // If already streaming, queue the prompt
    if (isStreaming) {
      queuePrompt(message, messageAttachments);
    } else {
      await sendMessage(message, messageAttachments);
    }
  };

  const handleRunAsSubagent = async () => {
    // Allow submission if there's text OR attachments
    if (!input.trim() && attachments.length === 0) return;

    const message = input;
    const messageAttachments = attachments;
    setPendingResponse(true);
    setInput('');
    setAttachments([]);
    resetScrollLock();
    setTimeout(() => resizeTextarea(), 0);

    const profile = subagentProfiles.find((p) => p.id === selectedSubagentProfileId);
    const overrides = profile?.provider || profile?.model
      ? { provider: profile.provider, model: profile.model }
      : undefined;

    await startAgentRun(message, {
      label: profile?.name || 'Subagent',
      profileId: profile?.id,
      attachments: messageAttachments,
      overrides,
    });
  };

  const handleNewChat = () => {
    setShowFileOps(false);
    createConversation();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversation(id);
    setShowHistory(false);
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  };

  const handleImportFromProject = async () => {
    try {
      const selected = await dialog.openDirectory();
      if (!selected) return;
      
      setImportStatus('Importing...');
      const result = await importConversationsFromPath(selected);
      
      if (result.error) {
        setImportStatus(`Error: ${result.error}`);
      } else if (result.imported > 0) {
        setImportStatus(`Imported ${result.imported} conversation${result.imported > 1 ? 's' : ''}`);
      } else {
        setImportStatus('No conversations to import');
      }
      
      // Clear status after 3 seconds
      setTimeout(() => setImportStatus(null), 3000);
    } catch (error) {
      setImportStatus('Failed to import');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await dialog.openFile();
      if (!selected) return;

      setImportStatus('Importing file...');
      const result = await importConversationsFromFile(selected);

      if (result.error) {
        setImportStatus(`Error: ${result.error}`);
      } else if (result.imported > 0) {
        setImportStatus(`Imported ${result.imported} conversation${result.imported > 1 ? 's' : ''}`);
      } else {
        setImportStatus('No conversations to import');
      }

      setTimeout(() => setImportStatus(null), 3000);
    } catch {
      setImportStatus('Failed to import file');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const handleExportActiveConversation = async () => {
    try {
      if (!activeConversation) return;

      const safeName = (activeConversation.title || 'chat')
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 80) || 'chat';

      const target = await dialog.saveFile(`${safeName}.json`);
      if (!target) return;

      setImportStatus('Exporting...');

      const payload = {
        schema: 'opencodebrew.chat.export.v1',
        exportedAt: new Date().toISOString(),
        conversation: activeConversation,
      };

      await fs.writeFile(target, JSON.stringify(payload, null, 2));
      setImportStatus('Exported chat');
      setTimeout(() => setImportStatus(null), 3000);
    } catch {
      setImportStatus('Failed to export');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={styles.aiPanel}>
      {/* Header with conversation title and actions */}
      <div className={styles.panelHeader}>
        <div className={styles.conversationTitle}>
          {activeConversation ? (
            <>
              <MessageSquare size={14} />
              <span>{activeConversation.title || 'New Chat'}</span>
            </>
          ) : (
            <>
              <Bot size={14} />
              <span>AI Assistant</span>
            </>
          )}
        </div>
        {showProcessingStatus && (
          <div className={styles.headerProcessingStatus} aria-live="polite">
            <span className={styles.processingStatusIcon}>
              {showQueueIcon ? <Clock size={14} /> : <Loader2 size={14} className={styles.spinning} />}
            </span>
            <span className={styles.processingStatusText}>{processingLabel}</span>
          </div>
        )}
        <div className={styles.headerActions}>
          <button
            className={styles.newChatBtn}
            onClick={handleNewChat}
            title="New Chat"
          >
            <Plus size={14} />
            <span>New Chat</span>
          </button>
          <button
            className={styles.headerBtn}
            onClick={() => summarizeConversation('manual')}
            title="Summarize chat"
            disabled={!activeConversation || isSummarizing}
          >
            {isSummarizing ? <Loader2 size={16} className={styles.spinning} /> : <FileText size={16} />}
          </button>
          <button
            className={`${styles.headerBtn} ${showHistory ? styles.active : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title="Chat History"
          >
            <History size={16} />
          </button>
          <button
            className={`${styles.headerBtn} ${showFileOps ? styles.active : ''}`}
            onClick={() => setShowFileOps((prev) => !prev)}
            title={hasFileOps ? (showFileOps ? 'Hide file operations' : 'Show file operations') : 'No file operations'}
            disabled={!hasFileOps}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <div className={styles.messages} ref={messagesContainerRef} onScroll={handleScroll}>
        {!activeConversation || activeConversation.messages.length === 0 ? (
          <div className={styles.empty}>
            <Bot size={32} />
            <h3>
              {agentMode === 'plan' ? 'Plan Mode' : 'AI Assistant'}
            </h3>
            <p>
              {agentMode === 'plan'
                ? 'Design solutions and explore approaches before implementation.'
                : agentMode === 'agent'
                ? 'Create, edit, and manage files in your workspace.'
                : agentMode === 'edit'
                ? 'Make precise edits to your existing code.'
                : 'Ask questions about your code, get help with debugging, or request code generation.'}
            </p>
            <div className={styles.suggestions}>
              {agentMode === 'plan' ? (
                <>
                  <button onClick={() => {
                    setInput('Help me design a user authentication system. What are the different approaches and trade-offs?');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Design authentication system
                  </button>
                  <button onClick={() => {
                    setInput('I need to refactor the database layer. Help me plan the approach and break down the work.');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Plan a refactoring
                  </button>
                  <button onClick={() => {
                    setInput('What are the options for implementing real-time features? Compare WebSockets, Server-Sent Events, and polling.');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Evaluate technology options
                  </button>
                  <button onClick={() => {
                    setInput('Help me break down the task of adding a dark mode feature into implementation steps.');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Break down a feature
                  </button>
                </>
              ) : agentMode === 'agent' ? (
                <>
                  <button onClick={() => {
                    setInput('Create a new React component for user profile with TypeScript');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Create a component
                  </button>
                  <button onClick={() => {
                    setInput('Set up API endpoints for user management');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Build API endpoints
                  </button>
                  <button onClick={() => {
                    setInput('Add unit tests for the authentication module');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Write tests
                  </button>
                </>
              ) : agentMode === 'edit' ? (
                <>
                  <button onClick={() => {
                    setInput('Add TypeScript types to this function');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Add type annotations
                  </button>
                  <button onClick={() => {
                    setInput('Fix the error handling in this code');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Improve error handling
                  </button>
                  <button onClick={() => {
                    setInput('Optimize this database query');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Optimize performance
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => {
                    setInput('Explain this code');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Explain this code
                  </button>
                  <button onClick={() => {
                    setInput('Help me fix this bug');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Help me fix this bug
                  </button>
                  <button onClick={() => {
                    setInput('Write tests for this');
                    setTimeout(() => resizeTextarea(), 0);
                  }}>
                    Write tests for this
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {(sessionUsage.turnCount > 0 || contextBreakdown) && (
              <div className={styles.sessionCostTracker}>
                {contextBreakdown && (
                  <button 
                    className={styles.contextBreakdownBtn}
                    onClick={() => setShowContextBreakdown(true)}
                    title="View context breakdown"
                  >
                    <span className={styles.contextPercent}>{contextBreakdown.percentFull}%</span>
                    <div className={styles.contextMiniBar}>
                      <div 
                        className={styles.contextMiniBarFill}
                        style={{ width: `${Math.min(contextBreakdown.percentFull, 100)}%` }}
                      />
                    </div>
                  </button>
                )}
                {sessionUsage.turnCount > 0 && (
                  <div className={styles.sessionCostStats}>
                    <span className={styles.sessionCostTokens}>
                      {sessionUsage.totalTokens.toLocaleString()} tokens
                    </span>
                    <span className={styles.sessionCostSeparator}>•</span>
                    <span className={styles.sessionCostTurns}>
                      {sessionUsage.turnCount} {sessionUsage.turnCount === 1 ? 'turn' : 'turns'}
                    </span>
                    {sessionUsage.totalCostUsd > 0 && (
                      <>
                        <span className={styles.sessionCostSeparator}>•</span>
                        <span className={styles.sessionCostAmount}>
                          ${sessionUsage.totalCostUsd.toFixed(4)}
                        </span>
                      </>
                    )}
                    {(sessionUsage.totalCacheCreation > 0 || sessionUsage.totalCacheRead > 0) && (
                      <>
                        <span className={styles.sessionCostSeparator}>•</span>
                        <span className={styles.sessionCostCache}>
                          cache: {sessionUsage.totalCacheRead > 0 
                            ? `${Math.round((sessionUsage.totalCacheRead / (sessionUsage.totalPromptTokens + sessionUsage.totalCacheRead)) * 100)}%`
                            : '0%'} hit
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {activeConversation.summary && (
              <div className={styles.summaryCard}>
                <div
                  className={styles.summaryHeader}
                  onClick={() => setSummaryExpanded((prev) => !prev)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSummaryExpanded((prev) => !prev)}
                >
                  <div className={styles.summaryHeaderLeft}>
                    <FileText size={14} />
                    <span className={styles.summaryTitle}>Conversation Summary</span>
                  </div>
                  <div className={styles.summaryHeaderRight}>
                    {activeConversation.summaryUpdatedAt && (
                      <span className={styles.summaryMeta}>
                        {formatDate(activeConversation.summaryUpdatedAt)}
                      </span>
                    )}
                    <span className={styles.summaryToggle}>
                      {summaryExpanded ? 'Hide' : 'Show'}
                    </span>
                  </div>
                </div>
                {summaryExpanded && (
                  <div className={styles.summaryContent}>
                                <MarkdownRenderer content={activeConversation.summary} disableLooseCodeDetection={true} />
                  </div>
                )}
              </div>
            )}
            {(agentMode === 'agent' || agentMode === 'edit' || agentMode === 'plan' || agentMode === 'test') && (
              <div className={styles.modeBanner}>
                <div className={styles.modeBannerIcon}>
                  {agentMode === 'agent' ? '✨' : agentMode === 'edit' ? '📝' : agentMode === 'plan' ? '📋' : '🧪'}
                </div>
                <div className={styles.modeBannerText}>
                  <strong>
                    {agentMode === 'agent' ? 'Agent Mode' : agentMode === 'edit' ? 'Edit Mode' : agentMode === 'plan' ? 'Plan Mode' : 'Test Mode'} Active
                  </strong>
                  <p>
                    {agentMode === 'agent' 
                      ? aiAutoApplyFileOps
                        ? 'The AI can create, edit, and delete files in your workspace. Changes apply automatically, and you can undo them in File Operations.'
                        : 'The AI can create, edit, and delete files in your workspace. Review changes in File Operations before applying.'
                      : agentMode === 'edit'
                      ? aiAutoApplyFileOps
                        ? 'The AI will help you edit existing files with precise changes. Edits apply automatically, and you can undo them in File Operations.'
                        : 'The AI will help you edit existing files with precise changes. Review edits in File Operations before applying.'
                      : agentMode === 'plan'
                      ? 'The AI will help you plan and design solutions before implementation. Focus on architecture, approaches, and breaking down tasks.'
                      : 'The AI will analyze pending changes and generate comprehensive tests including unit, integration, security, and dependency audits.'}
                  </p>
                </div>
              </div>
            )}
            {agentMode === 'agent' && agentTasks.length > 0 && (
              <AgentTaskProgress
                tasks={agentTasks}
                onClear={clearAgentTasks}
              />
            )}
            {circularResponseState.circularCount >= 2 && (
              <div className={styles.circularWarning}>
                <AlertTriangle size={16} />
                <div className={styles.circularWarningContent}>
                  <strong>Loop Detected</strong>
                  <p>The AI appears to be repeating similar responses. Consider:</p>
                  <div className={styles.circularWarningActions}>
                    <button 
                      onClick={() => {
                        resetCircularState();
                        setInput('Let\'s try a completely different approach to this problem.');
                        setTimeout(() => resizeTextarea(), 0);
                      }}
                    >
                      Try Different Approach
                    </button>
                    <button 
                      onClick={() => {
                        resetCircularState();
                        setInput('Please explain what\'s blocking you from completing this task.');
                        setTimeout(() => resizeTextarea(), 0);
                      }}
                    >
                      Ask What's Blocking
                    </button>
                    <button 
                      onClick={() => {
                        resetCircularState();
                        stopStreaming('user-loop-break');
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
            {activeConversation.messages.map((message, idx) => {
              const isLast = idx === activeConversation.messages.length - 1;
              const isStreamingAssistant = Boolean(isStreaming && isLast && message.role === 'assistant');
              const isCodeReviewPrompt =
                message.role === 'user' &&
                /review the changes below/i.test(message.content) &&
                (message.content.includes('--- BEGIN DIFF') || message.content.includes('diff --git'));

              return (
              <MemoizedMessageBubble 
                key={message.id} 
                message={message} 
                renderAsPlainText={isCodeReviewPrompt || isStreamingAssistant}
                plainTextTitle={isCodeReviewPrompt ? 'Review Input' : (isStreamingAssistant ? 'Streaming' : undefined)}
                plainTextDefaultExpanded={isStreamingAssistant}
                  plainTextKind={isCodeReviewPrompt ? 'diff' : 'text'}
                onImagePreview={(src, name) => setPreviewImage({ src, name })}
                onOperationsChange={async (ops) => {
                  const { isFileOperationKept } = useAIStore.getState();

                  const workspaceRoot = currentWorkspace?.rootPath;
                  const preparedOps = (() => {
                    const result: FileOperation[] = [];
                    const lastIdxByKey = new Map<string, number>();
                    const seenEditSignatures = new Set<string>();

                    for (const op of ops) {
                      const cleanedPath = sanitizeOperationPath(op.path);
                      const opCleaned: FileOperation = { ...op, path: cleanedPath };
                      const canonicalKey = workspaceRoot
                        ? canonicalizeOperationPath(cleanedPath, workspaceRoot)
                        : cleanedPath;

                      if (opCleaned.type === 'create' || opCleaned.type === 'delete') {
                        // Keep only the last create/delete per file within a single message.
                        const key = `${opCleaned.type}:${canonicalKey}`;
                        const existingIdx = lastIdxByKey.get(key);
                        if (existingIdx !== undefined) {
                          result[existingIdx] = opCleaned;
                        } else {
                          lastIdxByKey.set(key, result.length);
                          result.push(opCleaned);
                        }
                        continue;
                      }

                      if (opCleaned.type === 'edit') {
                        // Drop exact duplicates; keep distinct edits (order can matter).
                        const sig = `edit:${canonicalKey}:${opCleaned.oldContent || ''}=>${opCleaned.newContent || ''}:${opCleaned.insertLine ?? ''}`;
                        if (seenEditSignatures.has(sig)) continue;
                        seenEditSignatures.add(sig);
                        result.push(opCleaned);
                        continue;
                      }

                      result.push(opCleaned);
                    }

                    return result;
                  })();
                  
                  // Check if operations are kept or if files already exist
                  const opsWithStatus: PendingFileOperation[] = await Promise.all(
                    preparedOps.map(async (op) => {
                      const operationId = `${message.id}:${op.type}:${op.path}`;
                      
                      // First check if operation is marked as kept in history
                      if (isFileOperationKept(operationId)) {
                        console.log(`Operation marked as kept in history: ${op.path}`);
                        return { operation: op, messageId: message.id, applied: true };
                      }

                      if (op.invalidReason) {
                        return {
                          operation: { ...op, invalidReason: op.invalidReason },
                          messageId: message.id,
                          applied: false,
                          errorMessage: op.invalidReason,
                        };
                      }
                      
                      // Otherwise check if operation already applied on disk
                      let alreadyApplied = false;
                      let requiresOverwrite = false;
                      if (currentWorkspace) {
                        const { fullPath, error } = normalizeOperationPath(op.path, currentWorkspace.rootPath);
                        if (error) {
                          return {
                            operation: { ...op, invalidReason: error },
                            messageId: message.id,
                            applied: false,
                            errorMessage: error,
                          };
                        }
                        try {
                          if (op.type === 'create') {
                            const exists = await fs.pathExists(fullPath);
                            if (exists) {
                              const onDisk = await fs.readFile(fullPath);
                              const normalizedDisk = normalizeContentForCompare(onDisk);
                              const normalizedIncoming = normalizeContentForCompare(op.content || '');
                              alreadyApplied = normalizedDisk === normalizedIncoming && normalizedIncoming.length > 0;
                              requiresOverwrite = !alreadyApplied && normalizedIncoming.length > 0;
                            }
                          } else if (op.type === 'delete') {
                            const exists = await fs.pathExists(fullPath);
                            alreadyApplied = !exists;
                          } else if (op.type === 'edit') {
                            const onDisk = await fs.readFile(fullPath);
                            const { changed, reason } = applyEditOperation(onDisk, op);
                            alreadyApplied = !changed && reason === 'already-applied';
                          }
                        } catch (err) {
                          console.error('Error checking file existence:', err);
                        }
                      }
                      
                      return {
                        operation: op,
                        messageId: message.id,
                        applied: alreadyApplied,
                        requiresOverwrite,
                      };
                    })
                  );
                  
                  setAllPendingOps(prev => {
                    // Remove old operations for this message
                    const filtered = prev.filter(item => item.messageId !== message.id);
                    // Add new operations with their applied status
                    return [...filtered, ...opsWithStatus];
                  });
                }}
              />
            )})}
            {isStreaming && thinkingStatus && (
              <div className={styles.thinkingContainer}>
                <div className={styles.thinkingIcon}>
                  <Bot size={14} />
                </div>
                <div className={styles.thinkingContent}>
                  <span className={styles.thinkingText}>{thinkingStatus}</span>
                </div>
              </div>
            )}
            {webAccessTraces.length > 0 && (
              <div className={styles.aiTraceContainer}>
                <div className={styles.aiTraceHeader}>
                  {webAccessTraces.some(t => t.status === 'running') ? (
                    <Loader2 size={14} className={styles.spinning} />
                  ) : (
                    <Globe size={14} />
                  )}
                  <span className={styles.aiTraceTitle}>
                    {webAccessTraces.some(t => t.status === 'running') 
                      ? 'Searching the web...' 
                      : 'Web Access'}
                  </span>
                </div>
                <div className={styles.aiTraceContent}>
                  <ul className={styles.aiTraceList}>
                    {webAccessTraces.map((trace) => (
                      <li key={trace.id} className={`${styles.aiTraceItem} ${styles[`trace${trace.status.charAt(0).toUpperCase() + trace.status.slice(1)}`]}`}>
                        <div 
                          className={styles.aiTraceItemHeader}
                          onClick={() => trace.status === 'completed' && (trace.searchResults || trace.fetchContent) && toggleWebAccessTraceExpanded(trace.id)}
                          style={{ cursor: trace.status === 'completed' && (trace.searchResults || trace.fetchContent) ? 'pointer' : 'default' }}
                        >
                          <span className={styles.aiTraceText}>
                            {trace.status === 'running' 
                              ? (trace.type === 'search' 
                                  ? `Searching for "${trace.query}"...` 
                                  : (trace.query ? `Exploring ${trace.query}...` : `Fetching ${trace.url}...`))
                              : (trace.type === 'search' 
                                  ? `Searched "${trace.query}"` 
                                  : (trace.query ? `Explored ${trace.query}` : `Fetched ${trace.url}`))}
                          </span>
                          {trace.status === 'completed' && trace.result && (
                            <span className={styles.aiTraceResult}> - {trace.result}</span>
                          )}
                          {trace.status === 'error' && trace.error && (
                            <span className={styles.aiTraceError}> - Error: {trace.error}</span>
                          )}
                          {trace.status === 'completed' && (trace.searchResults || trace.fetchContent) && (
                            <ChevronDown size={12} className={`${styles.aiTraceChevron} ${trace.expanded ? styles.expanded : ''}`} />
                          )}
                        </div>
                        
                        {trace.expanded && trace.searchResults && (
                          <ul className={styles.aiTraceResults}>
                            {trace.searchResults.map((result, i) => (
                              <li key={i} className={styles.aiTraceResultItem}>
                                <a 
                                  href={result.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className={styles.aiTraceResultLink}
                                >
                                  {result.title}
                                </a>
                                <p className={styles.aiTraceResultSnippet}>{result.snippet}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                        
                        {trace.expanded && trace.fetchContent && (
                          <div className={styles.aiTraceFetchContent}>
                            <div className={styles.aiTraceFetchTitle}>
                              <a 
                                href={trace.fetchContent.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                              >
                                {trace.fetchContent.title || trace.fetchContent.url}
                              </a>
                            </div>
                            <p className={styles.aiTraceFetchSnippet}>
                              {trace.fetchContent.content.slice(0, 500)}
                              {trace.fetchContent.content.length > 500 && '...'}
                            </p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {agentRunOrder.length > 0 && (
        <div className={styles.agentRunsPanel} aria-label="Agent runs">
          <div className={styles.agentRunsHeader}>
            <div className={styles.agentRunsHeaderLeft}>
              <span className={styles.agentRunsTitle}>Runs</span>
              {agentRunQueue.length > 0 && (
                <span className={styles.agentRunsQueue}>{agentRunQueue.length} queued</span>
              )}
              {workspaceWriteLocked && (
                <span className={styles.agentRunsLock}>
                  Workspace locked{workspaceWriteLockQueue.length > 0 ? ` (+${workspaceWriteLockQueue.length} waiting)` : ''}
                </span>
              )}
            </div>
            <div className={styles.agentRunsHeaderRight}>
              <button
                type="button"
                className={styles.agentRunsClearBtn}
                onClick={clearAgentRuns}
                title="Clear runs list"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className={styles.agentRunsList}>
            {agentRunOrder.slice(0, 4).map((runId) => {
              const run = agentRunsById[runId];
              if (!run) return null;
              const canStop = run.status === 'running' || run.status === 'queued';
              return (
                <div key={run.id} className={styles.agentRunItem}>
                  <div className={styles.agentRunMeta}>
                    <span className={styles.agentRunLabel}>{run.label}</span>
                    <span className={`${styles.agentRunStatus} ${styles[`agentRunStatus_${run.status.replace('-', '_')}`]}`}>
                      {run.status}
                    </span>
                    {run.status === 'error' && run.error && (
                      <span className={styles.agentRunError}>{run.error}</span>
                    )}
                  </div>
                  {canStop && (
                    <button
                      type="button"
                      className={styles.agentRunStopBtn}
                      onClick={() => cancelAgentRun(run.id)}
                      title="Stop run"
                    >
                      <Square size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {promptQueue.length > 0 && (
        <div className={styles.queueIndicator}>
          <div className={styles.queueInfo}>
            <span className={styles.queueCount}>{promptQueue.length} prompt{promptQueue.length > 1 ? 's' : ''} queued</span>
            <span className={styles.queuePreview}>
              {buildQueuePreview(promptQueue[0].content)}
            </span>
          </div>
          <button 
            className={styles.queueClearBtn}
            onClick={clearQueue}
            title="Clear queue"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showFileOps && (
        <FileOperationsBar
          operations={allPendingOps}
          workspaceRoot={currentWorkspace?.rootPath}
          expanded={fileOpsExpanded}
          onToggleExpanded={() => setFileOpsExpanded(!fileOpsExpanded)}
          // Keep All should apply changes without opening a review tab per file.
          onKeepAll={() => { void handleKeepAllOperations({ skipReview: true, openFilesAfterApply: false }); }}
          onUndoAll={handleUndoAllOperations}
          onSoftUndoAll={handleSoftUndoAllOperations}
          onDismiss={handleDismissFileOperations}
          onReview={handleReviewOperations}
          onViewAll={handleReviewOperations}
          onViewFile={handleViewFileOperation}
          onAcceptFile={handleAcceptFileOperation}
          onUndoFile={handleUndoFileOperation}
          isProcessing={isFileOpsProcessing}
        />
      )}

      <div 
        className={`${styles.inputContainer} ${isDragging ? styles.dragging : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <form 
          className={styles.inputArea} 
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.txt,.md,.json,.xml"
            style={{ display: 'none' }}
            onChange={async (e) => {
              console.log('[AIPanel] File input onChange triggered, files:', e.target.files);
              if (e.target.files && e.target.files.length > 0) {
                await handleFileUpload(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map((attachment) => (
                <div key={attachment.id} className={styles.attachmentItem}>
                  {attachment.type === 'image' ? (
                    <div 
                      className={styles.attachmentPreview}
                      onClick={() => attachment.data && setPreviewImage({ src: attachment.data, name: attachment.name })}
                      style={{ cursor: 'pointer' }}
                    >
                      <img src={attachment.data} alt={attachment.name} className={styles.attachmentImage} />
                      <div className={styles.attachmentOverlay}>
                        <ImageIcon size={16} />
                        <span className={styles.attachmentName}>{attachment.name}</span>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.attachmentFile}>
                      <Paperclip size={16} />
                      <span className={styles.attachmentName}>{attachment.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.removeAttachment}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={isStreaming ? "Queue next prompt..." : "Ask a question..."}
            rows={1}
          />
          <div className={styles.inputControls}>
            <div className={styles.modeSelector}>
              <select 
                value={agentMode} 
                onChange={(e) => setAgentMode(e.target.value as AgentMode)}
                className={styles.modeDropdown}
              >
                <option value="chat">💬 Chat</option>
                <option value="agent">∞ Agent</option>
                <option value="plan">📋 Plan</option>
                <option value="edit">✏️ Edit</option>
              </select>
            </div>
            <div className={styles.modelSelector}>
              <select 
                value={config.model}
                onChange={(e) => {
                  const selectedModel = e.target.value;
                  useAIStore.getState().setConfig({ model: selectedModel });
                }}
                className={styles.modelDropdown}
                title={config.provider === 'copilot' ? getModelPricingTooltip(config.model, copilotModelsMetadata) : undefined}
              >
                <optgroup label={config.provider}>
                  {(availableModels[config.provider] || []).map((model) => (
                    <option key={model} value={model}>
                      {formatModelLabel(config.provider, model, copilotModelsMetadata)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            {subagentProfiles.length > 0 && (
              <div className={styles.subagentSelector}>
                <select
                  value={selectedSubagentProfileId}
                  onChange={(e) => setSelectedSubagentProfileId(e.target.value)}
                  className={styles.subagentDropdown}
                  title="Subagent profile"
                >
                  {subagentProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.controlsRight}>
              <button
                type="button"
                className={styles.controlBtn}
                onClick={handleNewChat}
                title="New Chat"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                className={`${styles.controlBtn} ${showHistory ? styles.active : ''}`}
                onClick={() => setShowHistory(!showHistory)}
                title="Chat History"
              >
                <History size={16} />
              </button>
              <button
                type="button"
                className={`${styles.controlBtn} ${!isVisionModel() ? styles.disabledFeature : ''}`}
                onClick={handleAttachClick}
                title={isVisionModel() ? "Attach files" : "Attach files (vision model required)"}
              >
                <ImageIcon size={16} />
                {!isVisionModel() && <span className={styles.warningBadge}>!</span>}
              </button>
              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => setShowSettings(!showSettings)}
                title="Settings"
              >
                <Settings size={16} />
              </button>
              {subagentProfiles.length > 0 && (
                <button
                  type="button"
                  className={styles.controlBtn}
                  onClick={handleRunAsSubagent}
                  disabled={!input.trim() && attachments.length === 0}
                  title="Run as subagent (parallel)"
                >
                  <Zap size={16} />
                </button>
              )}
              {isStreaming && (
                <button
                  type="button"
                  className={`${styles.controlBtn} ${styles.stopBtn}`}
                  onClick={() => stopStreaming()}
                  title="Stop generating"
                >
                  <Square size={16} />
                </button>
              )}
              {showProcessingIndicator && (
                <div className={styles.processingIndicator} title="AI is processing">
                  <Loader2 size={16} className={styles.spinning} />
                </div>
              )}
              <button
                type="submit"
                className={styles.sendBtn}
                disabled={!input.trim() && attachments.length === 0}
                title={isStreaming ? 'Queue prompt' : (promptQueue.length > 0 ? 'Queue prompt' : 'Send message')}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
          {showProcessingStatus && (
            <div className={styles.processingStatus} aria-live="polite">
              <span className={styles.processingStatusIcon}>
                {showQueueIcon ? <Clock size={14} /> : <Loader2 size={14} className={styles.spinning} />}
              </span>
              <span className={styles.processingStatusText}>{processingLabel}</span>
            </div>
          )}
        </form>

        {showHistory && (
          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <h3>Chat History</h3>
              <div className={styles.historyActions}>
                <button
                  className={styles.importBtn}
                  onClick={handleImportFromFile}
                  title="Import chat from file"
                >
                  <Upload size={14} />
                  <span>Import File</span>
                </button>
                <button 
                  className={styles.importBtn}
                  onClick={handleImportFromProject}
                  title="Import from another project"
                >
                  <FolderOpen size={14} />
                  <span>Import Project</span>
                </button>
                <button
                  className={styles.importBtn}
                  onClick={handleExportActiveConversation}
                  title={activeConversation ? 'Export current chat to file' : 'Export current chat (open a chat first)'}
                  disabled={!activeConversation}
                >
                  <Download size={14} />
                  <span>Export</span>
                </button>
                <button 
                  className={styles.closeHistoryBtn}
                  onClick={() => setShowHistory(false)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {importStatus && (
              <div className={styles.importStatus}>
                {importStatus}
              </div>
            )}
            <div className={styles.historyList}>
              {conversations.length === 0 ? (
                <div className={styles.historyEmpty}>
                  <MessageSquare size={24} />
                  <p>No conversations yet</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`${styles.historyItem} ${activeConversation?.id === conv.id ? styles.activeHistory : ''}`}
                    onClick={() => handleSelectConversation(conv.id)}
                  >
                    <div className={styles.historyItemContent}>
                      <span className={styles.historyTitle}>
                        {conv.title || 'New Conversation'}
                      </span>
                      <span className={styles.historyMeta}>
                        {conv.messages.length} messages · {formatDate(conv.updatedAt)}
                      </span>
                    </div>
                    <button
                      className={styles.historyDeleteBtn}
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      title="Delete conversation"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {showSettings && (
          <div className={styles.settings}>
            <AISettings onClose={() => setShowSettings(false)} />
          </div>
        )}

        {isDragging && (
          <div className={styles.dropOverlay}>
            <div className={styles.dropMessage}>
              <Paperclip size={32} />
              <p>Drop files here to attach</p>
            </div>
          </div>
        )}

        {previewImage && (
          <div 
            className={styles.imagePreviewOverlay}
            onClick={() => setPreviewImage(null)}
          >
            <div className={styles.imagePreviewContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.imagePreviewHeader}>
                <span className={styles.imagePreviewName}>{previewImage.name}</span>
                <button 
                  className={styles.imagePreviewClose}
                  onClick={() => setPreviewImage(null)}
                >
                  <X size={20} />
                </button>
              </div>
              <div className={styles.imagePreviewBody}>
                <img 
                  src={previewImage.src} 
                  alt={previewImage.name}
                  className={styles.imagePreviewImage}
                />
              </div>
            </div>
          </div>
        )}
        
        {showContextBreakdown && contextBreakdown && (
          <ContextBreakdownModal
            breakdown={contextBreakdown}
            onClose={() => setShowContextBreakdown(false)}
          />
        )}
      </div>
    </div>
  );
}

type CopilotUsageInfo = {
  total: number;
  added_this_cycle: number;
  pending_cancellation: number;
  pending_invitation: number;
  active_this_cycle: number;
  inactive_this_cycle: number;
  seat_management_setting?: string;
  plan_type?: string;
};

function AISettings({ onClose }: { onClose: () => void }) {
  const { config, setConfig, availableModels, copilotModelsMetadata, refreshAvailableModels } = useAIStore();
  const [copilotLoggedIn, setCopilotLoggedIn] = useState<boolean | null>(null);
  const [copilotPolling, setCopilotPolling] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotAccounts, setCopilotAccounts] = useState<CopilotCachedAccount[]>([]);
  const [copilotAccountsLoading, setCopilotAccountsLoading] = useState(false);
  const [copilotAccountsError, setCopilotAccountsError] = useState<string | null>(null);
  const [copilotAccountsNotice, setCopilotAccountsNotice] = useState<string | null>(null);
  const [copilotUseDeveloperOAuth, setCopilotUseDeveloperOAuth] = useState(false);
  const [showCopilotAccountPicker, setShowCopilotAccountPicker] = useState(false);
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<CopilotDeviceCode | null>(null);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [enterpriseTypeDraft, setEnterpriseTypeDraft] = useState<'ghe' | 'ghes'>('ghes');
  const [enterpriseHostDraft, setEnterpriseHostDraft] = useState('');
  const [enterpriseModalError, setEnterpriseModalError] = useState<string | null>(null);
  const [enterpriseLoginStarted, setEnterpriseLoginStarted] = useState(false);
  const [pendingEnterpriseLogin, setPendingEnterpriseLogin] = useState(false);
  const [copilotUsage, setCopilotUsage] = useState<CopilotUsageInfo | null>(null);
  const [copilotUsageError, setCopilotUsageError] = useState<string | null>(null);
  const [copilotUsageLoading, setCopilotUsageLoading] = useState(false);
  const [copilotOrgs, setCopilotOrgs] = useState<string[]>([]);
  const [copilotOrgsError, setCopilotOrgsError] = useState<string | null>(null);
  const [copilotOrgsLoading, setCopilotOrgsLoading] = useState(false);

  const resolveEnterpriseHost = useCallback((value: string, type: 'ghe' | 'ghes') => {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const stripProtocol = (input: string) =>
      input.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (type === 'ghe') {
      if (trimmed.includes('://')) {
        try {
          return new URL(trimmed).host;
        } catch {
          return stripProtocol(trimmed);
        }
      }
      const normalized = stripProtocol(trimmed);
      if (normalized.includes('.')) {
        return normalized;
      }
      return `${normalized}.ghe.com`;
    }
    return stripProtocol(trimmed);
  }, []);

  const copilotAuthMode = config.copilotAuthMode || 'github';
  const copilotEnterpriseType = (config.copilotEnterpriseType || 'ghes') as 'ghe' | 'ghes';
  const enterpriseHostInput = (config.copilotAuthHost || '').trim();
  const resolvedEnterpriseHost = useMemo(
    () => resolveEnterpriseHost(enterpriseHostInput, copilotEnterpriseType),
    [copilotEnterpriseType, enterpriseHostInput, resolveEnterpriseHost]
  );
  const draftResolvedEnterpriseHost = useMemo(
    () => resolveEnterpriseHost(enterpriseHostDraft, enterpriseTypeDraft),
    [enterpriseHostDraft, enterpriseTypeDraft, resolveEnterpriseHost]
  );
  const copilotAuthHost = useMemo(() => {
    if (copilotAuthMode === 'enterprise') {
      return resolvedEnterpriseHost;
    }
    return 'github.com';
  }, [copilotAuthMode, resolvedEnterpriseHost]);
  const copilotNeedsEnterpriseHost = copilotAuthMode === 'enterprise' && !enterpriseHostInput;
  const copilotEnterpriseClientId = (config.copilotClientId || '').trim();
  const copilotCanStartDeviceFlow = copilotAuthMode === 'enterprise' || !copilotNeedsEnterpriseHost;

  useEffect(() => {
    let isActive = true;
    if (config.provider !== 'copilot') {
      setCopilotPolling(false);
      setCopilotError(null);
      setCopilotLoggedIn(null);
      setCopilotAccounts([]);
      setCopilotAccountsLoading(false);
      setCopilotAccountsError(null);
      setCopilotAccountsNotice(null);
      setCopilotUseDeveloperOAuth(false);
      setShowCopilotAccountPicker(false);
      setCopilotDeviceCode(null);
      setShowEnterpriseModal(false);
      setEnterpriseModalError(null);
      setEnterpriseLoginStarted(false);
      setCopilotUsage(null);
      setCopilotUsageError(null);
      setCopilotUsageLoading(false);
      setCopilotOrgs([]);
      setCopilotOrgsError(null);
      setCopilotOrgsLoading(false);
      return () => {
        isActive = false;
      };
    }

    ai.copilotLoginStatus()
      .then((status) => {
        if (isActive) {
          setCopilotLoggedIn(status.logged_in);
        }
      })
      .catch(() => {
        if (isActive) {
          setCopilotLoggedIn(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [config.provider]);

  // Auto-refresh models when Copilot login status changes to logged in
  useEffect(() => {
    if (config.provider === 'copilot' && copilotLoggedIn === true) {
      console.log('[AISettings] Copilot logged in, refreshing models...');
      refreshAvailableModels();
    }
  }, [config.provider, copilotLoggedIn, refreshAvailableModels]);

  useEffect(() => {
    if (copilotAuthMode === 'enterprise' && copilotUseDeveloperOAuth) {
      setCopilotUseDeveloperOAuth(false);
    }
    if (copilotAuthMode !== 'enterprise') {
      setEnterpriseLoginStarted(false);
      setCopilotAccountsNotice(null);
    }
  }, [copilotAuthMode, copilotUseDeveloperOAuth]);

  const reloadCopilotAccounts = useCallback(async (): Promise<CopilotCachedAccount[]> => {
    setCopilotAccountsError(null);
    setCopilotAccountsLoading(true);
    try {
      if (copilotAuthMode === 'enterprise' && !copilotAuthHost) {
        setCopilotAccounts([]);
        setCopilotAccountsError('Enter your Enterprise host to load cached accounts.');
        return [];
      }
      const cached = await ai.copilotCachedAccountsList(copilotAuthHost || undefined);
      console.debug('[copilot] reload accounts', cached);
      setCopilotAccounts(cached);
      if (cached.length > 0) {
        setCopilotAccountsError(null);
        setCopilotAccountsNotice(null);
        if (enterpriseLoginStarted) {
          setEnterpriseLoginStarted(false);
        }
      } else if (!enterpriseLoginStarted) {
        setCopilotAccountsError('No Copilot accounts found for this host.');
      } else {
        setCopilotAccountsError(null);
      }
      return cached;
    } catch (error) {
      console.debug('[copilot] reload accounts failed', error);
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to load Copilot accounts.';
      setCopilotAccountsError(message);
      return [];
    } finally {
      setCopilotAccountsLoading(false);
    }
  }, [copilotAuthHost, copilotAuthMode, enterpriseLoginStarted]);

  useEffect(() => {
    if (config.provider !== 'copilot') {
      return;
    }
    let isActive = true;
    reloadCopilotAccounts().finally(() => {
      if (!isActive) {
        return;
      }
    });
    return () => {
      isActive = false;
    };
  }, [config.provider, reloadCopilotAccounts]);

  useEffect(() => {
    if (config.provider !== 'copilot') {
      return;
    }
    setCopilotDeviceCode(null);
    void reloadCopilotAccounts();
  }, [config.provider, copilotAuthHost, copilotAuthMode, reloadCopilotAccounts]);

  useEffect(() => {
    let isActive = true;
    if (config.provider !== 'copilot' || !copilotLoggedIn) {
      setCopilotOrgs([]);
      setCopilotOrgsError(null);
      setCopilotOrgsLoading(false);
      return () => {
        isActive = false;
      };
    }

    const loadOrgs = async () => {
      setCopilotOrgsError(null);
      setCopilotOrgsLoading(true);
      try {
        const orgs = await ai.copilotListOrgs();
        if (!isActive) return;
        setCopilotOrgs(orgs);
        if (!config.copilotUsageOrg && orgs.length > 0) {
          setConfig({ copilotUsageOrg: orgs[0] });
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : typeof error === 'string'
          ? error
          : 'Failed to load organizations.';
        if (isActive) {
          setCopilotOrgsError(message);
        }
      } finally {
        if (isActive) {
          setCopilotOrgsLoading(false);
        }
      }
    };

    loadOrgs();

    return () => {
      isActive = false;
    };
  }, [config.provider, copilotLoggedIn, config.copilotUsageOrg, setConfig]);

  const handleCopilotOrgsLoad = async () => {
    setCopilotOrgsError(null);
    setCopilotOrgsLoading(true);
    try {
      const orgs = await ai.copilotListOrgs();
      setCopilotOrgs(orgs);
      if (!config.copilotUsageOrg && orgs.length > 0) {
        setConfig({ copilotUsageOrg: orgs[0] });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to load organizations.';
      setCopilotOrgsError(message);
    } finally {
      setCopilotOrgsLoading(false);
    }
  };

  const handleCopilotLogin = async () => {
    setCopilotError(null);
    setCopilotPolling(false);

    const clientId = (config.copilotClientId || '').trim();
    const clientSecret = (config.copilotClientSecret || '').trim();

    if (!clientId || !clientSecret) {
      setCopilotError('GitHub OAuth client ID and secret are required.');
      return;
    }

    try {
      const start = await ai.copilotOAuthStart(clientId);
      await shell.openExternal(start.authorize_url);
      setCopilotPolling(true);
      await ai.copilotOAuthPoll(start.state, clientId, clientSecret);
      setCopilotLoggedIn(true);
      await refreshAvailableModels();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to connect to Copilot';
      setCopilotError(errorMessage);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  };

  const openEnterpriseModal = (startLogin: boolean) => {
    setEnterpriseTypeDraft(copilotEnterpriseType);
    setEnterpriseHostDraft(enterpriseHostInput);
    setEnterpriseModalError(null);
    setPendingEnterpriseLogin(startLogin);
    setShowEnterpriseModal(true);
  };

  const handleEnterpriseLogin = async (
    hostInput: string = enterpriseHostInput,
    type: 'ghe' | 'ghes' = copilotEnterpriseType
  ) => {
    const resolvedHost = resolveEnterpriseHost(hostInput, type);
    if (!resolvedHost) {
      openEnterpriseModal(true);
      return;
    }
    const loginUrl = `https://${resolvedHost}/login`;
    try {
      await shell.openExternal(loginUrl);
      setEnterpriseLoginStarted(true);
      setCopilotAccountsNotice(
        'Finish signing in with GitHub Enterprise, then click Reload accounts.'
      );
      setCopilotAccountsError(null);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to open Enterprise login.';
      setCopilotAccountsError(errorMessage);
    }
  };

  const handleEnterpriseModalContinue = async () => {
    const trimmedHost = enterpriseHostDraft.trim();
    if (!trimmedHost) {
      setEnterpriseModalError('Enterprise host is required.');
      return;
    }
    setConfig({
      copilotEnterpriseType: enterpriseTypeDraft,
      copilotAuthHost: trimmedHost,
    });
    setShowEnterpriseModal(false);
    setEnterpriseModalError(null);
    const shouldLogin = pendingEnterpriseLogin;
    setPendingEnterpriseLogin(false);
    if (shouldLogin) {
      await handleEnterpriseLogin(trimmedHost, enterpriseTypeDraft);
    }
  };

  const copyCopilotCode = useCallback(async (code: string) => {
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (error) {
      console.error('Failed to copy Copilot code:', error);
    }
  }, []);

  const handleCopilotDeviceFlow = async () => {
    setCopilotError(null);
    setCopilotAccountsError(null);
    setCopilotAccountsNotice(null);
    setCopilotPolling(false);
    setCopilotDeviceCode(null);

    if (copilotAuthMode === 'enterprise') {
      await handleEnterpriseLogin();
      return;
    }

    try {
      // Enterprise auth is handled above; after that branch, we are always on GitHub.com device flow.
      const deviceFlowClientId = undefined;
      const deviceCode = await ai.copilotDeviceLoginStart(
        copilotAuthHost || undefined,
        deviceFlowClientId
      );
      setCopilotDeviceCode(deviceCode);
      await shell.openExternal(deviceCode.verification_uri);
      setCopilotPolling(true);
      await ai.copilotDeviceLoginPoll(
        deviceCode.device_code,
        deviceCode.interval,
        deviceCode.expires_in,
        copilotAuthHost || undefined,
        deviceFlowClientId
      );
      setCopilotLoggedIn(true);
      setShowCopilotAccountPicker(false);
      await reloadCopilotAccounts();
      await refreshAvailableModels();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to connect to Copilot';
      setCopilotError(errorMessage);
      setCopilotAccountsError(errorMessage);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  };

  const handleCopilotSignIn = async () => {
    if (copilotUseDeveloperOAuth) {
      await handleCopilotLogin();
      return;
    }
    setCopilotError(null);
    setCopilotDeviceCode(null);
    setShowCopilotAccountPicker(true);
    const accounts = await reloadCopilotAccounts();
    if (accounts.length === 0) {
      await handleCopilotDeviceFlow();
      return;
    }
  };

  const handleCopilotChangeAccount = async () => {
    setCopilotError(null);
    setCopilotUseDeveloperOAuth(false);
    setCopilotDeviceCode(null);
    setShowCopilotAccountPicker(true);
    const accounts = await reloadCopilotAccounts();
    if (accounts.length === 0) {
      await handleCopilotDeviceFlow();
      return;
    }
  };

  const handleCopilotAccountSelect = async (account: CopilotCachedAccount) => {
    setCopilotError(null);
    setCopilotPolling(false);
    try {
      setCopilotPolling(true);
      await ai.copilotCachedAccountImport(account.host, account.username);
      setCopilotLoggedIn(true);
      setShowCopilotAccountPicker(false);
      await refreshAvailableModels();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to reuse Copilot account';
      setCopilotError(errorMessage);
      setCopilotLoggedIn(false);
    } finally {
      setCopilotPolling(false);
    }
  };

  const handleCopilotLogout = async () => {
    setCopilotError(null);
    try {
      await ai.copilotDeviceLogout();
      setCopilotLoggedIn(false);
      setCopilotUseDeveloperOAuth(false);
      setShowCopilotAccountPicker(true);
      setCopilotDeviceCode(null);
      await reloadCopilotAccounts();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to disconnect Copilot';
      setCopilotError(errorMessage);
    }
  };

  const handleCopilotUsageLoad = async () => {
    setCopilotUsageError(null);
    setCopilotUsageLoading(true);
    try {
      const org = config.copilotUsageOrg || '';
      const usage = await ai.copilotBillingInfo(org);
      setCopilotUsage(usage);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to load Copilot usage.';
      setCopilotUsageError(message);
      setCopilotUsage(null);
    } finally {
      setCopilotUsageLoading(false);
    }
  };

  return (
    <div className={styles.settingsContent}>
      <div className={styles.settingsHeader}>
        <h3>AI Settings</h3>
        <button 
          className={styles.closeHistoryBtn}
          onClick={onClose}
          title="Close settings"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.settingsBody}>
        <div className={styles.settingGroup}>
          <label>Provider</label>
          <select
            value={config.provider}
            onChange={(e) => setConfig({ provider: e.target.value as any })}
          >
            <option value="ollama">Ollama (Local)</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="copilot">GitHub Copilot</option>
            <option value="custom">Custom Endpoint</option>
          </select>
        </div>

        {config.provider === 'copilot' && (
          <>
            <div className={styles.settingGroup}>
              <label>GitHub Copilot</label>
              <div className={styles.copilotHostRow}>
                <label className={styles.copilotHostOption}>
                  <input
                    type="radio"
                    name="copilot-host"
                    checked={copilotAuthMode === 'github'}
                    onChange={() => {
                      setConfig({ copilotAuthMode: 'github', copilotAuthHost: 'github.com' });
                      setCopilotDeviceCode(null);
                    }}
                  />
                  GitHub.com
                </label>
                <label className={styles.copilotHostOption}>
                  <input
                    type="radio"
                    name="copilot-host"
                    checked={copilotAuthMode === 'enterprise'}
                    onChange={() => {
                      setConfig({
                        copilotAuthMode: 'enterprise',
                        copilotAuthHost:
                          config.copilotAuthHost === 'github.com'
                            ? ''
                            : (config.copilotAuthHost || ''),
                        copilotEnterpriseType: config.copilotEnterpriseType || 'ghes',
                      });
                      setCopilotDeviceCode(null);
                    }}
                  />
                  Enterprise
                </label>
              </div>
              {copilotAuthMode === 'enterprise' && (
                <div className={styles.copilotEnterpriseRow}>
                  <div className={styles.copilotEnterpriseInfo}>
                    <span className={styles.copilotEnterpriseLabel}>
                      {enterpriseHostInput
                        ? copilotEnterpriseType === 'ghe'
                          ? 'GHE.com (Enterprise Cloud)'
                          : 'GitHub Enterprise Server'
                        : 'Enterprise not configured'}
                    </span>
                    {enterpriseHostInput && (
                      <span className={styles.settingHint}>
                        Using {resolvedEnterpriseHost}
                      </span>
                    )}
                  </div>
                  <button
                    className={styles.copilotButton}
                    type="button"
                    onClick={() => openEnterpriseModal(false)}
                  >
                    Configure Enterprise
                  </button>
                </div>
              )}
              {!copilotUseDeveloperOAuth && showCopilotAccountPicker && (
                <>
                  {copilotAccountsLoading && (
                    <p className={styles.settingHint}>Loading cached Copilot accounts...</p>
                  )}
                  {!copilotAccountsLoading && (
                    <div className={styles.copilotAccountBox}>
                      <div className={styles.copilotAccountHeader}>
                        <span>
                          {copilotAuthMode === 'enterprise'
                            ? `Enterprise accounts on ${resolvedEnterpriseHost || 'Enterprise'}`
                            : 'Cached GitHub.com accounts'}
                        </span>
                        <div className={styles.copilotAccountActions}>
                          <button
                            className={styles.copilotButton}
                            type="button"
                            onClick={handleCopilotDeviceFlow}
                            disabled={copilotPolling || !copilotCanStartDeviceFlow}
                            title={
                              copilotCanStartDeviceFlow
                                ? copilotAuthMode === 'enterprise'
                                  ? 'Open Enterprise login'
                                  : 'Start device login'
                                : 'Enter an Enterprise host first.'
                            }
                          >
                            {copilotAuthMode === 'enterprise' ? 'Open login' : 'Add account'}
                          </button>
                            <button
                              className={styles.copilotButton}
                              type="button"
                              onClick={() => void reloadCopilotAccounts()}
                            >
                            {copilotAuthMode === 'enterprise' && enterpriseLoginStarted
                              ? "I've signed in"
                              : 'Reload'}
                          </button>
                          <button
                            className={styles.copilotButton}
                            type="button"
                            onClick={() => setShowCopilotAccountPicker(false)}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      {copilotDeviceCode && (
                        <div className={styles.copilotDeviceBox}>
                          <div className={styles.copilotDeviceRow}>
                            <span>Enter code</span>
                            <span className={styles.copilotDeviceCode}>{copilotDeviceCode.user_code}</span>
                            <button
                              className={styles.copilotButton}
                              type="button"
                              onClick={() => void copyCopilotCode(copilotDeviceCode.user_code)}
                            >
                              Copy
                            </button>
                          </div>
                          <div className={styles.copilotDeviceRow}>
                            <span>Verification</span>
                            <button
                              className={styles.copilotButton}
                              type="button"
                              onClick={() => void shell.openExternal(copilotDeviceCode.verification_uri)}
                            >
                              Open page
                            </button>
                          </div>
                        </div>
                      )}
                      {copilotAccounts.length === 0 ? (
                        <p className={styles.copilotError}>
                          No accounts detected yet. Use {copilotAuthMode === 'enterprise' ? '"Open login"' : '"Add account"'} to sign in.
                        </p>
                      ) : (
                        <>
                          {copilotAccounts.length > 0 && (
                            <>
                              <p className={styles.settingHint}>Cached accounts</p>
                              {copilotAccounts.map((account, index) => (
                                <div
                                  key={`${account.host}-${account.username}-${index}`}
                                  className={styles.copilotAccountRow}
                                >
                                  <div className={styles.copilotAccountInfo}>
                                    <span className={styles.copilotAccountUser}>{account.username}</span>
                                    <span className={styles.copilotAccountSource}>{account.source}</span>
                                  </div>
                                  <button
                                    className={styles.copilotButton}
                                    type="button"
                                    onClick={() => handleCopilotAccountSelect(account)}
                                    disabled={copilotPolling}
                                  >
                                    Select
                                  </button>
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {copilotAccountsError && <p className={styles.copilotError}>{copilotAccountsError}</p>}
                  {copilotAccountsNotice && <p className={styles.settingHint}>{copilotAccountsNotice}</p>}
                </>
              )}
              <div className={styles.copilotStatusRow}>
                <span
                  className={`${styles.copilotStatus} ${
                    copilotLoggedIn ? styles.copilotConnected : styles.copilotDisconnected
                  }`}
                >
                  {copilotLoggedIn ? 'Connected' : 'Not connected'}
                </span>
                {copilotLoggedIn ? (
                  <div className={styles.copilotAuthActions}>
                    <button
                      className={styles.copilotButton}
                      onClick={handleCopilotChangeAccount}
                      type="button"
                    >
                      Change account
                    </button>
                    <button
                      className={styles.copilotButton}
                      onClick={handleCopilotLogout}
                      type="button"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className={styles.copilotAuthActions}>
                    <button
                      className={styles.copilotButton}
                      onClick={handleCopilotSignIn}
                      type="button"
                      disabled={copilotPolling}
                    >
                      {copilotPolling ? 'Connecting...' : 'Select account'}
                    </button>
                  </div>
                )}
              </div>
              {copilotPolling && (
                <p className={styles.settingHint}>Connecting to Copilot...</p>
              )}
              {!copilotLoggedIn && copilotAuthMode === 'github' && (
                <label className={styles.copilotCheckboxRow}>
                  <input
                    className={styles.copilotCheckbox}
                    type="checkbox"
                    checked={copilotUseDeveloperOAuth}
                    onChange={(event) => {
                      setCopilotUseDeveloperOAuth(event.target.checked);
                      setShowCopilotAccountPicker(false);
                      setCopilotAccountsError(null);
                      setCopilotDeviceCode(null);
                    }}
                  />
                  Use developer OAuth client ID + secret
                </label>
              )}
              {!copilotLoggedIn && (
                <p className={styles.settingHint}>
                  {copilotAuthMode === 'enterprise'
                    ? 'Enterprise login opens your instance in the browser. After signing in, click Reload accounts.'
                    : "Device login uses GitHub's device flow and caches accounts locally. OAuth app login uses a client ID + secret with a local callback."}
                </p>
              )}
              {copilotAccountsError && <p className={styles.copilotError}>{copilotAccountsError}</p>}
              {copilotError && <p className={styles.copilotError}>{copilotError}</p>}
            </div>
            {copilotUseDeveloperOAuth && copilotAuthMode === 'github' && (
              <>
                <div className={styles.settingGroup}>
                  <label>OAuth Client ID</label>
                  <input
                    type="text"
                    value={config.copilotClientId || ''}
                    onChange={(e) => setConfig({ copilotClientId: e.target.value })}
                    placeholder="GitHub OAuth App client ID"
                  />
                  <p className={styles.settingHint}>
                    Create a GitHub OAuth App with redirect URL set to http://127.0.0.1:1717/callback.
                  </p>
                </div>
                <div className={styles.settingGroup}>
                  <label>OAuth Client Secret</label>
                  <input
                    type="password"
                    value={config.copilotClientSecret || ''}
                    onChange={(e) => setConfig({ copilotClientSecret: e.target.value })}
                    placeholder="GitHub OAuth App client secret"
                  />
                  <p className={styles.settingHint}>
                    Stored locally to complete the OAuth token exchange.
                  </p>
                </div>
              </>
            )}
            {showEnterpriseModal && (
              <div className={styles.enterpriseModalBackdrop}>
                <div className={styles.enterpriseModal}>
                  <div className={styles.enterpriseModalHeader}>
                    Sign in with GitHub Enterprise
                  </div>
                  <p className={styles.settingHint}>
                    Select your GitHub Enterprise type and enter instance details.
                  </p>
                  <div className={styles.enterpriseModalOptions}>
                    <label className={styles.enterpriseModalOption}>
                      <input
                        type="radio"
                        name="enterprise-type"
                        checked={enterpriseTypeDraft === 'ghe'}
                        onChange={() => setEnterpriseTypeDraft('ghe')}
                      />
                      GHE.com (Enterprise Cloud)
                    </label>
                    <label className={styles.enterpriseModalOption}>
                      <input
                        type="radio"
                        name="enterprise-type"
                        checked={enterpriseTypeDraft === 'ghes'}
                        onChange={() => setEnterpriseTypeDraft('ghes')}
                      />
                      GitHub Enterprise Server
                    </label>
                  </div>
                  <input
                    type="text"
                    value={enterpriseHostDraft}
                    onChange={(event) => setEnterpriseHostDraft(event.target.value)}
                    placeholder={
                      enterpriseTypeDraft === 'ghe'
                        ? 'octocat or https://octocat.ghe.com/'
                        : 'scm.company.com'
                    }
                  />
                  {enterpriseTypeDraft === 'ghe' ? (
                    <p className={styles.settingHint}>
                      Enter a GHE.com instance name or URL.
                    </p>
                  ) : (
                    <p className={styles.settingHint}>
                      Will resolve to https://{draftResolvedEnterpriseHost || 'scm.company.com'}/
                    </p>
                  )}
                  {enterpriseModalError && (
                    <p className={styles.copilotError}>{enterpriseModalError}</p>
                  )}
                  <div className={styles.enterpriseModalActions}>
                    <button
                      className={styles.copilotButton}
                      type="button"
                      onClick={() => {
                        setShowEnterpriseModal(false);
                        setEnterpriseModalError(null);
                        setPendingEnterpriseLogin(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.copilotButton}
                      type="button"
                      onClick={handleEnterpriseModalContinue}
                      disabled={!enterpriseHostDraft.trim()}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className={styles.settingGroup}>
              <label>Quota usage (organization)</label>
              {copilotOrgs.length > 0 ? (
                <select
                  value={config.copilotUsageOrg || ''}
                  onChange={(e) => setConfig({ copilotUsageOrg: e.target.value })}
                >
                  {copilotOrgs.map((org) => (
                    <option key={org} value={org}>
                      {org}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.copilotUsageOrg || ''}
                  onChange={(e) => setConfig({ copilotUsageOrg: e.target.value })}
                  placeholder="Organization name (e.g. my-org)"
                />
              )}
              {!copilotOrgsLoading && copilotOrgs.length === 0 && !copilotOrgsError && (
                <p className={styles.settingHint}>
                  No admin-owned organizations found for this account.
                </p>
              )}
              <div className={styles.copilotUsageActions}>
                <button
                  className={styles.copilotButton}
                  onClick={handleCopilotUsageLoad}
                  type="button"
                  disabled={copilotUsageLoading}
                >
                  {copilotUsageLoading ? 'Loading usage...' : 'Load usage'}
                </button>
                <button
                  className={styles.copilotButton}
                  onClick={handleCopilotOrgsLoad}
                  type="button"
                  disabled={copilotOrgsLoading}
                >
                  {copilotOrgsLoading ? 'Loading orgs...' : 'Reload orgs'}
                </button>
              </div>
              {copilotOrgsError && <p className={styles.copilotError}>{copilotOrgsError}</p>}
              {copilotUsageError && <p className={styles.copilotError}>{copilotUsageError}</p>}
              {copilotUsage && (
                <div className={styles.copilotUsageBox}>
                  <div className={styles.copilotUsageRow}>
                    <span>Total seats</span>
                    <span>{copilotUsage.total}</span>
                  </div>
                  <div className={styles.copilotUsageRow}>
                    <span>Active this cycle</span>
                    <span>{copilotUsage.active_this_cycle}</span>
                  </div>
                  <div className={styles.copilotUsageRow}>
                    <span>Inactive this cycle</span>
                    <span>{copilotUsage.inactive_this_cycle}</span>
                  </div>
                  <div className={styles.copilotUsageRow}>
                    <span>Added this cycle</span>
                    <span>{copilotUsage.added_this_cycle}</span>
                  </div>
                  <div className={styles.copilotUsageRow}>
                    <span>Pending invitations</span>
                    <span>{copilotUsage.pending_invitation}</span>
                  </div>
                  <div className={styles.copilotUsageRow}>
                    <span>Pending cancellations</span>
                    <span>{copilotUsage.pending_cancellation}</span>
                  </div>
                  {(copilotUsage.plan_type || copilotUsage.seat_management_setting) && (
                    <div className={styles.copilotUsageMeta}>
                      {copilotUsage.plan_type && <span>Plan: {copilotUsage.plan_type}</span>}
                      {copilotUsage.seat_management_setting && (
                        <span>Seat management: {copilotUsage.seat_management_setting}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className={styles.settingHint}>
                Uses the GitHub Copilot billing API for org owners. If you signed in before this update,
                sign out and sign in again to grant read:org access. Only admin-owned orgs are shown.
              </p>
            </div>
          </>
        )}

        <div className={styles.settingGroup}>
          <label>Model</label>
          <div className={styles.modelInput}>
            <select
              value={config.model}
              onChange={(e) => setConfig({ model: e.target.value })}
              title={config.provider === 'copilot' ? getModelPricingTooltip(config.model, copilotModelsMetadata) : undefined}
            >
              {availableModels[config.provider]?.map((model) => (
                <option 
                  key={model} 
                  value={model}
                >
                  {formatModelLabel(config.provider, model, copilotModelsMetadata)}
                </option>
              ))}
            </select>
            {(config.provider === 'ollama' || config.provider === 'copilot') && (
              <button
                onClick={refreshAvailableModels}
                title={config.provider === 'copilot' && !copilotLoggedIn ? 'Connect Copilot to load models' : 'Refresh models'}
                disabled={config.provider === 'copilot' && !copilotLoggedIn}
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
          {/* Model info panel for Copilot models */}
          {config.provider === 'copilot' && config.model !== 'auto' && (() => {
            const modelMeta = copilotModelsMetadata?.find(m => m.id === config.model);
            
            if (!modelMeta) {
              // Show basic info when metadata isn't available
              return (
                <div className={styles.modelInfoPanel}>
                  <div className={styles.modelInfoHeader}>{config.model}</div>
                  <div className={styles.modelInfoRow} style={{ color: 'var(--text-muted)' }}>
                    <span>Pricing info not available. Click refresh to load model details.</span>
                  </div>
                </div>
              );
            }
            
            const capabilities: string[] = [];
            if (modelMeta.supports_vision) capabilities.push('Vision');
            if (modelMeta.supports_tools) capabilities.push('Tools');
            if (modelMeta.reasoning_efforts.length > 0) {
              capabilities.push(`Thinking (${modelMeta.reasoning_efforts.join('/')})`);
            }
            
            return (
              <div className={styles.modelInfoPanel}>
                <div className={styles.modelInfoHeader}>{modelMeta.name}</div>
                {modelMeta.context_window && (
                  <div className={styles.modelInfoRow}>
                    <span>Context Window:</span>
                    <span>{formatContextWindow(modelMeta.context_window)}</span>
                  </div>
                )}
                {(modelMeta.input_price !== null || modelMeta.output_price !== null) && (
                  <>
                    <div className={styles.modelInfoSection}>Cost per 1M Tokens</div>
                    {modelMeta.input_price !== null && (
                      <div className={styles.modelInfoRow}>
                        <span>Input:</span>
                        <span>{modelMeta.input_price} Credits</span>
                      </div>
                    )}
                    {modelMeta.output_price !== null && (
                      <div className={styles.modelInfoRow}>
                        <span>Output:</span>
                        <span>{modelMeta.output_price} Credits</span>
                      </div>
                    )}
                    {modelMeta.cache_price !== null && (
                      <div className={styles.modelInfoRow}>
                        <span>Cached:</span>
                        <span>{modelMeta.cache_price} Credits</span>
                      </div>
                    )}
                  </>
                )}
                {capabilities.length > 0 && (
                  <div className={styles.modelInfoCapabilities}>
                    {capabilities.map(cap => (
                      <span key={cap} className={styles.capabilityBadge}>{cap}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {config.provider === 'ollama' && (() => {
            const modelLower = config.model.toLowerCase();
            const isVisionModel = modelLower.includes('llava') || 
                                  modelLower.includes('bakllava') || 
                                  modelLower.includes('qwen2-vl') || 
                                  modelLower.includes('qwen-vl') ||
                                  modelLower.includes('qwen3-vl') ||
                                  modelLower.includes('qwenvl') ||
                                  modelLower.includes('vision') ||
                                  modelLower.includes('minicpm-v') ||
                                  modelLower.includes('paligemma');
            
            if (!isVisionModel) {
              return (
                <div className={styles.warningBox}>
                  <div className={styles.warningIcon}>⚠️</div>
                  <div>
                    <strong>Image Support Not Available</strong>
                    <p>The current model <code>{config.model}</code> does not support images.</p>
                    <p>To use image attachments, install a vision model:</p>
                    <ul>
                      <li><code>ollama pull qwen-vl</code> (Qwen Vision - check latest version)</li>
                      <li><code>ollama pull llava</code> (LLaVA - popular)</li>
                      <li><code>ollama pull paligemma</code> (Google PaliGemma)</li>
                      <li><code>ollama pull bakllava</code> (BakLLaVA)</li>
                      <li><code>ollama pull minicpm-v</code> (MiniCPM Vision)</li>
                    </ul>
                    <p>Then refresh models and select the vision model.</p>
                    <p className={styles.noteText}>
                      <strong>Note:</strong> Standard models (qwen2.5, qwen3.5, gemma2) are text-only. 
                      You need vision variants (qwen-vl, paligemma) for image support.
                    </p>
                  </div>
                </div>
              );
            } else {
              return (
                <p className={styles.settingHint}>
                  ✅ Vision support enabled - you can attach images to your prompts
                </p>
              );
            }
          })()}
          {(config.provider === 'openai' || config.provider === 'claude') && (
            <p className={styles.settingHint}>
              ✅ Vision support available - attach images using the attach button
            </p>
          )}
          {config.provider === 'copilot' && (
            <p className={styles.settingHint}>
              ✅ Vision support available - attach images using the attach button
            </p>
          )}
        </div>

        {(config.provider === 'openai' || config.provider === 'claude' || config.provider === 'custom') && (
          <div className={styles.settingGroup}>
            <label>API Key</label>
            <input
              type="password"
              value={config.apiKey || ''}
              onChange={(e) => setConfig({ apiKey: e.target.value })}
              placeholder="Enter API key..."
            />
          </div>
        )}

        {(config.provider === 'ollama' || config.provider === 'custom') && (
          <div className={styles.settingGroup}>
            <label>Base URL</label>
            <input
              type="text"
              value={config.baseUrl || ''}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="http://localhost:11434"
            />
          </div>
        )}

        <div className={styles.settingGroup}>
          <label>Temperature: {config.temperature}</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={config.temperature}
            onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) })}
          />
        </div>

        <div className={styles.settingGroup}>
          <label>Max Tokens</label>
          <input
            type="number"
            value={config.maxTokens}
            onChange={(e) => setConfig({ maxTokens: parseInt(e.target.value) })}
            min="100"
            max="100000"
          />
        </div>

        {(config.provider === 'ollama' || config.provider === 'custom') && (
          <>
            <div className={styles.settingsDivider}>
              <span>Cost Tracking</span>
            </div>
            
            <div className={styles.settingGroup}>
              <div className={styles.settingToggleRow}>
                <div>
                  <label>Custom Pricing</label>
                  <p className={styles.settingHint}>
                    Set custom token rates for cost estimation (e.g., for Ollama Cloud or custom providers)
                  </p>
                </div>
                <button
                  className={`${styles.toggleSwitch} ${config.customPricing?.enabled ? styles.on : ''}`}
                  onClick={() => setConfig({ 
                    customPricing: { 
                      enabled: !config.customPricing?.enabled,
                      inputPerMillion: config.customPricing?.inputPerMillion || 0,
                      outputPerMillion: config.customPricing?.outputPerMillion || 0,
                    } 
                  })}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            </div>

            {config.customPricing?.enabled && (
              <div className={styles.customPricingFields}>
                <div className={styles.settingGroup}>
                  <label>Input Price ($ per 1M tokens)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={config.customPricing?.inputPerMillion || 0}
                    onChange={(e) => setConfig({ 
                      customPricing: { 
                        ...config.customPricing,
                        enabled: true,
                        inputPerMillion: parseFloat(e.target.value) || 0,
                        outputPerMillion: config.customPricing?.outputPerMillion || 0,
                      } 
                    })}
                    placeholder="0.00"
                  />
                </div>
                <div className={styles.settingGroup}>
                  <label>Output Price ($ per 1M tokens)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={config.customPricing?.outputPerMillion || 0}
                    onChange={(e) => setConfig({ 
                      customPricing: { 
                        ...config.customPricing,
                        enabled: true,
                        inputPerMillion: config.customPricing?.inputPerMillion || 0,
                        outputPerMillion: parseFloat(e.target.value) || 0,
                      } 
                    })}
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div className={styles.settingsDivider}>
          <span>Reasoning Options</span>
        </div>

        <div className={styles.settingGroup}>
          <div className={styles.settingToggleRow}>
            <div>
              <label>Think Aloud</label>
              <p className={styles.settingHint}>
                AI shows its reasoning process step by step (works with all providers)
              </p>
            </div>
            <button
              className={`${styles.toggleSwitch} ${config.thinkAloud ? styles.on : ''}`}
              onClick={() => setConfig({ thinkAloud: !config.thinkAloud })}
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
        </div>

        {config.provider === 'claude' && (
          <div className={styles.settingGroup}>
            <div className={styles.settingToggleRow}>
              <div>
                <label>Extended Thinking</label>
                <p className={styles.settingHint}>
                  Use Claude's native thinking blocks with real-time thought streaming (requires Claude 3+ model and API key)
                </p>
              </div>
              <button
                className={`${styles.toggleSwitch} ${config.claudeExtendedThinking ? styles.active : ''}`}
                onClick={() => setConfig({ claudeExtendedThinking: !config.claudeExtendedThinking })}
                disabled={config.provider !== 'claude'}
                title={config.provider !== 'claude' ? 'Only available for Claude provider' : 'Toggle extended thinking'}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          </div>
        )}

        <div className={styles.settingsDivider}>
          <span>Subagents</span>
        </div>

        <SubagentProfilesSection />

        <div className={styles.settingsDivider}>
          <span>MCP Servers</span>
        </div>

        <MCPServersSection />
      </div>
    </div>
  );
}

function SubagentProfilesSection() {
  const { config, setConfig, availableModels, copilotModelsMetadata } = useAIStore();
  const profiles = (config.subagentProfiles || []) as SubagentProfile[];
  const defaultId = config.defaultSubagentProfileId || profiles[0]?.id || '';

  const updateProfiles = (next: SubagentProfile[]) => {
    setConfig({
      subagentProfiles: next,
      defaultSubagentProfileId: next.some((p) => p.id === defaultId)
        ? defaultId
        : next[0]?.id,
    });
  };

  const addProfile = () => {
    const id = crypto.randomUUID();
    const next: SubagentProfile = {
      id,
      name: 'New Subagent',
      provider: undefined,
      model: undefined,
      systemPromptAddendum: '',
    };
    const updated = [...profiles, next];
    setConfig({
      subagentProfiles: updated,
      defaultSubagentProfileId: config.defaultSubagentProfileId || id,
    });
  };

  const removeProfile = (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    const nextDefault = config.defaultSubagentProfileId === id ? (updated[0]?.id || undefined) : config.defaultSubagentProfileId;
    setConfig({ subagentProfiles: updated, defaultSubagentProfileId: nextDefault });
  };

  return (
    <div className={styles.settingGroup}>
      <div className={styles.settingHint} style={{ marginBottom: 8 }}>
        Subagent profiles let you launch parallel runs with different instructions (and optional model/provider overrides).
      </div>

      {profiles.length === 0 ? (
        <div className={styles.settingHint} style={{ marginBottom: 8 }}>
          No profiles yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profiles.map((p) => {
            const providerValue = p.provider || '';
            const providerModels = providerValue ? (availableModels as any)[providerValue] || [] : [];
            return (
              <div key={p.id} style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="radio"
                    name="default-subagent"
                    checked={(config.defaultSubagentProfileId || defaultId) === p.id}
                    onChange={() => setConfig({ defaultSubagentProfileId: p.id })}
                    title="Default subagent profile"
                  />
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updateProfiles(profiles.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className={styles.copilotButton} onClick={() => removeProfile(p.id)}>
                    Remove
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div className={styles.settingGroup} style={{ flex: '1 1 180px', marginBottom: 0 }}>
                    <label>Provider override</label>
                    <select
                      value={providerValue}
                      onChange={(e) => {
                        const value = (e.target.value || undefined) as AIProvider | undefined;
                        updateProfiles(profiles.map((x) => (x.id === p.id ? { ...x, provider: value, model: undefined } : x)));
                      }}
                    >
                      <option value="">(inherit)</option>
                      <option value="ollama">ollama</option>
                      <option value="claude">claude</option>
                      <option value="openai">openai</option>
                      <option value="copilot">copilot</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>

                  <div className={styles.settingGroup} style={{ flex: '1 1 220px', marginBottom: 0 }}>
                    <label>Model override</label>
                    {providerValue ? (
                      <select
                        value={p.model || ''}
                        onChange={(e) => updateProfiles(profiles.map((x) => (x.id === p.id ? { ...x, model: e.target.value || undefined } : x)))}
                        title={providerValue === 'copilot' ? getModelPricingTooltip(p.model || '', copilotModelsMetadata) : undefined}
                      >
                        <option value="">(inherit)</option>
                        {providerModels.map((m: string) => (
                          <option key={m} value={m}>
                            {formatModelLabel(providerValue, m, copilotModelsMetadata)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={p.model || ''}
                        onChange={(e) => updateProfiles(profiles.map((x) => (x.id === p.id ? { ...x, model: e.target.value || undefined } : x)))}
                        placeholder="(inherit)"
                      />
                    )}
                  </div>
                </div>

                <div className={styles.settingGroup} style={{ marginTop: 8 }}>
                  <label>Prompt addendum</label>
                  <textarea
                    value={p.systemPromptAddendum || ''}
                    onChange={(e) => updateProfiles(profiles.map((x) => (x.id === p.id ? { ...x, systemPromptAddendum: e.target.value } : x)))}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                    placeholder="Extra instructions for this subagent..."
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className={styles.copilotButton} onClick={addProfile}>
          Add profile
        </button>
      </div>
    </div>
  );
}

const BUILT_IN_MCP_IDS = ['yahoo-finance', 'brave-search', 'filesystem', 'github'];

function MCPServersSection() {
  const { config, mcpServerStates, updateMCPServer, startMCPServer, stopMCPServer, addMCPServer, removeMCPServer } = useAIStore();
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerCommand, setNewServerCommand] = useState('npx');
  const [newServerArgs, setNewServerArgs] = useState('-y your-mcp-server');

  const servers = config?.mcpServers || [];
  const serverStates = mcpServerStates || [];

  const handleToggleServer = async (serverId: string, enabled: boolean) => {
    if (enabled) {
      try {
        await startMCPServer(serverId);
      } catch (error) {
        console.error('Failed to start MCP server:', error);
      }
    } else {
      try {
        await stopMCPServer(serverId);
      } catch (error) {
        console.error('Failed to stop MCP server:', error);
      }
    }
    updateMCPServer(serverId, { enabled });
  };

  const handleAddServer = () => {
    if (!newServerName.trim()) return;
    
    const id = `custom-${Date.now()}`;
    addMCPServer({
      id,
      name: newServerName,
      command: newServerCommand,
      args: newServerArgs.split(' ').filter(Boolean),
      env: {},
      enabled: false,
    });
    
    setNewServerName('');
    setNewServerCommand('npx');
    setNewServerArgs('-y your-mcp-server');
    setShowAddServer(false);
  };

  const handleUpdateEnvVar = (serverId: string, key: string, value: string) => {
    const server = servers.find(s => s.id === serverId);
    if (server) {
      updateMCPServer(serverId, { env: { ...server.env, [key]: value } });
    }
  };

  const getServerState = (serverId: string) => {
    return serverStates.find(s => s.id === serverId);
  };

  const isBuiltIn = (serverId: string) => BUILT_IN_MCP_IDS.includes(serverId);

  return (
    <div className={styles.mcpServersSection}>
      <p className={styles.settingHint}>
        MCP servers extend AI capabilities with tools like web search, file access, and APIs.
      </p>

      <div className={styles.mcpServersList}>
        {servers.map((server) => {
          const state = getServerState(server.id);
          const isExpanded = expandedServer === server.id;
          const hasEnvVars = server.env && Object.keys(server.env).length > 0;
          
          return (
            <div key={server.id} className={styles.mcpServerItem}>
              <div 
                className={styles.mcpServerHeader}
                onClick={() => setExpandedServer(isExpanded ? null : server.id)}
              >
                <div className={styles.mcpServerLeft}>
                  <span className={styles.mcpExpandIcon}>
                    {isExpanded ? '▾' : '▸'}
                  </span>
                  <span className={styles.mcpServerName}>{server.name}</span>
                  {state?.status && state.status !== 'stopped' && (
                    <span className={`${styles.mcpStatusBadge} ${styles[state.status]}`}>
                      {state.status}
                    </span>
                  )}
                </div>
                <div className={styles.mcpServerRight} onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`${styles.toggleSwitch} ${styles.small} ${server.enabled ? styles.on : ''}`}
                    onClick={() => handleToggleServer(server.id, !server.enabled)}
                    disabled={state?.status === 'starting'}
                    title={server.enabled ? 'Disable' : 'Enable'}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                </div>
              </div>
              
              {isExpanded && (
                <div className={styles.mcpServerDetails}>
                  <div className={styles.mcpDetailRow}>
                    <label className={styles.mcpDetailLabel}>Name</label>
                    <input
                      type="text"
                      value={server.name}
                      onChange={(e) => updateMCPServer(server.id, { name: e.target.value })}
                      className={styles.mcpInput}
                    />
                  </div>
                  <div className={styles.mcpDetailRow}>
                    <label className={styles.mcpDetailLabel}>Command</label>
                    <input
                      type="text"
                      value={server.command}
                      onChange={(e) => updateMCPServer(server.id, { command: e.target.value })}
                      className={styles.mcpInput}
                      placeholder="npx"
                    />
                  </div>
                  <div className={styles.mcpDetailRow}>
                    <label className={styles.mcpDetailLabel}>Arguments</label>
                    <input
                      type="text"
                      value={server.args.join(' ')}
                      onChange={(e) => updateMCPServer(server.id, { args: e.target.value.split(' ').filter(Boolean) })}
                      className={styles.mcpInput}
                      placeholder="-y package-name"
                    />
                  </div>
                  
                  {hasEnvVars && (
                    <div className={styles.mcpEnvSection}>
                      <label className={styles.mcpDetailLabel}>Environment Variables</label>
                      {Object.entries(server.env).map(([key, value]) => (
                        <div key={key} className={styles.mcpEnvRow}>
                          <span className={styles.mcpEnvKey}>{key}</span>
                          <input
                            type="password"
                            value={value}
                            onChange={(e) => handleUpdateEnvVar(server.id, key, e.target.value)}
                            className={styles.mcpInput}
                            placeholder="Enter value..."
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {state?.tools && state.tools.length > 0 && (
                    <div className={styles.mcpToolsSection}>
                      <label className={styles.mcpDetailLabel}>Available Tools ({state.tools.length})</label>
                      <ul className={styles.mcpToolsList}>
                        {state.tools.slice(0, 5).map((tool) => (
                          <li key={tool.name} title={tool.description}>
                            {tool.name}
                          </li>
                        ))}
                        {state.tools.length > 5 && (
                          <li className={styles.mcpMoreTools}>+{state.tools.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {state?.error && (
                    <div className={styles.mcpServerError}>
                      Error: {state.error}
                    </div>
                  )}

                  {!isBuiltIn(server.id) && (
                    <button
                      className={styles.mcpRemoveBtn}
                      onClick={() => removeMCPServer(server.id)}
                    >
                      Remove Server
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddServer ? (
        <div className={styles.mcpAddServerForm}>
          <div className={styles.mcpDetailRow}>
            <label className={styles.mcpDetailLabel}>Name</label>
            <input
              type="text"
              placeholder="My MCP Server"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              className={styles.mcpInput}
            />
          </div>
          <div className={styles.mcpDetailRow}>
            <label className={styles.mcpDetailLabel}>Command</label>
            <input
              type="text"
              placeholder="npx"
              value={newServerCommand}
              onChange={(e) => setNewServerCommand(e.target.value)}
              className={styles.mcpInput}
            />
          </div>
          <div className={styles.mcpDetailRow}>
            <label className={styles.mcpDetailLabel}>Arguments</label>
            <input
              type="text"
              placeholder="-y your-mcp-package"
              value={newServerArgs}
              onChange={(e) => setNewServerArgs(e.target.value)}
              className={styles.mcpInput}
            />
          </div>
          <div className={styles.mcpAddServerButtons}>
            <button onClick={handleAddServer} className={styles.mcpAddBtn}>
              Add Server
            </button>
            <button onClick={() => setShowAddServer(false)} className={styles.mcpCancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className={styles.mcpAddServerBtn}
          onClick={() => setShowAddServer(true)}
        >
          + Add Custom MCP Server
        </button>
      )}
    </div>
  );
}
