import { useEffect, useState } from 'react';
import {
  FlaskConical,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  Package,
  Check,
  AlertTriangle,
  Play,
  FileCode,
  Plus,
  Minus,
} from 'lucide-react';
import { useTestStore, PendingChange, TestCategory } from '../../store/testStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAIStore } from '../../store/aiStore';
import styles from './TestPanel.module.css';

export function TestPanel() {
  const { activeSideTab } = useLayoutStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { isStreaming, activeConversation, thinkingStatus } = useAIStore();
  const {
    pendingChanges,
    testPlan,
    selectedTests,
    dependencyAudit,
    isAnalyzing,
    isCreatingTests,
    isFetchingChanges,
    customInstructions,
    error,
    lastFetchedAt,
    analysisProgress,
    creationProgress,
    creationSummary,
    fetchPendingChanges,
    analyzeChanges,
    setCustomInstructions,
    toggleTestSelection,
    selectAllTests,
    deselectAllTests,
    toggleCategoryExpanded,
    createSelectedTests,
    clearTestPlan,
    setError,
  } = useTestStore();

  const [showChanges, setShowChanges] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Force refresh when testPlan changes
  useEffect(() => {
    setRefreshKey(k => k + 1);
  }, [testPlan]);

  const formatProgressPreview = (content: string): string => {
    let text = content;
    
    // Extract test_plan title/name
    const nameMatch = text.match(/<name>([^<]+)<\/name>/i);
    const titleMatch = text.match(/<test_plan[^>]*title="([^"]+)"/i);
    
    // Extract description/summary
    const descMatch = text.match(/<description>([^<]+)<\/description>/i);
    const summaryMatch = text.match(/<summary>([^<]+)<\/summary>/i);
    
    // Extract categories
    const categories: string[] = [];
    const categoryRegex = /<category[^>]*name="([^"]+)"/gi;
    let catMatch;
    while ((catMatch = categoryRegex.exec(text)) !== null) {
      categories.push(catMatch[1]);
    }
    
    // Extract test files
    const testFiles: string[] = [];
    const fileRegex = /<test_file[^>]*path="([^"]+)"[^>]*>/gi;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(text)) !== null) {
      testFiles.push(fileMatch[1]);
    }
    
    // Build readable output
    const lines: string[] = [];
    
    const planName = nameMatch?.[1] || titleMatch?.[1];
    if (planName) {
      lines.push(`📋 ${planName}`);
      lines.push('');
    }
    
    const desc = descMatch?.[1] || summaryMatch?.[1];
    if (desc) {
      lines.push(desc.trim().slice(0, 200) + (desc.length > 200 ? '...' : ''));
      lines.push('');
    }
    
    if (categories.length > 0) {
      lines.push(`Categories: ${categories.join(', ')}`);
    }
    
    if (testFiles.length > 0) {
      lines.push(`Test files: ${testFiles.length} planned`);
      testFiles.slice(0, 5).forEach(f => lines.push(`  • ${f}`));
      if (testFiles.length > 5) {
        lines.push(`  ... and ${testFiles.length - 5} more`);
      }
    }
    
    // If we couldn't parse XML, clean up markdown and text
    if (lines.length === 0) {
      // Clean up the text for display
      text = text
        // Remove XML tags
        .replace(/<[^>]+>/g, ' ')
        // Convert markdown headers to plain text with emoji
        .replace(/^#{1,6}\s+(.+)$/gm, '📌 $1')
        // Remove markdown table separators
        .replace(/\|[-:]+\|[-:|\s]+\|/g, '')
        // Clean up table rows - extract content
        .replace(/\|\s*\*\*([^*|]+)\*\*\s*\|/g, '• $1: ')
        .replace(/\|\s*([^|]+)\s*\|/g, '$1 ')
        // Remove remaining pipes
        .replace(/\|/g, ' ')
        // Remove markdown bold/italic
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove markdown links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '[code]')
        .replace(/`([^`]+)`/g, '$1')
        // Clean up bullet points
        .replace(/^\s*[-*]\s+/gm, '• ')
        // Clean up numbered lists
        .replace(/^\s*\d+\.\s+/gm, '• ')
        // Collapse multiple spaces/newlines
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
      
      // Truncate and return
      if (text.length > 400) {
        text = text.slice(0, 400) + '...';
      }
      return text;
    }
    
    return lines.join('\n');
  };

  useEffect(() => {
    if (activeSideTab === 'test' && currentWorkspace?.rootPath) {
      fetchPendingChanges();
    }
  }, [activeSideTab, currentWorkspace?.rootPath, fetchPendingChanges]);

  const handleAnalyze = () => {
    analyzeChanges(customInstructions || undefined);
  };

  const handleQuickAction = (type: 'unit' | 'security' | 'audit') => {
    analyzeChanges(customInstructions || undefined, type);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'modified':
        return <span className={styles.statusModified}>M</span>;
      case 'added':
      case 'untracked':
        return <span className={styles.statusAdded}>A</span>;
      case 'deleted':
        return <span className={styles.statusDeleted}>D</span>;
      case 'renamed':
        return <span className={styles.statusRenamed}>R</span>;
      default:
        return <span className={styles.statusDefault}>?</span>;
    }
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'critical':
        return styles.severityCritical;
      case 'high':
        return styles.severityHigh;
      case 'medium':
        return styles.severityMedium;
      case 'low':
        return styles.severityLow;
      default:
        return '';
    }
  };

  const isLoading = isAnalyzing || isCreatingTests || isFetchingChanges || isStreaming;

  if (!currentWorkspace) {
    return (
      <div className={styles.empty}>
        <FlaskConical size={32} />
        <p>Open a folder to use Test features</p>
      </div>
    );
  }

  return (
    <div className={styles.testPanel}>
      {error && (
        <div className={styles.errorMessage}>
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className={styles.dismissBtn}>×</button>
        </div>
      )}

      <div className={styles.section}>
        <div
          className={styles.sectionHeader}
          onClick={() => setShowChanges(!showChanges)}
        >
          {showChanges ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Pending Changes</span>
          <span className={styles.count}>{pendingChanges.length}</span>
          <button
            className={styles.refreshBtn}
            onClick={(e) => {
              e.stopPropagation();
              fetchPendingChanges();
            }}
            disabled={isFetchingChanges}
            title="Refresh changes"
          >
            <RefreshCw size={14} className={isFetchingChanges ? styles.spinner : ''} />
          </button>
        </div>

        {showChanges && (
          <div className={styles.changesSection}>
            {pendingChanges.length === 0 ? (
              <p className={styles.emptyText}>
                {isFetchingChanges ? 'Loading...' : 'No pending changes'}
              </p>
            ) : (
              <div className={styles.changesList}>
                {pendingChanges.map((change: PendingChange) => (
                  <div key={change.path} className={styles.changeItem}>
                    {getStatusIcon(change.status)}
                    <span className={styles.changePath}>
                      {change.path.split('/').pop()}
                    </span>
                    <span className={styles.changeFullPath}>{change.path}</span>
                    {change.staged && (
                      <span className={styles.stagedBadge}>staged</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.actionsSection}>
        <button
          className={styles.primaryButton}
          onClick={handleAnalyze}
          disabled={isLoading || pendingChanges.length === 0}
        >
          {isAnalyzing ? (
            <>
              <RefreshCw size={16} className={styles.spinner} />
              Analyzing...
            </>
          ) : (
            <>
              <Play size={16} />
              Analyze & Generate Tests
            </>
          )}
        </button>

        <div className={styles.quickActions}>
          <button
            className={styles.quickActionBtn}
            onClick={() => handleQuickAction('unit')}
            disabled={isLoading || pendingChanges.length === 0}
            title="Focus on unit tests"
          >
            <FileCode size={14} />
            Unit Tests
          </button>
          <button
            className={styles.quickActionBtn}
            onClick={() => handleQuickAction('security')}
            disabled={isLoading || pendingChanges.length === 0}
            title="Focus on security tests"
          >
            <Shield size={14} />
            Security Scan
          </button>
          <button
            className={styles.quickActionBtn}
            onClick={() => handleQuickAction('audit')}
            disabled={isLoading || pendingChanges.length === 0}
            title="Audit dependencies"
          >
            <Package size={14} />
            Dep Audit
          </button>
        </div>

        <div className={styles.instructionsSection}>
          <label className={styles.instructionsLabel}>
            Additional instructions (optional)
          </label>
          <textarea
            className={styles.instructionsInput}
            placeholder="e.g., focus on auth edge cases, test error handling..."
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={2}
          />
        </div>

        {(isAnalyzing || isStreaming) && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <RefreshCw size={14} className={styles.spinner} />
              <span>AI Progress</span>
            </div>
            <div className={styles.progressContent}>
              <div className={styles.progressStatus}>
                {analysisProgress || thinkingStatus || 'Processing...'}
              </div>
              {activeConversation?.messages && activeConversation.messages.length > 0 && (
                <div className={styles.progressPreview}>
                  {(() => {
                    const lastMsg = [...activeConversation.messages].reverse().find(m => m.role === 'assistant');
                    if (!lastMsg?.content) return null;
                    const formatted = formatProgressPreview(lastMsg.content);
                    return (
                      <pre className={styles.progressText}>
                        {formatted}
                      </pre>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {testPlan && testPlan.categories.length > 0 && (
        <div className={styles.section} key={`testplan-${refreshKey}`}>
          <div className={styles.sectionHeader}>
            <FlaskConical size={14} />
            <span>Test Plan</span>
            <span className={styles.count}>{testPlan.totalTests} tests</span>
            <div className={styles.selectActions}>
              <button
                className={styles.selectBtn}
                onClick={selectAllTests}
                title="Select all"
              >
                <Check size={12} />
              </button>
              <button
                className={styles.selectBtn}
                onClick={deselectAllTests}
                title="Deselect all"
              >
                <Minus size={12} />
              </button>
              <button
                className={styles.selectBtn}
                onClick={clearTestPlan}
                title="Clear plan"
              >
                ×
              </button>
            </div>
          </div>

          <div className={styles.testPlanSection}>
            {testPlan.categories.map((category: TestCategory) => (
              <div key={category.id} className={styles.category}>
                <div
                  className={styles.categoryHeader}
                  onClick={() => toggleCategoryExpanded(category.id)}
                >
                  {category.expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span>{category.name}</span>
                  <span className={styles.count}>
                    {category.testFiles.length} files
                  </span>
                </div>

                {category.expanded && (
                  <div className={styles.testFiles}>
                    {category.testFiles.map((file) => (
                      <div key={file.id} className={styles.testFileWrapper}>
                        <label className={`${styles.testFile} ${file.creationStatus ? styles[`status${file.creationStatus.charAt(0).toUpperCase() + file.creationStatus.slice(1)}`] : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedTests.has(file.id)}
                            onChange={() => toggleTestSelection(file.id)}
                            disabled={file.creationStatus === 'created'}
                          />
                          {file.creationStatus === 'created' && <Check size={14} className={styles.statusIconCreated} />}
                          {file.creationStatus === 'skipped' && <AlertTriangle size={14} className={styles.statusIconSkipped} />}
                          {file.creationStatus === 'pending' && <RefreshCw size={14} className={`${styles.statusIconPending} ${styles.spinner}`} />}
                          <span className={styles.testFileName}>{file.path}</span>
                          <span className={styles.testCount}>
                            ({file.testCount} tests)
                          </span>
                        </label>
                        {file.creationStatus === 'skipped' && file.creationMessage && (
                          <div className={styles.skipReasonText}>
                            {file.creationMessage}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {isCreatingTests && (
            <div className={styles.creationProgress}>
              <RefreshCw size={14} className={styles.spinner} />
              <span>{creationProgress || 'Creating test files...'}</span>
            </div>
          )}

          {creationSummary && (
            <div className={styles.creationSummary}>
              <span className={styles.summaryCreated}>
                <Check size={12} /> {creationSummary.created} created
              </span>
              {creationSummary.skipped > 0 && (
                <span className={styles.summarySkipped}>
                  <AlertTriangle size={12} /> {creationSummary.skipped} skipped
                </span>
              )}
              {creationSummary.errors > 0 && (
                <span className={styles.summaryErrors}>
                  {creationSummary.errors} errors
                </span>
              )}
            </div>
          )}

          <button
            className={styles.createButton}
            onClick={createSelectedTests}
            disabled={selectedTests.size === 0 || isLoading}
          >
            {isCreatingTests ? (
              <>
                <RefreshCw size={16} className={styles.spinner} />
                Creating...
              </>
            ) : (
              <>
                <Plus size={16} />
                Create Selected Test Files ({selectedTests.size})
              </>
            )}
          </button>
        </div>
      )}

      {dependencyAudit && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <AlertTriangle size={14} />
            <span>Dependency Audit</span>
            <span className={styles.auditSummary}>
              {dependencyAudit.criticalCount > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityCritical}`}>
                  {dependencyAudit.criticalCount} critical
                </span>
              )}
              {dependencyAudit.highCount > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityHigh}`}>
                  {dependencyAudit.highCount} high
                </span>
              )}
            </span>
          </div>

          <div className={styles.auditSection}>
            {dependencyAudit.cves.map((cve) => (
              <div key={cve.id} className={styles.cveItem}>
                <span className={`${styles.severityBadge} ${getSeverityClass(cve.severity)}`}>
                  {cve.severity}
                </span>
                <div className={styles.cveDetails}>
                  <span className={styles.cvePackage}>
                    {cve.package}@{cve.version}
                  </span>
                  <span className={styles.cveId}>{cve.id}</span>
                  <p className={styles.cveDescription}>{cve.description}</p>
                </div>
                {cve.fixAvailable && (
                  <span className={styles.fixBadge}>Fix available</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {lastFetchedAt && (
        <div className={styles.lastFetched}>
          Last updated: {new Date(lastFetchedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
