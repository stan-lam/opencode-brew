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
} from 'lucide-react';
import { dialog, fs, history } from '../../services/tauri';
import { useAIStore, AIMessage, MessageAttachment, AgentMode } from '../../store/aiStore';
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
  
  // Parse create_file tags
  const createRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    operations.push({
      type: 'create',
      path: match[1],
      content: match[2].trim(),
    });
  }
  
  // Parse edit_file tags
  const editRegex = /<edit_file\s+path="([^"]+)"(?:\s+mode="(replace|insert)")?(?:\s+line="(\d+)")?>[\s\S]*?(?:<old_content>([\s\S]*?)<\/old_content>[\s\S]*?<new_content>([\s\S]*?)<\/new_content>|([\s\S]*?))<\/edit_file>/g;
  while ((match = editRegex.exec(content)) !== null) {
    const path = match[1];
    const mode = (match[2] as 'replace' | 'insert') || 'replace';
    const line = match[3] ? parseInt(match[3]) : undefined;
    const oldContent = match[4]?.trim();
    const newContent = match[5]?.trim() || match[6]?.trim();
    
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

  // Parse <checklist> tags
  const checklistRegex = /<checklist\s+title="([^"]+)">([\s\S]*?)<\/checklist>/g;
  while ((match = checklistRegex.exec(content)) !== null) {
    const title = match[1];
    const items = match[2].split('\n')
      .filter(l => l.trim().startsWith('- ['))
      .map(l => l.trim().substring(2).trim());
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
function PlanView({ plan }: { plan: Plan }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview', 'approaches', 'tasks']));
  const [tasks, setTasks] = useState<PlanTask[]>(plan.tasks);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { currentWorkspace } = useWorkspaceStore();

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
                <div key={idx} className={`${styles.approach} ${approach.recommended ? styles.recommended : ''}`}>
                  <div className={styles.approachHeader}>
                    <span className={styles.approachName}>{approach.name}</span>
                    {approach.recommended && <span className={styles.recommendedBadge}>Recommended</span>}
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
function ChecklistView({ checklist }: { checklist: Checklist }) {
  return (
    <div className={styles.checklistContainer}>
      <div className={styles.checklistHeader}>
        <span className={styles.checklistIcon}>✓</span>
        <h4 className={styles.checklistTitle}>{checklist.title}</h4>
      </div>
      <ul className={styles.checklistItems}>
        {checklist.items.map((item, idx) => (
          <li key={idx} className={styles.checklistItem}>
            <input type="checkbox" className={styles.checklistCheckbox} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
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

function MessageBubble({ message, onOperationsChange }: { 
  message: AIMessage;
  onOperationsChange?: (ops: FileOperation[]) => void;
}) {
  const isUser = message.role === 'user';
  const [pendingOps, setPendingOps] = useState<FileOperation[]>([]);
  const [planComponents, setPlanComponents] = useState<{ plans: Plan[]; checklists: Checklist[]; decisions: Decision[] }>({ plans: [], checklists: [], decisions: [] });
  const [actionableTasks, setActionableTasks] = useState<string[]>([]);
  const [codeBlockTasks, setCodeBlockTasks] = useState<string[]>([]);
  const { currentWorkspace} = useWorkspaceStore();
  const { openFile } = useEditorStore();
  const { agentMode, setAgentMode } = useAIStore();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
  };

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
      
      // Detect actionable tasks in Plan Mode
      if (agentMode === 'plan') {
        const tasks = detectActionableTasks(message.content);
        setActionableTasks(tasks);
      } else {
        setActionableTasks([]);
      }
    }
  }, [message.content, isUser, agentMode]);
  // Note: onOperationsChange is intentionally omitted from deps to prevent infinite loops

  // Remove plan XML tags from content for markdown rendering
  const getCleanedContent = (content: string): string => {
    let cleaned = content;
    
    // In plan mode, detect and remove code blocks
    if (agentMode === 'plan') {
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      const detectedCodeBlocks: string[] = [];
      let match;
      
      while ((match = codeBlockRegex.exec(content)) !== null) {
        const lang = match[1] || 'code';
        const codeContent = match[2].trim();
        
        // Skip mermaid diagrams (they're allowed for architecture)
        if (lang.toLowerCase() === 'mermaid') {
          continue;
        }
        
        // Create task description from code block
        const lines = codeContent.split('\n').slice(0, 3); // First 3 lines
        const preview = lines.join('; ').substring(0, 80);
        const taskDesc = `Implement ${lang || 'code'}: ${preview}${codeContent.length > 80 ? '...' : ''}`;
        detectedCodeBlocks.push(taskDesc);
      }
      
      // Update code block tasks if any were found
      if (detectedCodeBlocks.length > 0) {
        setCodeBlockTasks(detectedCodeBlocks);
      }
      
      // Remove all code blocks except mermaid
      cleaned = cleaned.replace(/```(?!mermaid)(\w*)\n[\s\S]*?```/g, () => {
        return `\n**[Code block removed - Switch to Agent Mode to see implementation]**\n`;
      });
    }
    
    // Remove complete file operation tags (with closing tags)
    cleaned = cleaned.replace(/<create_file\s+path="[^"]*">[\s\S]*?<\/create_file>/gi, '');
    cleaned = cleaned.replace(/<edit_file[\s\S]*?<\/edit_file>/gi, '');
    cleaned = cleaned.replace(/<delete_file\s+path="[^"]*"\s*\/>/gi, '');
    
    // Handle streaming/incomplete file operations - wrap content in code blocks for display
    // This shows the code as it streams with proper formatting
    if (agentMode !== 'plan') {
      // If there's an opening create_file tag without a closing tag, wrap content in code block
      cleaned = cleaned.replace(/<create_file\s+path="([^"]*)">([\s\S]*)$/gi, (match, path, content) => {
        // Extract the file extension from path for language hint
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
          'ts': 'typescript', 'tsx': 'typescript', 'js': 'javascript', 'jsx': 'javascript',
          'css': 'css', 'html': 'html', 'json': 'json', 'md': 'markdown',
          'py': 'python', 'rs': 'rust', 'go': 'go', 'java': 'java'
        };
        const lang = langMap[ext] || ext;
        
        return `\n**Creating \`${path}\`**\n\n\`\`\`${lang}\n${content}\`\`\``;
      });
      
      // Same for edit_file with old/new content
      cleaned = cleaned.replace(/<edit_file\s+([^>]*)>([\s\S]*)$/gi, (match, attrs, content) => {
        // Try to extract path
        const pathMatch = attrs.match(/path="([^"]*)"/);
        const path = pathMatch ? pathMatch[1] : 'file';
        
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
          'ts': 'typescript', 'tsx': 'typescript', 'js': 'javascript', 'jsx': 'javascript',
          'css': 'css', 'html': 'html', 'json': 'json', 'md': 'markdown',
          'py': 'python', 'rs': 'rust', 'go': 'go', 'java': 'java'
        };
        const lang = langMap[ext] || ext;
        
        // Extract new_content if available
        const newContentMatch = content.match(/<new_content>([\s\S]*?)(?:<\/new_content>|$)/i);
        const newContent = newContentMatch ? newContentMatch[1] : '';
        
        if (newContent) {
          return `\n**Editing \`${path}\`**\n\n\`\`\`${lang}\n${newContent}\`\`\``;
        }
        
        return `\n**Editing \`${path}\`...**\n`;
      });
    }
    
    // Remove <plan>...</plan> blocks (entire block) - handle with or without title
    cleaned = cleaned.replace(/<plan(?:\s+title="[^"]*")?>([\s\S]*?)<\/plan>/gi, '');
    
    // Remove <checklist>...</checklist> blocks
    cleaned = cleaned.replace(/<checklist(?:\s+title="[^"]*")?>([\s\S]*?)<\/checklist>/gi, '');
    
    // Remove <decision>...</decision> blocks
    cleaned = cleaned.replace(/<decision(?:\s+question="[^"]*")?>([\s\S]*?)<\/decision>/gi, '');
    
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
    
    // Remove any remaining XML-like tags as fallback (opening and closing pairs)
    // This catches custom tags like <design-system>, <foo-bar>, etc.
    // Match pattern: <tag-name [attributes]>content</tag-name> where tag can have hyphens
    cleaned = cleaned.replace(/<([a-z][a-z0-9\-_]*)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi, '');
    
    // Remove standalone opening/closing XML tags that might be left (including hyphenated names)
    cleaned = cleaned.replace(/<\/?[a-z][a-z0-9\-_]*(?:\s+[^>]*)?\s*\/?>/gi, '');
    
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
            <span className={styles.fileOpsCount}>{pendingOps.length} pending</span>
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
            <PlanView key={idx} plan={plan} />
          ))}
          {planComponents.checklists.map((checklist, idx) => (
            <ChecklistView key={idx} checklist={checklist} />
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
          onSwitchToAgent={() => setAgentMode('agent')} 
        />
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
                  <li key={idx} className={styles.checklistItem}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      readOnly 
                      className={styles.checkbox}
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
                  <li key={idx} className={styles.checklistItem}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      readOnly 
                      className={styles.checkbox}
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

      // Headers
      if (line.startsWith('# ')) {
        elements.push(<h1 key={key++} className={styles.mdH1}>{renderInline(line.slice(2))}</h1>);
        i++;
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={key++} className={styles.mdH2}>{renderInline(line.slice(3))}</h2>);
        i++;
        continue;
      }
      if (line.startsWith('### ')) {
        elements.push(<h3 key={key++} className={styles.mdH3}>{renderInline(line.slice(4))}</h3>);
        i++;
        continue;
      }
      if (line.startsWith('#### ')) {
        elements.push(<h4 key={key++} className={styles.mdH4}>{renderInline(line.slice(5))}</h4>);
        i++;
        continue;
      }

      // Horizontal rule
      if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
        elements.push(<hr key={key++} className={styles.mdHr} />);
        i++;
        continue;
      }

      // Unordered lists (including checkboxes)
      if (line.match(/^[\s]*[-*+]\s/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
          const itemContent = lines[i].replace(/^[\s]*[-*+]\s/, '');
          
          // Check for checkbox syntax: [ ] or [x] or [X]
          const checkboxMatch = itemContent.match(/^(\[[ xX]\])\s+(.+)$/);
          if (checkboxMatch) {
            const isChecked = checkboxMatch[1].toLowerCase() === '[x]';
            const text = checkboxMatch[2];
            listItems.push(
              <li key={key++} className={styles.checklistItem}>
                <input 
                  type="checkbox" 
                  checked={isChecked} 
                  readOnly 
                  className={styles.checkbox}
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

      // Tables - detect lines with | separators (supports both |a|b| and a|b formats)
      // Check if this line and the next form a table (header + separator pattern)
      const hasTablePipe = line.includes('|');
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const isSeparatorLine = (l: string): boolean => {
        // Separator can be |---|---| or just ---|---
        const trimmed = l.trim();
        const withoutOuterPipes = trimmed.startsWith('|') && trimmed.endsWith('|') 
          ? trimmed.slice(1, -1) 
          : trimmed;
        const cells = withoutOuterPipes.split('|');
        return cells.length > 0 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
      };
      
      if (hasTablePipe && isSeparatorLine(nextLine)) {
        const tableRows: string[][] = [];
        let hasHeader = false;
        
        // Helper to parse a table row (handles both |a|b| and a|b formats)
        const parseTableRow = (row: string): string[] => {
          let trimmed = row.trim();
          // Remove outer pipes if present
          if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
          if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
          return trimmed.split('|').map(cell => cell.trim());
        };
        
        // Helper to check if line is part of the table
        const isTableRow = (l: string): boolean => {
          return l.includes('|');
        };
        
        // Collect all table rows
        while (i < lines.length && isTableRow(lines[i])) {
          const row = lines[i];
          // Check if this is a separator row
          if (isSeparatorLine(row)) {
            hasHeader = tableRows.length > 0;
            i++;
            continue;
          }
          tableRows.push(parseTableRow(row));
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

      // Regular paragraph
      elements.push(<p key={key++} className={styles.mdParagraph}>{renderInline(line)}</p>);
      i++;
    }

    return elements;
  };

  const renderInline = (text: string): React.ReactNode => {
    // Use regex to find all inline patterns and split text accordingly
    const patterns = [
      { regex: /`([^`]+)`/g, render: (match: string, content: string, key: number) => 
        <code key={key} className={styles.inlineCode}>{content}</code> },
      { regex: /\*\*([^*]+)\*\*/g, render: (match: string, content: string, key: number) => 
        <strong key={key}>{content}</strong> },
      { regex: /\*([^*]+)\*/g, render: (match: string, content: string, key: number) => 
        <em key={key}>{content}</em> },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, render: (match: string, text: string, url: string, key: number) => 
        <a key={key} href={url} target="_blank" rel="noopener noreferrer">{text}</a> },
    ];

    // Find all matches with their positions
    interface Match {
      start: number;
      end: number;
      element: React.ReactNode;
    }
    
    const matches: Match[] = [];
    let key = 0;

    // Inline code `text`
    const codeRegex = /`([^`]+)`/g;
    let match;
    while ((match = codeRegex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        element: <code key={key++} className={styles.inlineCode}>{match[1]}</code>
      });
    }

    // Bold **text**
    const boldRegex = /\*\*([^*]+)\*\*/g;
    while ((match = boldRegex.exec(text)) !== null) {
      // Check if this overlaps with existing matches
      const overlaps = matches.some(m => 
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
      );
      if (!overlaps) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          element: <strong key={key++}>{match[1]}</strong>
        });
      }
    }

    // Italic *text* (but not inside **)
    const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)/g;
    while ((match = italicRegex.exec(text)) !== null) {
      const overlaps = matches.some(m => 
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
      );
      if (!overlaps) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          element: <em key={key++}>{match[1]}</em>
        });
      }
    }

    // Links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(text)) !== null) {
      const overlaps = matches.some(m => 
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
      );
      if (!overlaps) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          element: <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]}</a>
        });
      }
    }

    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start);

    // Build result
    if (matches.length === 0) {
      return text;
    }

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const m of matches) {
      if (m.start > lastEnd) {
        parts.push(text.slice(lastEnd, m.start));
      }
      parts.push(m.element);
      lastEnd = m.end;
    }

    if (lastEnd < text.length) {
      parts.push(text.slice(lastEnd));
    }

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

  return (
    <div className={styles.fileOpPreview}>
      <div className={styles.fileOpHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={`${styles.fileOpIcon} ${styles[`fileOp${operation.type}`]}`}>
          {getOperationIcon()}
        </span>
        <span className={styles.fileOpTitle}>{getOperationTitle()}</span>
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
                <div className={styles.fileOpDiffLabel}>- Remove</div>
                {renderCodeBlock(operation.oldContent, styles.fileOpDiffOld)}
              </div>
              <div className={styles.fileOpDiffSection}>
                <div className={styles.fileOpDiffLabel}>+ Add</div>
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
  operations: Array<{operation: FileOperation; messageId: string; applied: boolean}>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onKeepAll: () => void;
  onUndoAll: () => void;
  onReview: () => void;
  onAcceptFile: (index: number) => void;
  onUndoFile: (index: number) => void;
}) {
  if (operations.length === 0) return null;

  const fileCount = operations.length;
  const appliedCount = operations.filter(op => op.applied).length;
  const pendingCount = fileCount - appliedCount;

  // If all operations are applied, show a dismiss option instead of hiding completely
  const allApplied = appliedCount === fileCount && fileCount > 0;

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
            {allApplied ? ' (All Applied)' : appliedCount > 0 ? ` (${appliedCount} applied)` : ''}
          </span>
        </div>
        {allApplied ? (
          <div className={styles.fileOpsBarActions}>
            <button 
              className={styles.fileOpsBarBtn}
              onClick={(e) => { e.stopPropagation(); onUndoAll(); }}
              title="Dismiss"
            >
              Dismiss
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
          {operations.map((item, index) => (
            <div 
              key={index} 
              className={`${styles.fileOpsItem} ${item.applied ? styles.fileOpsItemApplied : ''}`}
            >
              <span className={`${styles.fileOpsItemIcon} ${getFileIconClass(item.operation.type)}`}>
                {getFileIcon(item.operation.type)}
              </span>
              <span className={styles.fileOpsItemName}>
                {getFileName(item.operation.path)}
              </span>
              <span className={styles.fileOpsItemStats}>
                {getLineStats(item.operation)}
              </span>
              <div className={styles.fileOpsItemActions}>
                {!item.applied ? (
                  <>
                    <button
                      className={styles.fileOpsItemBtnAccept}
                      onClick={() => onAcceptFile(index)}
                      title="Accept"
                    >
                      ✓
                    </button>
                    <button
                      className={styles.fileOpsItemBtnReject}
                      onClick={() => onUndoFile(index)}
                      title="Reject"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.fileOpsItemBtnUndo}
                    onClick={() => onUndoFile(index)}
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
    createConversation,
    setActiveConversation,
    setAgentMode,
    sendMessage,
    queuePrompt,
    clearQueue,
    stopStreaming,
    refreshAvailableModels,
  } = useAIStore();

  const { currentWorkspace } = useWorkspaceStore();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [allPendingOps, setAllPendingOps] = useState<Array<{operation: FileOperation; messageId: string; applied: boolean}>>([]);
  const [fileOpsExpanded, setFileOpsExpanded] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const forceScrollRef = useRef(false);
  const { deleteConversation, importConversationsFromPath } = useAIStore();

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
              updatedOps[i] = { ...item, applied: true };
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

  useEffect(() => {
    if (config.provider === 'ollama') {
      refreshAvailableModels();
    }
  }, [config.provider, refreshAvailableModels]);

  const isVisionModel = useCallback(() => {
    if (config.provider === 'openai' || config.provider === 'claude') {
      return true; // OpenAI and Claude support vision
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
             modelLower.includes('paligemma');
    }
    return false;
  }, [config.provider, config.model]);

  const handleAttachClick = () => {
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
        `Claude: Any Claude 3+ model\n\n` +
        `Do you want to open Settings to change the model?`
      );
      
      if (shouldContinue) {
        setShowSettings(true);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newAttachments: MessageAttachment[] = [];

    for (const file of fileArray) {
      const isImage = file.type.startsWith('image/');
      
      if (isImage) {
        // Convert image to base64
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        newAttachments.push({
          id: crypto.randomUUID(),
          type: 'image',
          name: file.name,
          data: base64,
          mimeType: file.type,
          size: file.size,
        });
      } else {
        // For other files, just store metadata
        newAttachments.push({
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          mimeType: file.type,
          size: file.size,
        });
      }
    }

    setAttachments([...attachments, ...newAttachments]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFileUpload(files);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter(a => a.id !== id));
  };

  const handleKeepAllOperations = async () => {
    const { currentWorkspace } = useWorkspaceStore.getState();
    const { openFile } = useEditorStore.getState();
    
    if (!currentWorkspace) {
      console.error('No workspace open');
      return;
    }

    // Helper to ensure parent directory exists
    const ensureParentDir = async (absoluteFilePath: string, relativePath: string) => {
      // Get parent directory from absolute file path
      const lastSlash = absoluteFilePath.lastIndexOf('/');
      if (lastSlash === -1) return;
      
      const parentDir = absoluteFilePath.substring(0, lastSlash);
      
      try {
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
      } catch (error) {
        console.error('Failed to ensure parent directory:', error);
        throw error;
      }
    };

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
        const fullPath = `${currentWorkspace.rootPath}/${item.operation.path}`;
        
        if (item.operation.type === 'create') {
          // Check if file already exists
          const fileExists = await fs.pathExists(fullPath);
          if (fileExists) {
            console.log(`File already exists, skipping: ${item.operation.path}`);
            // Mark as applied even though we skipped it
            updatedOps[i] = { ...updatedOps[i], applied: true };
            skippedCount++;
            continue;
          }
          
          // Ensure parent directory exists
          await ensureParentDir(fullPath, item.operation.path);
          await fs.writeFile(fullPath, item.operation.content || '');
          // Save to local history
          await history.save(item.operation.path, item.operation.content || '').catch(console.error);
          await openFile(fullPath);
        } else if (item.operation.type === 'edit') {
          if (item.operation.mode === 'replace' && item.operation.oldContent && item.operation.newContent) {
            const currentContent = await fs.readFile(fullPath);
            const updatedContent = currentContent.replace(item.operation.oldContent, item.operation.newContent);
            await fs.writeFile(fullPath, updatedContent);
            // Save to local history
            await history.save(item.operation.path, updatedContent).catch(console.error);
            await openFile(fullPath);
          } else if (item.operation.mode === 'insert' && item.operation.line && item.operation.newContent) {
            const currentContent = await fs.readFile(fullPath);
            const lines = currentContent.split('\n');
            lines.splice(item.operation.line - 1, 0, item.operation.newContent);
            const updatedContent = lines.join('\n');
            await fs.writeFile(fullPath, updatedContent);
            // Save to local history
            await history.save(item.operation.path, updatedContent).catch(console.error);
            await openFile(fullPath);
          }
        } else if (item.operation.type === 'delete') {
          await fs.deletePath(fullPath);
        }

        // Mark as applied in our local array
        updatedOps[i] = { ...updatedOps[i], applied: true };
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
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: `Applied ${successCount} file operation(s)${skippedCount > 0 ? `, skipped ${skippedCount} already applied` : ''}`, type: 'success' }
      }));
    } else if (skippedCount > 0) {
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { message: 'All operations already applied', type: 'info' }
      }));
    }
  };

  const handleUndoAllOperations = () => {
    setAllPendingOps([]);
    window.dispatchEvent(new CustomEvent('show-notification', {
      detail: { message: 'Removed all pending file operations', type: 'info' }
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

    // Helper to ensure parent directory exists
    const ensureParentDir = async (absoluteFilePath: string, relativePath: string) => {
      // Get parent directory from absolute file path
      const lastSlash = absoluteFilePath.lastIndexOf('/');
      if (lastSlash === -1) return;
      
      const parentDir = absoluteFilePath.substring(0, lastSlash);
      
      try {
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
      } catch (error) {
        console.error('Failed to ensure parent directory:', error);
        throw error;
      }
    };

    try {
      const fullPath = `${currentWorkspace.rootPath}/${item.operation.path}`;
      
      if (item.operation.type === 'create') {
        // Check if file already exists
        const fileExists = await fs.pathExists(fullPath);
        if (fileExists) {
          console.log(`File already exists, skipping: ${item.operation.path}`);
          // Mark as applied even though we skipped it
          setAllPendingOps(prev => prev.map((op, idx) => 
            idx === index ? { ...op, applied: true } : op
          ));
          window.dispatchEvent(new CustomEvent('show-notification', {
            detail: { message: `File already exists: ${item.operation.path}`, type: 'info' }
          }));
          return;
        }
        
        // Ensure parent directory exists
        await ensureParentDir(fullPath, item.operation.path);
        await fs.writeFile(fullPath, item.operation.content || '');
        // Save to local history
        await history.save(item.operation.path, item.operation.content || '').catch(console.error);
        await openFile(fullPath);
      } else if (item.operation.type === 'edit') {
        if (item.operation.mode === 'replace' && item.operation.oldContent && item.operation.newContent) {
          const currentContent = await fs.readFile(fullPath);
          const updatedContent = currentContent.replace(item.operation.oldContent, item.operation.newContent);
          await fs.writeFile(fullPath, updatedContent);
          // Save to local history
          await history.save(item.operation.path, updatedContent).catch(console.error);
          await openFile(fullPath);
        } else if (item.operation.mode === 'insert' && item.operation.line && item.operation.newContent) {
          const currentContent = await fs.readFile(fullPath);
          const lines = currentContent.split('\n');
          lines.splice(item.operation.line - 1, 0, item.operation.newContent);
          const updatedContent = lines.join('\n');
          await fs.writeFile(fullPath, updatedContent);
          // Save to local history
          await history.save(item.operation.path, updatedContent).catch(console.error);
          await openFile(fullPath);
        }
      } else if (item.operation.type === 'delete') {
        await fs.deletePath(fullPath);
      }

      // Mark as applied
      setAllPendingOps(prev => prev.map((op, idx) => 
        idx === index ? { ...op, applied: true } : op
      ));

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
    setAllPendingOps(prev => prev.filter((_, idx) => idx !== index));
    window.dispatchEvent(new CustomEvent('show-notification', {
      detail: { message: 'Removed file operation', type: 'info' }
    }));
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
    if (!input.trim()) return;

    const message = input;
    const messageAttachments = attachments;
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
            {(agentMode === 'agent' || agentMode === 'edit' || agentMode === 'plan') && (
              <div className={styles.modeBanner}>
                <div className={styles.modeBannerIcon}>
                  {agentMode === 'agent' ? '✨' : agentMode === 'edit' ? '📝' : '📋'}
                </div>
                <div className={styles.modeBannerText}>
                  <strong>
                    {agentMode === 'agent' ? 'Agent Mode' : agentMode === 'edit' ? 'Edit Mode' : 'Plan Mode'} Active
                  </strong>
                  <p>
                    {agentMode === 'agent' 
                      ? 'The AI can create, edit, and delete files in your workspace. All changes require your approval.'
                      : agentMode === 'edit'
                      ? 'The AI will help you edit existing files with precise changes. All edits require your approval.'
                      : 'The AI will help you plan and design solutions before implementation. Focus on architecture, approaches, and breaking down tasks.'}
                  </p>
                </div>
              </div>
            )}
            {activeConversation.messages.map((message) => (
              <MessageBubble 
                key={message.id} 
                message={message} 
                onOperationsChange={async (ops) => {
                  const { isFileOperationKept } = useAIStore.getState();
                  
                  // Check if operations are kept or if files already exist
                  const opsWithStatus = await Promise.all(
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
            onChange={(e) => {
              if (e.target.files) {
                handleFileUpload(e.target.files);
              }
            }}
          />
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
              <button
                type={isStreaming ? "button" : "submit"}
                className={styles.sendBtn}
                disabled={!isStreaming && !input.trim()}
                onClick={isStreaming ? stopStreaming : undefined}
                title={isStreaming ? 'Stop generating' : (promptQueue.length > 0 ? 'Queue prompt' : 'Send message')}
              >
                {isStreaming ? <Square size={18} /> : <Send size={18} />}
              </button>
            </div>
          </div>
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
      </div>
    </div>
  );
}

function AISettings({ onClose }: { onClose: () => void }) {
  const { config, setConfig, availableModels, refreshAvailableModels } = useAIStore();

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
            <option value="custom">Custom Endpoint</option>
          </select>
        </div>

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
            {config.provider === 'ollama' && (
              <button onClick={refreshAvailableModels} title="Refresh models">
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
        </div>

        {config.provider !== 'ollama' && (
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
      </div>
    </div>
  );
}
