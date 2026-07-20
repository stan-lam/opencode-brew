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
  ExternalLink,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useTestStore, PendingChange, TestCategory, SnykVulnerability, SecurityFinding, DependencyVulnerability, OutdatedPackage } from '../../store/testStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAIStore } from '../../store/aiStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './TestPanel.module.css';

export function TestPanel() {
  const { activeSideTab } = useLayoutStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { isStreaming, activeConversation, thinkingStatus } = useAIStore();
  const { snykEnabled } = useSettingsStore();
  const {
    pendingChanges,
    testPlan,
    selectedTests,
    dependencyAudit,
    isAnalyzing,
    isCreatingTests,
    isFetchingChanges,
    customInstructions,
    allowOverwrite,
    overwriteAllInBatch,
    error,
    lastFetchedAt,
    analysisProgress,
    creationProgress,
    creationSummary,
    snykResult,
    isScanningSnyk,
    securityScanResult,
    isSecurityScanning,
    securityScanProgress,
    selectedSecurityFindings,
    isFixingSecurityIssues,
    securityFixProgress,
    depAuditResult,
    isAuditingDeps,
    depAuditProgress,
    fetchPendingChanges,
    analyzeChanges,
    setCustomInstructions,
    setAllowOverwrite,
    setOverwriteAllInBatch,
    toggleTestSelection,
    selectAllTests,
    deselectAllTests,
    toggleCategoryExpanded,
    createSelectedTests,
    clearTestPlan,
    setError,
    runSnykScan,
    clearSnykResult,
    runSecurityScan,
    clearSecurityScan,
    toggleSecurityFindingSelection,
    selectAllSecurityFindings,
    deselectAllSecurityFindings,
    fixSelectedSecurityIssues,
    runDepAudit,
    clearDepAudit,
    selectedDepVulnerabilities,
    selectedOutdatedPackages,
    isFixingDepIssues,
    depFixProgress,
    toggleDepVulnerabilitySelection,
    toggleOutdatedPackageSelection,
    selectAllDepIssues,
    deselectAllDepIssues,
    fixSelectedDepIssues,
  } = useTestStore();

  const [showChanges, setShowChanges] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSecurityScopeMenu, setShowSecurityScopeMenu] = useState(false);

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

  // Clear scan results when workspace changes
  useEffect(() => {
    clearSecurityScan();
    clearDepAudit();
    clearSnykResult();
  }, [currentWorkspace?.rootPath, clearSecurityScan, clearDepAudit, clearSnykResult]);

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

  const isLoading = isAnalyzing || isCreatingTests || isFetchingChanges || isStreaming || isScanningSnyk || isSecurityScanning || isAuditingDeps || isFixingSecurityIssues;

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
            title="Generate unit tests for pending changes"
          >
            <FileCode size={14} />
            Unit Tests
          </button>
          <div className={styles.securityScanWrapper}>
            <button
              className={styles.quickActionBtn}
              onClick={() => setShowSecurityScopeMenu(!showSecurityScopeMenu)}
              disabled={isLoading}
              title="Scan code for security vulnerabilities"
            >
              {isSecurityScanning ? (
                <RefreshCw size={14} className={styles.spinner} />
              ) : (
                <Shield size={14} />
              )}
              Security
              <ChevronDown size={10} />
            </button>
            {showSecurityScopeMenu && (
              <div className={styles.scopeMenu}>
                <button
                  className={styles.scopeMenuItem}
                  onClick={() => {
                    setShowSecurityScopeMenu(false);
                    runSecurityScan('changes');
                  }}
                  disabled={pendingChanges.length === 0}
                >
                  Scan Pending Changes
                </button>
                <button
                  className={styles.scopeMenuItem}
                  onClick={() => {
                    setShowSecurityScopeMenu(false);
                    runSecurityScan('codebase');
                  }}
                >
                  Scan Codebase
                </button>
              </div>
            )}
          </div>
          <button
            className={styles.quickActionBtn}
            onClick={runDepAudit}
            disabled={isLoading}
            title="Audit dependencies for vulnerabilities"
          >
            {isAuditingDeps ? (
              <RefreshCw size={14} className={styles.spinner} />
            ) : (
              <Package size={14} />
            )}
            Dep Audit
          </button>
          <button
            className={`${styles.quickActionBtn} ${styles.snykBtn}`}
            onClick={runSnykScan}
            disabled={isLoading || !snykEnabled}
            title={snykEnabled ? "Run Snyk security scan" : "Enable Snyk in Settings to use this feature"}
          >
            {isScanningSnyk ? (
              <RefreshCw size={14} className={styles.spinner} />
            ) : (
              <ShieldCheck size={14} />
            )}
            Snyk
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
      <div className={styles.overwriteOption}>
        <label className={styles.overwriteLabel}>
          <input
            type="checkbox"
            checked={allowOverwrite}
            onChange={(e) => setAllowOverwrite(e.target.checked)}
            disabled={isLoading}
          />
          <span>Allow overwriting existing test files (asks each time)</span>
        </label>
      </div>
      <div className={styles.overwriteOption}>
        <label className={styles.overwriteLabel}>
          <input
            type="checkbox"
            checked={overwriteAllInBatch}
            onChange={(e) => setOverwriteAllInBatch(e.target.checked)}
            disabled={isLoading || !allowOverwrite}
          />
          <span>Overwrite all existing test files in this batch</span>
        </label>
      </div>

        {isSecurityScanning && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <RefreshCw size={14} className={styles.spinner} />
              <span>Security Scan</span>
            </div>
            <div className={styles.progressContent}>
              <div className={styles.progressStatus}>
                {securityScanProgress || 'Scanning...'}
              </div>
            </div>
          </div>
        )}

        {isAuditingDeps && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <RefreshCw size={14} className={styles.spinner} />
              <span>Dependency Audit</span>
            </div>
            <div className={styles.progressContent}>
              <div className={styles.progressStatus}>
                {depAuditProgress || 'Auditing...'}
              </div>
            </div>
          </div>
        )}

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
                          {file.creationStatus === 'error' && <X size={14} className={styles.statusIconError} />}
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
                        {file.creationStatus === 'error' && file.creationMessage && (
                          <div className={styles.errorReasonText}>
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

      {snykResult && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <ShieldCheck size={14} />
            <span>Snyk Scan</span>
            {snykResult.projectName && (
              <span className={styles.projectName}>{snykResult.projectName}</span>
            )}
            <span className={styles.auditSummary}>
              {snykResult.summary.criticalCount > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityCritical}`}>
                  {snykResult.summary.criticalCount} critical
                </span>
              )}
              {snykResult.summary.highCount > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityHigh}`}>
                  {snykResult.summary.highCount} high
                </span>
              )}
            </span>
            <button
              className={styles.dismissBtn}
              onClick={clearSnykResult}
              title="Clear results"
            >
              <X size={12} />
            </button>
          </div>

          {snykResult.error ? (
            <div className={styles.snykError}>
              <AlertTriangle size={14} />
              <span>{snykResult.error}</span>
            </div>
          ) : snykResult.ok ? (
            <div className={styles.snykSuccess}>
              <Check size={14} />
              <span>No vulnerabilities found</span>
            </div>
          ) : (
            <div className={styles.snykSection}>
              <div className={styles.snykSummary}>
                <span className={styles.snykTotal}>
                  {snykResult.summary.totalVulnerabilities} vulnerabilities found
                </span>
              </div>
              {snykResult.vulnerabilities.map((vuln: SnykVulnerability) => (
                <div key={vuln.id} className={styles.snykItem}>
                  <span className={`${styles.severityBadge} ${getSeverityClass(vuln.severity)}`}>
                    {vuln.severity}
                  </span>
                  <div className={styles.snykDetails}>
                    <span className={styles.snykPackage}>
                      {vuln.packageName}@{vuln.version}
                    </span>
                    <span className={styles.snykTitle}>{vuln.title}</span>
                    {vuln.cvssScore && (
                      <span className={styles.snykCvss}>CVSS: {vuln.cvssScore}</span>
                    )}
                    {vuln.description && (
                      <p className={styles.snykDescription}>
                        {vuln.description.slice(0, 200)}
                        {vuln.description.length > 200 ? '...' : ''}
                      </p>
                    )}
                  </div>
                  <div className={styles.snykActions}>
                    {vuln.fixedIn && (
                      <span className={styles.fixBadge}>Fix: {vuln.fixedIn}</span>
                    )}
                    {vuln.url && (
                      <a
                        href={vuln.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.snykLink}
                        title="View on Snyk"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {securityScanResult && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Shield size={14} />
            <span>Security Scan</span>
            <span className={styles.scanScope}>
              ({securityScanResult.scanScope === 'changes' ? 'Pending Changes' : 'Codebase'})
            </span>
            <span className={styles.auditSummary}>
              {securityScanResult.summary.critical > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityCritical}`}>
                  {securityScanResult.summary.critical} critical
                </span>
              )}
              {securityScanResult.summary.high > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityHigh}`}>
                  {securityScanResult.summary.high} high
                </span>
              )}
            </span>
            {securityScanResult.findings.length > 0 && (
              <div className={styles.selectActions}>
                <button
                  className={styles.selectBtn}
                  onClick={selectAllSecurityFindings}
                  title="Select all"
                >
                  <Check size={12} />
                </button>
                <button
                  className={styles.selectBtn}
                  onClick={deselectAllSecurityFindings}
                  title="Deselect all"
                >
                  <Minus size={12} />
                </button>
              </div>
            )}
            <button
              className={styles.dismissBtn}
              onClick={clearSecurityScan}
              title="Clear results"
            >
              <X size={12} />
            </button>
          </div>

          {securityScanResult.error ? (
            <div className={styles.scanError}>
              <AlertTriangle size={14} />
              <span>{securityScanResult.error}</span>
            </div>
          ) : securityScanResult.findings.length === 0 ? (
            <div className={styles.scanSuccess}>
              <Check size={14} />
              <span>No security issues found in {securityScanResult.scannedFiles} files</span>
            </div>
          ) : (
            <div className={styles.securitySection}>
              <div className={styles.scanSummary}>
                <span>{securityScanResult.findings.length} issues found in {securityScanResult.scannedFiles} files</span>
                {selectedSecurityFindings.size > 0 && (
                  <span className={styles.selectedCount}>({selectedSecurityFindings.size} selected)</span>
                )}
              </div>

              {isFixingSecurityIssues && (
                <div className={styles.fixProgress}>
                  <RefreshCw size={14} className={styles.spinner} />
                  <span>{securityFixProgress || 'Applying fixes...'}</span>
                </div>
              )}

              {securityScanResult.findings.map((finding: SecurityFinding) => (
                <div 
                  key={finding.id} 
                  className={`${styles.findingItem} ${selectedSecurityFindings.has(finding.id) ? styles.findingSelected : ''}`}
                >
                  <div className={styles.findingHeader}>
                    <input
                      type="checkbox"
                      checked={selectedSecurityFindings.has(finding.id)}
                      onChange={() => toggleSecurityFindingSelection(finding.id)}
                      className={styles.findingCheckbox}
                    />
                    <span className={`${styles.severityBadge} ${getSeverityClass(finding.severity)}`}>
                      {finding.severity}
                    </span>
                    <span className={styles.findingCategory}>{finding.category}</span>
                  </div>
                  <div className={styles.findingDetails}>
                    <span className={styles.findingTitle}>{finding.title}</span>
                    <span className={styles.findingFile}>
                      {finding.file}{finding.line ? `:${finding.line}` : ''}
                    </span>
                    <p className={styles.findingDescription}>{finding.description}</p>
                    {finding.code && (
                      <pre className={styles.findingCode}>{finding.code}</pre>
                    )}
                    <div className={styles.findingSuggestion}>
                      <strong>Fix:</strong> {finding.suggestion}
                    </div>
                    {finding.references && finding.references.length > 0 && (
                      <div className={styles.findingRefs}>
                        {finding.references.map((ref, i) => (
                          <span key={i} className={styles.refBadge}>{ref}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button
                className={styles.fixButton}
                onClick={fixSelectedSecurityIssues}
                disabled={selectedSecurityFindings.size === 0 || isLoading}
              >
                {isFixingSecurityIssues ? (
                  <>
                    <RefreshCw size={16} className={styles.spinner} />
                    Fixing...
                  </>
                ) : (
                  <>
                    <Shield size={16} />
                    Fix Selected Issues ({selectedSecurityFindings.size})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {depAuditResult && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Package size={14} />
            <span>Dependency Audit</span>
            <span className={styles.scanScope}>({depAuditResult.packageManager})</span>
            <span className={styles.auditSummary}>
              {depAuditResult.summary.critical > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityCritical}`}>
                  {depAuditResult.summary.critical} critical
                </span>
              )}
              {depAuditResult.summary.high > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityHigh}`}>
                  {depAuditResult.summary.high} high
                </span>
              )}
              {depAuditResult.summary.outdated > 0 && (
                <span className={`${styles.severityBadge} ${styles.severityMedium}`}>
                  {depAuditResult.summary.outdated} outdated
                </span>
              )}
            </span>
            <button
              className={styles.dismissBtn}
              onClick={clearDepAudit}
              title="Clear results"
            >
              <X size={12} />
            </button>
          </div>

          {depAuditResult.error ? (
            <div className={styles.scanError}>
              <AlertTriangle size={14} />
              <span>{depAuditResult.error}</span>
            </div>
          ) : depAuditResult.vulnerabilities.length === 0 && depAuditResult.outdatedPackages.length === 0 ? (
            <div className={styles.scanSuccess}>
              <Check size={14} />
              <span>No vulnerabilities found in {depAuditResult.totalDependencies} dependencies</span>
            </div>
          ) : (
            <div className={styles.depAuditSection}>
              {/* Selection controls */}
              <div className={styles.selectionControls}>
                <button
                  className={styles.selectAllBtn}
                  onClick={selectAllDepIssues}
                  disabled={isFixingDepIssues}
                >
                  Select All
                </button>
                <button
                  className={styles.deselectAllBtn}
                  onClick={deselectAllDepIssues}
                  disabled={isFixingDepIssues}
                >
                  Deselect All
                </button>
                <span className={styles.selectedCount}>
                  {selectedDepVulnerabilities.size + selectedOutdatedPackages.size} selected
                </span>
              </div>

              {isFixingDepIssues && depFixProgress && (
                <div className={styles.fixProgress}>
                  <RefreshCw size={14} className={styles.spinner} />
                  {depFixProgress}
                </div>
              )}

              {depAuditResult.vulnerabilities.length > 0 && (
                <>
                  <div className={styles.depAuditSubheader}>Vulnerabilities</div>
                  {depAuditResult.vulnerabilities.map((vuln: DependencyVulnerability) => (
                    <div key={vuln.id} className={`${styles.vulnItem} ${selectedDepVulnerabilities.has(vuln.id) ? styles.selected : ''}`}>
                      <input
                        type="checkbox"
                        className={styles.findingCheckbox}
                        checked={selectedDepVulnerabilities.has(vuln.id)}
                        onChange={() => toggleDepVulnerabilitySelection(vuln.id)}
                        disabled={isFixingDepIssues}
                      />
                      <span className={`${styles.severityBadge} ${getSeverityClass(vuln.severity)}`}>
                        {vuln.severity}
                      </span>
                      <div className={styles.vulnDetails}>
                        <span className={styles.vulnPackage}>
                          {vuln.packageName}@{vuln.currentVersion}
                        </span>
                        {vuln.cveId && <span className={styles.vulnCve}>{vuln.cveId}</span>}
                        <span className={styles.vulnTitle}>{vuln.title}</span>
                        <p className={styles.vulnDescription}>{vuln.description}</p>
                        <div className={styles.vulnRecommendation}>
                          <strong>Recommendation:</strong> {vuln.recommendation}
                        </div>
                      </div>
                      {vuln.fixedInVersion && (
                        <span className={styles.fixBadge}>Fix: {vuln.fixedInVersion}</span>
                      )}
                    </div>
                  ))}
                </>
              )}
              {depAuditResult.outdatedPackages.length > 0 && (
                <>
                  <div className={styles.depAuditSubheader}>Outdated Packages</div>
                  {depAuditResult.outdatedPackages.map((pkg: OutdatedPackage, idx: number) => (
                    <div key={idx} className={`${styles.outdatedItem} ${pkg.hasSecurityImpact ? styles.securityImpact : ''} ${selectedOutdatedPackages.has(pkg.name) ? styles.selected : ''}`}>
                      <input
                        type="checkbox"
                        className={styles.findingCheckbox}
                        checked={selectedOutdatedPackages.has(pkg.name)}
                        onChange={() => toggleOutdatedPackageSelection(pkg.name)}
                        disabled={isFixingDepIssues}
                      />
                      <span className={`${styles.updateBadge} ${styles[`update${pkg.updateType.charAt(0).toUpperCase() + pkg.updateType.slice(1)}`]}`}>
                        {pkg.updateType}
                      </span>
                      <div className={styles.outdatedDetails}>
                        <span className={styles.outdatedPackage}>{pkg.name}</span>
                        <span className={styles.outdatedVersions}>
                          {pkg.currentVersion} → {pkg.latestVersion}
                        </span>
                      </div>
                      {pkg.hasSecurityImpact && (
                        <span className={styles.securityBadge}>Security Impact</span>
                      )}
                    </div>
                  ))}
                </>
              )}

              <button
                className={styles.fixButton}
                onClick={fixSelectedDepIssues}
                disabled={(selectedDepVulnerabilities.size + selectedOutdatedPackages.size) === 0 || isFixingDepIssues}
              >
                {isFixingDepIssues ? (
                  <>
                    <RefreshCw size={16} className={styles.spinner} />
                    Fixing...
                  </>
                ) : (
                  <>
                    <Package size={16} />
                    Fix Selected Issues ({selectedDepVulnerabilities.size + selectedOutdatedPackages.size})
                  </>
                )}
              </button>
            </div>
          )}
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
