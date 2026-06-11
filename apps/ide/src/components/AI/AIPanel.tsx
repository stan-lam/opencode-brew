import { useState, useRef, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { ai, appEvents, dialog, fs, history, shell, listenForTokenUsage, usage } from '../../services/tauri';
import { useAIStore, AIMessage, MessageAttachment, AgentMode, AgentTask, WebAccessTrace } from '../../store/aiStore';
import { ContextBreakdownModal } from './ContextBreakdownModal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useEditorStore } from '../../store/editorStore';
import styles from './AIPanel.module.css';
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
    // Always render all lines - let CSS max-height and scroll handle visibility
    
    return codeLines.map((line, lineIdx) => {
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
      if (['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'rust', 'go', 'swift'].includes(lang.toLowerCase())) {
        patterns.push({ regex: /(\/\/.*$)/, className: styles.syntaxComment });
        patterns.push({ regex: /(\/\*[\s\S]*?\*\/)/, className: styles.syntaxComment });
      }
      if (['python', 'py', 'ruby', 'bash', 'sh', 'shell', 'yaml', 'yml'].includes(lang.toLowerCase())) {
        patterns.push({ regex: /(#.*$)/, className: styles.syntaxComment });
      }
      if (['html', 'xml', 'svg'].includes(lang.toLowerCase())) {
        patterns.push({ regex: /(<!--[\s\S]*?-->)/, className: styles.syntaxComment });
      }
      
      patterns.push({ regex: /("(?:[^"\\]|\\.)*")/, className: styles.syntaxString });
      patterns.push({ regex: /('(?:[^'\\]|\\.)*')/, className: styles.syntaxString });
      patterns.push({ regex: /(`(?:[^`\\]|\\.)*`)/, className: styles.syntaxString });
      
      const keywords = /\b(const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|async|await|try|catch|throw|new|this|super|extends|implements|public|private|protected|static|readonly|def|fn|pub|mod|use|struct|enum|impl|trait|match|loop|break|continue|true|false|null|undefined|None|True|False|self|nil)\b/g;
      patterns.push({ regex: keywords, className: styles.syntaxKeyword });
      patterns.push({ regex: /\b(\d+\.?\d*)\b/, className: styles.syntaxNumber });
      patterns.push({ regex: /\b([a-zA-Z_]\w*)\s*(?=\()/, className: styles.syntaxFunction });

      const replacements: { start: number; end: number; element: React.ReactNode }[] = [];

      if (lang) {
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
      }

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
          <span className={styles.lineNumber}>{lineNumber}</span>
          {isDiff && <span className={styles.diffMarker}>{isDiffAdd ? '+' : isDiffRemove ? '-' : ' '}</span>}
          <span className={styles.lineContent}>{highlightedContent}</span>
        </div>
      );
    });
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
}

interface PendingFileOperation {
  operation: FileOperation;
  messageId: string;
  applied: boolean;
  previousContent?: string;
  previousExists?: boolean;
  wasSkipped?: boolean;
}

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
function parseFileOperations(content: string): FileOperation[] {
  const operations: FileOperation[] = [];
  
  // Parse create_file tags — complete (with closing tag) first
  const createRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let match;
  const completePaths = new Set<string>();
  while ((match = createRegex.exec(content)) !== null) {
    completePaths.add(match[1]);
    operations.push({
      type: 'create',
      path: match[1],
      content: match[2].trim(),
    });
  }

  // Also parse INCOMPLETE create_file tags (streaming — no closing tag yet)
  // Capture from the open tag up to the next open tag, closing tag, or end of string
  const incompleteCreateRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)(?=<create_file|<edit_file|<delete_file|<\/create_file|$)/g;
  let m2;
  while ((m2 = incompleteCreateRegex.exec(content)) !== null) {
    if (completePaths.has(m2[1])) continue; // already captured as complete
    const code = m2[2].trim();
    if (code.length > 0) {
      operations.push({ type: 'create', path: m2[1], content: code });
    }
  }
  
  // Parse edit_file tags - first find all edit_file blocks, then extract old/new content
  const editBlockRegex = /<edit_file\s+path="([^"]+)"(?:\s+mode="(replace|insert)")?(?:\s+line="(\d+)")?>([\s\S]*?)<\/edit_file>/g;
  while ((match = editBlockRegex.exec(content)) !== null) {
    const path = match[1];
    const mode = (match[2] as 'replace' | 'insert') || 'replace';
    const line = match[3] ? parseInt(match[3]) : undefined;
    const body = match[4];
    
    // Extract old_content and new_content from the body
    const oldMatch = body.match(/<old_content>([\s\S]*?)<\/old_content>/);
    const newMatch = body.match(/<new_content>([\s\S]*?)<\/new_content>/);
    
    let oldContent = oldMatch ? oldMatch[1].trim() : undefined;
    let newContent = newMatch ? newMatch[1].trim() : undefined;
    
    // If no old/new tags found, treat entire body as new content (simple edit)
    if (!oldContent && !newContent) {
      newContent = body.trim();
    }
    
    operations.push({
      type: 'edit',
      path,
      mode,
      line,
      oldContent,
      newContent,
    });
  }
  
  // Parse delete_file tags
  const deleteRegex = /<delete_file\s+path="([^"]+)"\s*\/>/g;
  while ((match = deleteRegex.exec(content)) !== null) {
    operations.push({
      type: 'delete',
      path: match[1],
    });
  }
  
  return operations;
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
  const checklistRegex = /<checklist([^>]*)>([\s\S]*?)<\/checklist>/g;
  while ((match = checklistRegex.exec(content)) !== null) {
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
      // Generate filename from plan title
      const filename = plan.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      const filePath = `${currentWorkspace.rootPath}/.plan-${filename}.md`;
      
      // Build markdown content
      let content = `# ${plan.title}\n\n`;
      content += `> Plan created: ${new Date().toLocaleString()}\n\n`;
      
      if (plan.overview) {
        content += `## Overview\n\n${plan.overview}\n\n`;
      }
      
      if (plan.approaches.length > 0) {
        content += `## Approaches\n\n`;
        plan.approaches.forEach((approach) => {
          content += `### ${approach.name}${approach.recommended ? ' ⭐ (Recommended)' : ''}\n\n`;
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
      
      // Add tasks section with current state
      content += `## Tasks\n\n`;
      tasks.forEach(task => {
        // Map status to checkbox marker
        let marker = ' ';
        if (task.status === 'completed') marker = 'x';
        else if (task.status === 'in-progress') marker = '>';
        else if (task.status === 'skipped') marker = '-';
        
        content += `- [${marker}] ${task.text}\n`;
      });
      content += '\n';
      
      if (plan.architecture) {
        content += `## Architecture\n\n\`\`\`mermaid\n${plan.architecture}\n\`\`\`\n\n`;
      }
      
      if (plan.considerations && plan.considerations.length > 0) {
        content += `## Considerations\n\n`;
        plan.considerations.forEach(consideration => content += `- ${consideration}\n`);
        content += '\n';
      }
      
      content += `---\n\n*This plan is managed by OpenCodeBrew. Edit tasks above and save to update.*\n`;
      
      await fs.writeFile(filePath, content);
      
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Plan saved to ${filename}.md`, type: 'success' }
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
          <h3 className={styles.planTitle}>{plan.title}</h3>
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

  const toggleItem = (idx: number) => {
    setChecked(prev => prev.map((v, i) => (i === idx ? !v : v)));
  };

  return (
    <div className={styles.checklistContainer}>
      <div className={styles.checklistHeader}>
        <div className={styles.checklistHeaderLeft}>
          <ListChecks size={15} className={styles.checklistIcon} />
          <h4 className={styles.checklistTitle}>{checklist.title}</h4>
        </div>
        <span className={styles.checklistProgress}>
          {completedCount}/{totalCount}
        </span>
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
            onClick={() => toggleItem(idx)}
          >
            <input
              type="checkbox"
              checked={checked[idx]}
              onChange={() => {}}
              className={styles.checklistCheckbox}
            />
            <span className={styles.checklistItemText}>{item}</span>
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

function MessageBubble({ message, onOperationsChange }: { 
  message: AIMessage;
  onOperationsChange?: (ops: FileOperation[]) => void;
}) {
  const isUser = message.role === 'user';
  const [pendingOps, setPendingOps] = useState<FileOperation[]>([]);
  const [planComponents, setPlanComponents] = useState<{ plans: Plan[]; checklists: Checklist[]; decisions: Decision[] }>({ plans: [], checklists: [], decisions: [] });
  const [actionableTasks, setActionableTasks] = useState<string[]>([]);
  const [codeBlockTasks, setCodeBlockTasks] = useState<string[]>([]);
  const [hasImplementationOffer, setHasImplementationOffer] = useState(false);
  const { currentWorkspace} = useWorkspaceStore();
  const { openFile } = useEditorStore();
  const { agentMode, setAgentMode, sendMessage, setAgentTasks, queuePrompt } = useAIStore();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
  };

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

  // Parse file operations and plan components from assistant messages
  useEffect(() => {
    if (!isUser && message.content) {
      // Only parse file operations if NOT in plan mode
      if (agentMode !== 'plan') {
        const ops = parseFileOperations(message.content);
        setPendingOps(ops);
        // Notify parent of operations
        if (onOperationsChange) {
          onOperationsChange(ops);
        }
      } else {
        setPendingOps([]); // Clear any file operations in plan mode
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
      
      // Detect actionable tasks and code blocks in Plan Mode
      if (agentMode === 'plan') {
        const tasks = detectActionableTasks(message.content);
        setActionableTasks(tasks);

        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        const detectedCodeBlocks: string[] = [];
        let match;
        while ((match = codeBlockRegex.exec(message.content)) !== null) {
          const lang = match[1] || 'code';
          const codeContent = match[2].trim();
          if (lang.toLowerCase() === 'mermaid') continue;
          const preview = codeContent.split('\n').slice(0, 3).join('; ').substring(0, 80);
          detectedCodeBlocks.push(`Implement ${lang || 'code'}: ${preview}${codeContent.length > 80 ? '...' : ''}`);
        }
        setCodeBlockTasks(detectedCodeBlocks);
        setHasImplementationOffer(false);
      } else if (agentMode === 'chat') {
        // Detect when AI offers to implement in Chat mode
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
        const hasOffer = implementationOfferPatterns.some(p => p.test(message.content));
        setHasImplementationOffer(hasOffer);
        setActionableTasks([]);
        setCodeBlockTasks([]);
      } else {
        setActionableTasks([]);
        setCodeBlockTasks([]);
        setHasImplementationOffer(false);
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
    
    // In plan mode, remove code blocks (detection happens in useEffect, not here)
    if (agentMode === 'plan') {
      // Remove all code blocks except mermaid — replace with a subtle indicator
      cleaned = cleaned.replace(/```(?!mermaid)(\w*)[^\n]*\n[\s\S]*?```/g, () => {
        return `\n\n> 📋 *Code hidden in Plan Mode — switch to Agent Mode to see implementation*\n\n`;
      });
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
        {isUser ? message.content : <MarkdownRenderer content={getCleanedContent(message.content)} />}
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
              onImplementInAgent={agentMode === 'plan' ? handleImplementInAgent : undefined}
            />
          ))}
          {planComponents.decisions.map((decision, idx) => (
            <DecisionView key={idx} decision={decision} />
          ))}
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

function MarkdownRenderer({ content }: { content: string }) {
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
          if (isTableContent && (lang === '' || lang === 'text' || lang === 'plaintext' || lang === 'code')) {
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
          
          if (isChecklistContent && (lang === '' || lang === 'text' || lang === 'plaintext' || lang === 'code')) {
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
          const isMarkdownContent = (() => {
            if (codeLines.length === 0) return false;
            
            const hasHeaders = codeLines.some(l => /^#{1,6}\s+\S/.test(l.trim()));
            const hasBold = codeLines.some(l => /\*\*[^*]+\*\*/.test(l) || /\*\*\w/.test(l));
            const hasLists = codeLines.some(l => /^[\s]*[-*+]\s\S/.test(l) || /^[\s]*\d+\.\s\S/.test(l));
            const hasBlockquotes = codeLines.some(l => /^>\s/.test(l.trim()));
            const hasTables = codeLines.some(l => (l.match(/\|/g) || []).length >= 2 && l.trim().startsWith('|'));
            
            // For text/plaintext blocks, prefer markdown rendering if markdown patterns found
            const isTextLang = lang === '' || lang === 'text' || lang === 'plaintext' || lang === 'markdown' || lang === 'md' || lang === 'code';
            if (isTextLang && (hasHeaders || hasBold || hasTables)) {
              return true;
            }
            
            // For other languages, be stricter - check for code patterns
            const codeLineCount = codeLines.filter(l => 
              /^(const|let|var|function|class|import|export|if|else|for|while|return|async|await)\s/.test(l.trim()) ||
              /[{};]\s*$/.test(l.trim()) ||
              /=>\s*[{(]/.test(l) ||
              /\(\s*\)\s*=>/.test(l)
            ).length;
            
            // If more than 30% of lines look like code, don't treat as markdown
            if (codeLineCount > codeLines.length * 0.3) return false;
            
            return hasHeaders || hasBold || hasTables || hasLists || hasBlockquotes;
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

      // Detect loose code (code without fences) - check if line looks like code
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

        const hasCodePunctuation = /[{};=<>()[\]]/.test(trimmed);
        if (wordCount >= 5 && !hasCodePunctuation) return false;

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

      if (looksLikeCodeLine(line)) {
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
          elements.push(
            <div key={key++} className={styles.codeBlock}>
              <div className={styles.codeBlockHeader}>
                <span className={styles.codeBlockLang}>code</span>
                <button 
                  className={styles.copyButton}
                  onClick={() => navigator.clipboard.writeText(codeContent)}
                >
                  Copy
                </button>
              </div>
              <div className={styles.codeBlockContent}>
                <pre><code>{codeContent}</code></pre>
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

    // Inline code `text` — processed first so backticks shield bold/italic inside
    const codeRegex = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = codeRegex.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        element: <code key={key++} className={styles.inlineCode}>{m[1]}</code>,
      });
    }

    // Bold **text** — use .+? (lazy) so * inside content doesn't break the match
    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((m = boldRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <strong key={key++}>{m[1]}</strong>,
        });
      }
    }

    // Italic *text* — exclude ** by checking neighbors manually (avoids lookbehind compatibility issues)
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
        matches.push({
          start,
          end,
          element: <em key={key++}>{m[1]}</em>,
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

    // Links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>,
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
  const [isCodeExpanded, setIsCodeExpanded] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  const { openDiff } = useEditorStore();

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (codeRef.current && !isCodeExpanded) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [operation.content, operation.newContent, operation.oldContent, isCodeExpanded]);

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

    const normalizedOpPath = operation.path.replace(/^\/+/, '');
    const fullPath = operation.path.startsWith('/')
      ? operation.path
      : `${currentWorkspace.rootPath}/${normalizedOpPath}`;
    const normalizedFullPath = fullPath.replace(/\/+/g, '/');
    const relativePath = normalizedFullPath.startsWith(`${currentWorkspace.rootPath}/`)
      ? normalizedFullPath.slice(currentWorkspace.rootPath.length + 1)
      : normalizedOpPath;

    openDiff(currentWorkspace.rootPath, relativePath, false);
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
    
    const lines = content.split('\n').length;
    const needsExpand = lines > 20; // Show expand button if more than 20 lines
    
    return (
      <div className={styles.codeBlockWrapper}>
        <pre 
          ref={codeRef}
          className={`${className} ${!isCodeExpanded && needsExpand ? styles.codeCollapsed : styles.codeExpanded}`}
        >
          {content}
        </pre>
        {needsExpand && (
          <button 
            className={styles.codeExpandButton}
            onClick={(e) => {
              e.stopPropagation();
              setIsCodeExpanded(!isCodeExpanded);
            }}
          >
            {isCodeExpanded ? 'Show Less' : `Show All (${lines} lines)`}
          </button>
        )}
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
              <button className={styles.fileOpApprove} onClick={onApprove}>
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
  path: string;
  operations: { op: PendingFileOperation; originalIndex: number }[];
  totalAdded: number;
  totalRemoved: number;
  allApplied: boolean;
  anyApplied: boolean;
}

function groupOperationsByFile(operations: PendingFileOperation[]): GroupedFileOperation[] {
  const groupMap = new Map<string, GroupedFileOperation>();
  
  operations.forEach((op, index) => {
    const path = op.operation.path;
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
  expanded,
  onToggleExpanded,
  onKeepAll, 
  onUndoAll, 
  onReview,
  onAcceptFile,
  onUndoFile
}: { 
  operations: PendingFileOperation[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onKeepAll: () => void;
  onUndoAll: () => void;
  onReview: () => void;
  onAcceptFile: (index: number) => void;
  onUndoFile: (index: number) => void;
}) {
  if (operations.length === 0) return null;

  // Group operations by file path
  const groupedOps = groupOperationsByFile(operations);
  const fileCount = groupedOps.length;
  const appliedFileCount = groupedOps.filter(g => g.allApplied).length;
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

  // Show batch actions only if there are pending operations
  const showBatchActions = pendingCount > 0;

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
              onClick={(e) => { e.stopPropagation(); onUndoAll(); }}
              title="Undo All"
            >
              Undo All
            </button>
          </div>
        ) : showBatchActions && (
          <div className={styles.fileOpsBarActions}>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onUndoAll(); }}
              title="Undo All"
            >
              Undo All
            </button>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onKeepAll(); }}
              title="Keep All"
            >
              Keep All
            </button>
            <button 
              className={`${styles.fileOpsBarBtn} ${styles.fileOpsBarBtnPrimary}`}
              onClick={(e) => { e.stopPropagation(); onReview(); }}
              title="Review Changes"
            >
              Review
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
            >
              <span className={`${styles.fileOpsItemIcon} ${getFileIconClass(group.operations[0].op.operation.type)}`}>
                {getFileIcon(group.operations[0].op.operation.type)}
              </span>
              <span className={styles.fileOpsItemName}>
                {getFileName(group.path)}
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
                      onClick={() => {
                        // Accept all operations for this file
                        group.operations.forEach(({ originalIndex }) => {
                          if (!operations[originalIndex].applied) {
                            onAcceptFile(originalIndex);
                          }
                        });
                      }}
                      title="Accept"
                    >
                      ✓
                    </button>
                    <button
                      className={styles.fileOpsItemBtnReject}
                      onClick={() => {
                        // Reject all operations for this file
                        group.operations.forEach(({ originalIndex }) => {
                          if (!operations[originalIndex].applied) {
                            onUndoFile(originalIndex);
                          }
                        });
                      }}
                      title="Reject"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.fileOpsItemBtnUndo}
                    onClick={() => {
                      // Undo all operations for this file
                      group.operations.forEach(({ originalIndex }) => {
                        if (operations[originalIndex].applied) {
                          onUndoFile(originalIndex);
                        }
                      });
                    }}
                    title="Undo"
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
    promptQueue,
    agentMode,
    agentTasks,
    webAccessStatus,
    webAccessTraces,
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
    clearAgentTasks,
    updateSessionUsage,
    resetSessionUsage,
    summarizeConversation,
    isSummarizing,
  } = useAIStore();

  const { currentWorkspace } = useWorkspaceStore();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showContextBreakdown, setShowContextBreakdown] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [allPendingOps, setAllPendingOps] = useState<PendingFileOperation[]>([]);
  const [fileOpsExpanded, setFileOpsExpanded] = useState(true);
  const [showProcessingIndicator, setShowProcessingIndicator] = useState(false);
  const [pendingResponse, setPendingResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const forceScrollRef = useRef(false);
  const { deleteConversation, importConversationsFromPath } = useAIStore();
  const prevIsStreamingRef = useRef(false);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSummaryMessageIdRef = useRef<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const autoApplyInFlightRef = useRef(false);
  const lastAutoApplyKeyRef = useRef<string | null>(null);
  const hasQueuedPrompts = promptQueue.length > 0;
  const processingLabel = thinkingStatus?.trim()
    || (pendingResponse ? 'Waiting for model...' : (isStreaming ? 'Generating response...' : (hasQueuedPrompts ? `Queued prompt${promptQueue.length > 1 ? 's' : ''} pending...` : '')));
  const showProcessingStatus = Boolean(processingLabel);
  const showQueueIcon = showProcessingStatus && !isStreaming && !thinkingStatus && !pendingResponse && hasQueuedPrompts;

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

    if (thinkingStatus) {
      setShowProcessingIndicator(true);
    } else if (isStreaming) {
      processingTimerRef.current = setTimeout(() => {
        setShowProcessingIndicator(true);
      }, 1200);
    } else if (pendingResponse) {
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
  }, [isStreaming, thinkingStatus, pendingResponse]);

  useEffect(() => {
    if (isStreaming || thinkingStatus) {
      setPendingResponse(false);
    }
  }, [isStreaming, thinkingStatus]);

  useEffect(() => {
    if (isStreaming || autoApplyInFlightRef.current) return;
    if (allPendingOps.length === 0) return;

    const pending = allPendingOps.filter((op) => !op.applied);
    if (pending.length === 0) return;

    const applyKey = pending.map((op) => `${op.messageId}:${op.operation.type}:${op.operation.path}`).join('|');
    if (lastAutoApplyKeyRef.current === applyKey) return;

    lastAutoApplyKeyRef.current = applyKey;
    autoApplyInFlightRef.current = true;

    setTimeout(() => {
      void handleKeepAllOperations().finally(() => {
        autoApplyInFlightRef.current = false;
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

    const verifyOperationsStatus = async () => {
      let hasChanges = false;
      const updatedOps = [...allPendingOps];

      for (let i = 0; i < updatedOps.length; i++) {
        const item = updatedOps[i];
        
        // Skip if already marked as applied
        if (item.applied) continue;

        // Check if file operation has actually been applied
        if (item.operation.type === 'create') {
          const fullPath = `${currentWorkspace.rootPath}/${item.operation.path}`;
          try {
            const exists = await fs.pathExists(fullPath);
            if (exists) {
              console.log(`Marking operation as applied (file exists): ${item.operation.path}`);
              updatedOps[i] = { ...item, applied: true, previousExists: true, wasSkipped: true };
              hasChanges = true;
            }
          } catch (err) {
            console.error('Error checking file existence:', err);
          }
        }
      }

      // Update state if any operations were marked as applied
      if (hasChanges) {
        setAllPendingOps(updatedOps);
      }
    };

    // Run verification after a short delay to ensure operations are loaded
    const timeoutId = setTimeout(() => {
      verifyOperationsStatus();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [currentWorkspace?.rootPath, activeConversation?.id]); // Only depend on workspace and conversation ID

  // Check if user is near bottom - called directly before scrolling
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    // User is "near bottom" if within 150px of the bottom
    return scrollHeight - scrollTop - clientHeight < 150;
  }, []);

  // Auto-scroll only if user is near the bottom (checked at scroll time)
  useEffect(() => {
    // Only auto-scroll if forced (new message sent) or user is near bottom
    if (forceScrollRef.current || isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      forceScrollRef.current = false;
    }
  }, [activeConversation?.messages, isNearBottom]);

  // Force scroll when user sends a new message
  const resetScrollLock = useCallback(() => {
    forceScrollRef.current = true;
  }, []);

  // Dummy handler to keep the ref working (scroll position is checked directly)
  const handleScroll = useCallback(() => {}, []);

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

  useEffect(() => {
    if (config.provider === 'ollama' || config.provider === 'copilot') {
      refreshAvailableModels();
    }
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
    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      console.log('[AIPanel] Setting up Tauri native file drop listeners');
      unlistenDrop = await appEvents.onFileDrop(async (paths) => {
        console.log('[AIPanel] Tauri file-drop event received, paths:', paths);
        setIsDragging(false);
        await handleFilePathUpload(paths);
      });
      unlistenHover = await appEvents.onFileDropHover((paths) => {
        console.log('[AIPanel] Tauri file-drop-hover event, paths:', paths);
        setIsDragging(true);
      });
      unlistenCancel = await appEvents.onFileDropCancel(() => {
        console.log('[AIPanel] Tauri file-drop-cancelled event');
        setIsDragging(false);
      });
      console.log('[AIPanel] Tauri native file drop listeners set up');
    };

    setup();

    return () => {
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
    const normalizedOpPath = opPath.replace(/^\/+/, '');
    const fullPath = `${workspaceRoot}/${normalizedOpPath}`.replace(/\/+/g, '/');
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

    if (newTrimmed) {
      if (currentContent.includes(newTrimmed)) {
        return { updatedContent: currentContent, changed: false };
      }
      const updatedContent = `${currentContent}\n${newTrimmed}`;
      return { updatedContent, changed: true };
    }

    return { updatedContent: currentContent, changed: false };
  };

  const handleKeepAllOperations = async () => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { openFile } = useEditorStore.getState();
    
    if (!currentWorkspace) {
      console.error('No workspace open');
      return;
    }

    let successCount = 0;
    let skippedCount = 0;
    const updatedOps = [...allPendingOps];

    // Apply all unapplied operations
    for (let i = 0; i < updatedOps.length; i++) {
      const item = updatedOps[i];
      if (item.applied) {
        skippedCount++;
        continue;
      }

      try {
        // Normalize paths: remove leading slashes from operation path, normalize double slashes
        const { normalizedOpPath, fullPath } = normalizeOperationPath(item.operation.path, currentWorkspace.rootPath);
        console.log(`[FileOps] Workspace root: ${currentWorkspace.rootPath}`);
        console.log(`[FileOps] Operation path (raw): ${item.operation.path}`);
        console.log(`[FileOps] Operation path (normalized): ${normalizedOpPath}`);
        console.log(`[FileOps] Full path: ${fullPath}`);
        
        if (item.operation.type === 'create') {
          // Check if file already exists
          const fileExists = await fs.pathExists(fullPath);
          if (fileExists) {
            console.log(`[FileOps] File already exists, skipping: ${item.operation.path}`);
            // Mark as applied even though we skipped it
            updatedOps[i] = { ...updatedOps[i], applied: true, wasSkipped: true, previousExists: true };
            skippedCount++;
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
          await openFile(fullPath);
          updatedOps[i] = {
            ...updatedOps[i],
            applied: true,
            previousExists: false,
            previousContent: undefined,
            wasSkipped: false,
          };
        } else if (item.operation.type === 'edit') {
          const previousContent = await fs.readFile(fullPath);
          const { updatedContent, changed } = applyEditOperation(previousContent, item.operation);

          if (!changed) {
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

          await fs.writeFile(fullPath, updatedContent);
          // Save to local history
          await history.save(item.operation.path, updatedContent).catch(console.error);
          await openFile(fullPath);
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

    if (successCount > 0) {
      console.log(`[FileOps] SUCCESS: Applied ${successCount} file(s) to: ${currentWorkspace.rootPath}`);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Applied ${successCount} file(s) to ${currentWorkspace.rootPath}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`, type: 'success' }
      }));
    } else if (skippedCount > 0) {
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: 'All operations already applied', type: 'info' }
      }));
    }
  };

  // Auto-apply file operations when streaming ends
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      const pending = allPendingOps.filter(op => !op.applied);
      if (pending.length === 0) return;
      // Small delay to let parseFileOperations finish updating allPendingOps state
      setTimeout(() => { handleKeepAllOperations(); }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const revertOperation = async (item: PendingFileOperation) => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { openFile } = useEditorStore.getState();
    if (!currentWorkspace) return false;

    if (item.wasSkipped) return false;

    const { normalizedOpPath, fullPath } = normalizeOperationPath(
      item.operation.path,
      currentWorkspace.rootPath
    );

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
  };

  const handleUndoAllOperations = () => {
    void (async () => {
      const { unmarkFileOperationsAsKept } = useAIStore.getState();
      let undoneCount = 0;

      for (const item of allPendingOps) {
        if (item.applied) {
          try {
            const undone = await revertOperation(item);
            if (undone) undoneCount++;
          } catch (error) {
            console.error('Failed to undo file operation:', error);
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
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: undoneCount > 0 ? `Undid ${undoneCount} file(s)` : 'Removed all file operations', type: 'info' }
      }));
    })();
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

    try {
      // Normalize paths: remove leading slashes from operation path, normalize double slashes
      const { normalizedOpPath, fullPath } = normalizeOperationPath(item.operation.path, currentWorkspace.rootPath);
      console.log(`[FileOps] Single accept - full path: ${fullPath}`);
      
      if (item.operation.type === 'create') {
        // Check if file already exists
        const fileExists = await fs.pathExists(fullPath);
        if (fileExists) {
          console.log(`[FileOps] File already exists, skipping: ${normalizedOpPath}`);
          // Mark as applied even though we skipped it
          setAllPendingOps(prev => prev.map((op, idx) => 
            idx === index ? { ...op, applied: true, wasSkipped: true, previousExists: true } : op
          ));
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `File already exists: ${normalizedOpPath}`, type: 'info' }
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
          idx === index ? { ...op, applied: true, previousExists: false, previousContent: undefined, wasSkipped: false } : op
        ));
      } else if (item.operation.type === 'edit') {
        const previousContent = await fs.readFile(fullPath);
        const { updatedContent, changed } = applyEditOperation(previousContent, item.operation);

        if (!changed) {
          setAllPendingOps(prev => prev.map((op, idx) => 
            idx === index ? { ...op, applied: true, previousExists: true, previousContent, wasSkipped: true } : op
          ));
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `No changes applied: ${item.operation.path}`, type: 'info' }
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
  };

  const handleUndoFileOperation = (index: number) => {
    void (async () => {
      const item = allPendingOps[index];
      if (!item) return;

      const { unmarkFileOperationsAsKept } = useAIStore.getState();
      let undone = false;

      if (item.applied) {
        try {
          undone = await revertOperation(item);
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

  const handleReviewOperations = () => {
    // Scroll to first file operation in messages
    const firstOpMessage = document.querySelector(`.${styles.fileOperations}`);
    if (firstOpMessage) {
      firstOpMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
      queuePrompt(message);
    } else {
      await sendMessage(message, messageAttachments);
    }
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
            onClick={createConversation}
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
                    <MarkdownRenderer content={activeConversation.summary} />
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
                      ? 'The AI can create, edit, and delete files in your workspace. Changes apply automatically, and you can undo them in File Operations.'
                      : agentMode === 'edit'
                      ? 'The AI will help you edit existing files with precise changes. Edits apply automatically, and you can undo them in File Operations.'
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
            {activeConversation.messages.map((message) => (
              <MessageBubble 
                key={message.id} 
                message={message} 
                onOperationsChange={async (ops) => {
                  const { isFileOperationKept } = useAIStore.getState();
                  
                  // Check if operations are kept or if files already exist
                  const opsWithStatus: PendingFileOperation[] = await Promise.all(
                    ops.map(async (op) => {
                      const operationId = `${message.id}:${op.type}:${op.path}`;
                      
                      // First check if operation is marked as kept in history
                      if (isFileOperationKept(operationId)) {
                        console.log(`Operation marked as kept in history: ${op.path}`);
                        return { operation: op, messageId: message.id, applied: true };
                      }
                      
                      // Otherwise check if file exists
                      let alreadyApplied = false;
                      if (op.type === 'create' && currentWorkspace) {
                        const fullPath = `${currentWorkspace.rootPath}/${op.path}`;
                        try {
                          alreadyApplied = await fs.pathExists(fullPath);
                        } catch (err) {
                          console.error('Error checking file existence:', err);
                        }
                      }
                      
                      return { operation: op, messageId: message.id, applied: alreadyApplied };
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
            ))}
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

      {promptQueue.length > 0 && (
        <div className={styles.queueIndicator}>
          <div className={styles.queueInfo}>
            <span className={styles.queueCount}>{promptQueue.length} prompt{promptQueue.length > 1 ? 's' : ''} queued</span>
            <span className={styles.queuePreview}>{promptQueue[0].slice(0, 50)}{promptQueue[0].length > 50 ? '...' : ''}</span>
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

      <FileOperationsBar
        operations={allPendingOps}
        expanded={fileOpsExpanded}
        onToggleExpanded={() => setFileOpsExpanded(!fileOpsExpanded)}
        onKeepAll={handleKeepAllOperations}
        onUndoAll={handleUndoAllOperations}
        onReview={handleReviewOperations}
        onAcceptFile={handleAcceptFileOperation}
        onUndoFile={handleUndoFileOperation}
      />

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
                    <div className={styles.attachmentPreview}>
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
              >
                <optgroup label={config.provider}>
                  {useAIStore.getState().availableModels[config.provider].map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className={styles.controlsRight}>
              <button
                type="button"
                className={styles.controlBtn}
                onClick={createConversation}
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
                  onClick={handleImportFromProject}
                  title="Import from another project"
                >
                  <FolderOpen size={14} />
                  <span>Import</span>
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

type CopilotDeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

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
  const { config, setConfig, availableModels, refreshAvailableModels } = useAIStore();
  const [copilotLoggedIn, setCopilotLoggedIn] = useState<boolean | null>(null);
  const [copilotDevice, setCopilotDevice] = useState<CopilotDeviceCode | null>(null);
  const [copilotPolling, setCopilotPolling] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotUsage, setCopilotUsage] = useState<CopilotUsageInfo | null>(null);
  const [copilotUsageError, setCopilotUsageError] = useState<string | null>(null);
  const [copilotUsageLoading, setCopilotUsageLoading] = useState(false);
  const [copilotOrgs, setCopilotOrgs] = useState<string[]>([]);
  const [copilotOrgsError, setCopilotOrgsError] = useState<string | null>(null);
  const [copilotOrgsLoading, setCopilotOrgsLoading] = useState(false);

  useEffect(() => {
    let isActive = true;
    if (config.provider !== 'copilot') {
      setCopilotDevice(null);
      setCopilotPolling(false);
      setCopilotError(null);
      setCopilotLoggedIn(null);
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
    setCopilotDevice(null);
    setCopilotPolling(false);

    try {
      const device = await ai.copilotDeviceLoginStart(config.copilotClientId || undefined);
      setCopilotDevice(device);

      const verificationUrl = device.verification_uri_complete || device.verification_uri;
      if (verificationUrl) {
        await shell.openExternal(verificationUrl);
      }

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(device.user_code);
        } catch {
          // Ignore clipboard failures
        }
      }

      setCopilotPolling(true);
      await ai.copilotDeviceLoginPoll(
        device.device_code,
        device.interval,
        device.expires_in,
        config.copilotClientId || undefined
      );
      setCopilotLoggedIn(true);
      setCopilotDevice(null);
      refreshAvailableModels();
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

  const handleCopilotLogout = async () => {
    setCopilotError(null);
    try {
      await ai.copilotDeviceLogout();
      setCopilotLoggedIn(false);
      setCopilotDevice(null);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Failed to disconnect Copilot';
      setCopilotError(errorMessage);
    }
  };

  const handleCopilotCopyCode = async () => {
    if (!copilotDevice?.user_code || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(copilotDevice.user_code);
    } catch {
      // Ignore clipboard failures
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
              <div className={styles.copilotStatusRow}>
                <span
                  className={`${styles.copilotStatus} ${
                    copilotLoggedIn ? styles.copilotConnected : styles.copilotDisconnected
                  }`}
                >
                  {copilotLoggedIn ? 'Connected' : 'Not connected'}
                </span>
                {copilotLoggedIn ? (
                  <button
                    className={styles.copilotButton}
                    onClick={handleCopilotLogout}
                    type="button"
                  >
                    Sign out
                  </button>
                ) : (
                  <button
                    className={styles.copilotButton}
                    onClick={handleCopilotLogin}
                    type="button"
                  >
                    Sign in
                  </button>
                )}
              </div>
              {copilotDevice && (
                <div className={styles.copilotDeviceBox}>
                  <div className={styles.copilotDeviceRow}>
                    <span className={styles.copilotDeviceCode}>{copilotDevice.user_code}</span>
                    <button
                      className={styles.copilotButton}
                      onClick={handleCopilotCopyCode}
                      type="button"
                    >
                      Copy code
                    </button>
                    <button
                      className={styles.copilotButton}
                      onClick={() => shell.openExternal(copilotDevice.verification_uri_complete || copilotDevice.verification_uri)}
                      type="button"
                    >
                      Open GitHub
                    </button>
                  </div>
                  <p className={styles.settingHint}>
                    Enter the code at GitHub to finish connecting.
                    {copilotPolling ? ' Waiting for authorization...' : ''}
                  </p>
                </div>
              )}
              {!copilotDevice && copilotPolling && (
                <p className={styles.settingHint}>Waiting for authorization...</p>
              )}
              {copilotError && <p className={styles.copilotError}>{copilotError}</p>}
            </div>
            <div className={styles.settingGroup}>
              <label>OAuth Client ID (optional)</label>
              <input
                type="text"
                value={config.copilotClientId || ''}
                onChange={(e) => setConfig({ copilotClientId: e.target.value })}
                placeholder="Leave empty to use the default"
              />
              <p className={styles.settingHint}>
                If you see a "Not Found" error, provide a GitHub OAuth app client ID with device flow enabled.
              </p>
            </div>
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
            >
              {availableModels[config.provider]?.map((model) => (
                <option key={model} value={model}>
                  {model}
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
          <span>MCP Servers</span>
        </div>

        <MCPServersSection />
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
