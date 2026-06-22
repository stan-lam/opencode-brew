import { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';
import styles from './MermaidDiagram.module.css';

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

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

export function MermaidDiagram({ chart, id }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderChart = async () => {
      if (!chart || !chart.trim()) {
        setError('No diagram content provided');
        return;
      }

      let cleanChart = chart.trim();
      cleanChart = cleanChart.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trim();

      if (!cleanChart) {
        setError('Empty diagram after cleanup');
        return;
      }

      const validMermaidStarts = [
        'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 
        'erDiagram', 'journey', 'gantt', 'pie', 'flowchart', 'gitGraph',
        'xychart-beta', 'xychart', 'mindmap', 'timeline', 'sankey-beta',
        'quadrantChart', 'requirement', 'c4Context', 'block-beta'
      ];
      const startsWithValid = validMermaidStarts.some(
        keyword => cleanChart.toLowerCase().startsWith(keyword.toLowerCase())
      );

      if (!startsWithValid) {
        setError('Invalid diagram syntax - must start with a valid Mermaid diagram type');
        return;
      }

      try {
        const sanitizedId = (id || 'diagram')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

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
