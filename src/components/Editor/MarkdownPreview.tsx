import { useMemo, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import styles from './MarkdownPreview.module.css';

interface MarkdownPreviewProps {
  content: string;
  onScroll?: (scrollPercent: number) => void;
  syncScroll?: boolean;
}

export interface MarkdownPreviewHandle {
  scrollToPercent: (percent: number) => void;
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(
  function MarkdownPreview({ content, onScroll, syncScroll }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const isScrollingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      scrollToPercent: (percent: number) => {
        if (!containerRef.current) return;
        
        const container = containerRef.current;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;
        
        isScrollingRef.current = true;
        container.scrollTop = percent * maxScroll;
        
        requestAnimationFrame(() => {
          isScrollingRef.current = false;
        });
      }
    }));

    const handleScroll = useCallback(() => {
      if (!containerRef.current || !onScroll || isScrollingRef.current) return;
      
      const container = containerRef.current;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) return;
      
      const scrollPercent = container.scrollTop / maxScroll;
      onScroll(scrollPercent);
    }, [onScroll]);

    const renderedContent = useMemo(() => renderMarkdown(content), [content]);

    return (
      <div 
        ref={containerRef}
        className={styles.markdownPreview}
        onScroll={syncScroll ? handleScroll : undefined}
      >
        <div className={styles.content}>
          {renderedContent}
        </div>
      </div>
    );
  }
);

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    const codeBlockMatch = line.match(/^```(\w*)\s*$/);
    if (codeBlockMatch) {
      const lang = codeBlockMatch[1] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      elements.push(
        <pre key={key++} className={styles.codeBlock} data-lang={lang}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headers
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      elements.push(<h1 key={key++} className={styles.h1}>{renderInline(h1Match[1])}</h1>);
      i++;
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      elements.push(<h2 key={key++} className={styles.h2}>{renderInline(h2Match[1])}</h2>);
      i++;
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      elements.push(<h3 key={key++} className={styles.h3}>{renderInline(h3Match[1])}</h3>);
      i++;
      continue;
    }

    const h4Match = line.match(/^####\s+(.+)$/);
    if (h4Match) {
      elements.push(<h4 key={key++} className={styles.h4}>{renderInline(h4Match[1])}</h4>);
      i++;
      continue;
    }

    const h5Match = line.match(/^#####\s+(.+)$/);
    if (h5Match) {
      elements.push(<h5 key={key++} className={styles.h5}>{renderInline(h5Match[1])}</h5>);
      i++;
      continue;
    }

    const h6Match = line.match(/^######\s+(.+)$/);
    if (h6Match) {
      elements.push(<h6 key={key++} className={styles.h6}>{renderInline(h6Match[1])}</h6>);
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      elements.push(<hr key={key++} className={styles.hr} />);
      i++;
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
        <blockquote key={key++} className={styles.blockquote}>
          {quoteLines.map((l, idx) => <p key={idx}>{renderInline(l)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (line.match(/^[\s]*[-*+]\s/)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
        const itemContent = lines[i].replace(/^[\s]*[-*+]\s/, '');
        listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
        i++;
      }
      elements.push(<ul key={key++} className={styles.list}>{listItems}</ul>);
      continue;
    }

    // Ordered list
    if (line.match(/^[\s]*\d+\.\s/)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s/)) {
        const itemContent = lines[i].replace(/^[\s]*\d+\.\s/, '');
        listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
        i++;
      }
      elements.push(<ol key={key++} className={styles.list}>{listItems}</ol>);
      continue;
    }

    // Task list
    if (line.match(/^[\s]*[-*+]\s\[[ x]\]/i)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s\[[ x]\]/i)) {
        const checked = lines[i].match(/\[x\]/i) !== null;
        const itemContent = lines[i].replace(/^[\s]*[-*+]\s\[[ x]\]\s*/i, '');
        listItems.push(
          <li key={key++} className={styles.taskItem}>
            <input type="checkbox" checked={checked} readOnly className={styles.checkbox} />
            <span>{renderInline(itemContent)}</span>
          </li>
        );
        i++;
      }
      elements.push(<ul key={key++} className={styles.taskList}>{listItems}</ul>);
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|?$/)) {
      const tableRows: string[][] = [];
      const headerRow = line.split('|').map(cell => cell.trim()).filter(cell => cell);
      tableRows.push(headerRow);
      i++; // Skip header
      i++; // Skip separator
      
      while (i < lines.length && lines[i].includes('|')) {
        const row = lines[i].split('|').map(cell => cell.trim()).filter(cell => cell);
        if (row.length > 0) {
          tableRows.push(row);
        }
        i++;
      }

      elements.push(
        <table key={key++} className={styles.table}>
          <thead>
            <tr>
              {tableRows[0].map((cell, idx) => (
                <th key={idx}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.slice(1).map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<p key={key++} className={styles.paragraph}>{renderInline(line)}</p>);
    i++;
  }

  return elements;
}

function renderInline(text: string): React.ReactNode {
  interface Match {
    start: number;
    end: number;
    element: React.ReactNode;
  }
  
  const matches: Match[] = [];
  let key = 0;
  let match;

  // Images ![alt](url)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = imgRegex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      element: <img key={key++} src={match[2]} alt={match[1]} className={styles.image} />
    });
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
        element: <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer" className={styles.link}>{match[1]}</a>
      });
    }
  }

  // Inline code `text`
  const codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(text)) !== null) {
    const overlaps = matches.some(m => 
      (match!.index >= m.start && match!.index < m.end) ||
      (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
    );
    if (!overlaps) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        element: <code key={key++} className={styles.inlineCode}>{match[1]}</code>
      });
    }
  }

  // Bold **text** or __text__
  const boldRegex = /(\*\*|__)([^*_]+)\1/g;
  while ((match = boldRegex.exec(text)) !== null) {
    const overlaps = matches.some(m => 
      (match!.index >= m.start && match!.index < m.end) ||
      (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
    );
    if (!overlaps) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        element: <strong key={key++}>{match[2]}</strong>
      });
    }
  }

  // Italic *text* or _text_
  const italicRegex = /(?<![*_])([*_])([^*_]+)\1(?![*_])/g;
  while ((match = italicRegex.exec(text)) !== null) {
    const overlaps = matches.some(m => 
      (match!.index >= m.start && match!.index < m.end) ||
      (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
    );
    if (!overlaps) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        element: <em key={key++}>{match[2]}</em>
      });
    }
  }

  // Strikethrough ~~text~~
  const strikeRegex = /~~([^~]+)~~/g;
  while ((match = strikeRegex.exec(text)) !== null) {
    const overlaps = matches.some(m => 
      (match!.index >= m.start && match!.index < m.end) ||
      (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end)
    );
    if (!overlaps) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        element: <del key={key++}>{match[1]}</del>
      });
    }
  }

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);

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
}
