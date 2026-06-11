import { create } from 'zustand';
import { git, GitFileStatus } from '../services/tauri';
import { useWorkspaceStore } from './workspaceStore';
import { useAIStore } from './aiStore';

export interface PendingChange {
  path: string;
  status: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface TestFile {
  id: string;
  path: string;
  description: string;
  testCount: number;
  selected: boolean;
  creationStatus?: 'pending' | 'created' | 'skipped' | 'error';
  creationMessage?: string;
}

export interface TestCategory {
  id: string;
  name: string;
  testFiles: TestFile[];
  expanded: boolean;
}

export interface TestPlan {
  categories: TestCategory[];
  totalTests: number;
  lastUpdated?: number;
}

export interface CVEEntry {
  id: string;
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  fixAvailable: boolean;
}

export interface DependencyAudit {
  cves: CVEEntry[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export interface SnykVulnerability {
  id: string;
  title: string;
  severity: string;
  packageName: string;
  version: string;
  fixedIn: string | null;
  description: string;
  cvssScore: number | null;
  exploitMaturity: string | null;
  url: string | null;
}

export interface SnykSummary {
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export interface SnykScanResult {
  ok: boolean;
  vulnerabilities: SnykVulnerability[];
  summary: SnykSummary;
  error: string | null;
  projectName: string | null;
}

export interface SecurityFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  description: string;
  file: string;
  line?: number;
  code?: string;
  suggestion: string;
  references?: string[];
}

export interface SecurityScanResult {
  findings: SecurityFinding[];
  summary: { critical: number; high: number; medium: number; low: number; info: number };
  scannedFiles: number;
  scanScope: 'changes' | 'codebase';
  error?: string;
}

export interface DependencyVulnerability {
  id: string;
  packageName: string;
  currentVersion: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cveId?: string;
  title: string;
  description: string;
  fixedInVersion?: string;
  recommendation: string;
  references?: string[];
}

export interface OutdatedPackage {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateType: 'major' | 'minor' | 'patch';
  hasSecurityImpact: boolean;
}

export interface DepAuditResult {
  vulnerabilities: DependencyVulnerability[];
  outdatedPackages: OutdatedPackage[];
  summary: { critical: number; high: number; medium: number; low: number; outdated: number };
  packageManager: string;
  totalDependencies: number;
  error?: string;
}

const parseAttributes = (attrs: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(attrs)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
};

const parseTestPlan = (content: string): TestPlan | null => {
  // Try to find test_plan block first
  const planMatch = content.match(/<test_plan\b[^>]*>([\s\S]*?)<\/test_plan>/i);
  const planContent = planMatch ? planMatch[1] : content;

  const categories: TestCategory[] = [];
  let totalTests = 0;

  // Strategy 1: Parse <category name="..."><test_file path="..."> format
  const categoryRegex = /<category\s+name="([^"]+)">([\s\S]*?)<\/category>/gi;
  let categoryMatch;

  while ((categoryMatch = categoryRegex.exec(planContent)) !== null) {
    const categoryName = categoryMatch[1].trim();
    const categoryBody = categoryMatch[2];
    const testFiles: TestFile[] = [];
    const fileRegex = /<test_file\s+path="([^"]+)"(?:\s+tests="(\d+)")?\s*>([\s\S]*?)<\/test_file>/gi;
    let fileMatch;

    while ((fileMatch = fileRegex.exec(categoryBody)) !== null) {
      const path = fileMatch[1].trim();
      const testCount = Math.max(1, parseInt(fileMatch[2] || '1', 10));
      const description = fileMatch[3].trim() || 'Test coverage for updated behavior.';
      const id = `${path}:${testFiles.length}`;
      totalTests += testCount;
      testFiles.push({ id, path, description, testCount, selected: false });
    }

    if (testFiles.length > 0) {
      categories.push({
        id: `${categoryName}:${categories.length}`,
        name: categoryName,
        testFiles,
        expanded: categories.length === 0,
      });
    }
  }

  if (categories.length > 0) {
    return { categories, totalTests };
  }

  // Strategy 2: Parse <test_case> or <test> blocks
  const testCaseRegex = /<(?:test_case|test)\s+([^>]*)>([\s\S]*?)<\/(?:test_case|test)>/gi;
  const unitTests: TestFile[] = [];
  const integrationTests: TestFile[] = [];
  const securityTests: TestFile[] = [];
  let testMatch;

  while ((testMatch = testCaseRegex.exec(planContent)) !== null) {
    const attrs = parseAttributes(testMatch[1]);
    const body = testMatch[2].trim();
    const name = attrs.name || attrs.title || body.split('\n')[0].slice(0, 50);
    const type = (attrs.type || attrs.category || 'unit').toLowerCase();
    const path = attrs.path || attrs.file || `src/test/${name.replace(/[^a-zA-Z0-9]/g, '_')}.test.ts`;
    
    const file: TestFile = {
      id: `${path}:${totalTests}`,
      path,
      description: name,
      testCount: 1,
      selected: false,
    };
    totalTests++;

    if (type.includes('integration')) {
      integrationTests.push(file);
    } else if (type.includes('security')) {
      securityTests.push(file);
    } else {
      unitTests.push(file);
    }
  }

  // Strategy 3: Look for file paths in the content (*.test.*, *_test.*, test_*.*)
  if (unitTests.length === 0 && integrationTests.length === 0 && securityTests.length === 0) {
    const pathRegex = /(?:^|\s|["'`])([a-zA-Z0-9_\-./]+(?:\.test\.[a-z]+|_test\.[a-z]+|test_[a-zA-Z0-9_]+\.[a-z]+|Test\.[a-z]+))/gm;
    const foundPaths = new Set<string>();
    let pathMatch;

    while ((pathMatch = pathRegex.exec(planContent)) !== null) {
      const path = pathMatch[1].trim();
      if (path && !foundPaths.has(path)) {
        foundPaths.add(path);
        unitTests.push({
          id: `${path}:${totalTests}`,
          path,
          description: `Test file for ${path.split('/').pop()}`,
          testCount: 1,
          selected: false,
        });
        totalTests++;
      }
    }
  }

  // Strategy 4: Extract numbered test items from markdown-style lists
  if (unitTests.length === 0 && integrationTests.length === 0 && securityTests.length === 0) {
    const listItemRegex = /(?:^|\n)\s*[-*•]\s*\*?\*?(.+?)\*?\*?\s*(?:[-–:]\s*)?(.+)?/g;
    let listMatch;
    let itemCount = 0;

    while ((listMatch = listItemRegex.exec(planContent)) !== null && itemCount < 20) {
      const title = listMatch[1].trim();
      const desc = listMatch[2]?.trim() || '';
      
      // Skip if it looks like a section header or description
      if (title.length < 5 || title.length > 100) continue;
      if (/^(description|summary|overview|note|warning)/i.test(title)) continue;
      
      const safeName = title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
      const path = `src/test/${safeName}.test.ts`;
      
      unitTests.push({
        id: `${path}:${totalTests}`,
        path,
        description: desc || title,
        testCount: 1,
        selected: false,
      });
      totalTests++;
      itemCount++;
    }
  }

  // Build categories from collected tests
  if (unitTests.length > 0) {
    categories.push({
      id: 'unit:0',
      name: 'Unit Tests',
      testFiles: unitTests,
      expanded: true,
    });
  }
  if (integrationTests.length > 0) {
    categories.push({
      id: 'integration:1',
      name: 'Integration Tests',
      testFiles: integrationTests,
      expanded: false,
    });
  }
  if (securityTests.length > 0) {
    categories.push({
      id: 'security:2',
      name: 'Security Tests',
      testFiles: securityTests,
      expanded: false,
    });
  }

  if (categories.length === 0) return null;

  return { categories, totalTests };
};

const parseDependencyAudit = (content: string): DependencyAudit | null => {
  const auditMatch = content.match(/<dependency_audit\b[^>]*>([\s\S]*?)<\/dependency_audit>/i);
  if (!auditMatch) return null;

  const auditContent = auditMatch[1];
  const cves: CVEEntry[] = [];
  const cveRegex = /<cve\s+([^>]+)>([\s\S]*?)<\/cve>/gi;
  let cveMatch;

  while ((cveMatch = cveRegex.exec(auditContent)) !== null) {
    const attrs = parseAttributes(cveMatch[1]);
    const severityValue = (attrs.severity || 'low').toLowerCase();
    const severity: CVEEntry['severity'] =
      severityValue === 'critical' || severityValue === 'high' || severityValue === 'medium'
        ? severityValue
        : 'low';
    cves.push({
      id: attrs.id || 'unknown',
      package: attrs.package || 'unknown',
      version: attrs.version || 'unknown',
      severity,
      description: cveMatch[2].trim(),
      fixAvailable: attrs.fix_available === 'true',
    });
  }

  const counts = cves.reduce(
    (acc, cve) => {
      acc[cve.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  return {
    cves,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
  };
};

const decodeXmlEntities = (content: string): string => {
  return content
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
};

interface TestState {
  pendingChanges: PendingChange[];
  testPlan: TestPlan | null;
  selectedTests: Set<string>;
  dependencyAudit: DependencyAudit | null;
  isAnalyzing: boolean;
  isCreatingTests: boolean;
  isFetchingChanges: boolean;
  customInstructions: string;
  error: string | null;
  lastFetchedAt: string | null;
  analysisProgress: string;
  creationProgress: string;
  creationSummary: { created: number; skipped: number; errors: number } | null;
  // Snyk
  snykResult: SnykScanResult | null;
  isScanningSnyk: boolean;
  // Security Scan
  securityScanResult: SecurityScanResult | null;
  isSecurityScanning: boolean;
  securityScanProgress: string;
  selectedSecurityFindings: Set<string>;
  isFixingSecurityIssues: boolean;
  securityFixProgress: string;
  // Dep Audit
  depAuditResult: DepAuditResult | null;
  isAuditingDeps: boolean;
  depAuditProgress: string;
  selectedDepVulnerabilities: Set<string>;
  selectedOutdatedPackages: Set<string>;
  isFixingDepIssues: boolean;
  depFixProgress: string;

  fetchPendingChanges: () => Promise<void>;
  analyzeChanges: (instructions?: string, focusType?: 'unit' | 'security' | 'audit') => Promise<void>;
  setCustomInstructions: (text: string) => void;
  toggleTestSelection: (testId: string) => void;
  selectAllTests: () => void;
  deselectAllTests: () => void;
  toggleCategoryExpanded: (categoryId: string) => void;
  createSelectedTests: () => Promise<void>;
  clearTestPlan: () => void;
  setError: (error: string | null) => void;
  updateTestFileStatus: (fileId: string, status: TestFile['creationStatus'], message?: string) => void;
  // Snyk
  runSnykScan: () => Promise<void>;
  clearSnykResult: () => void;
  // Security Scan
  runSecurityScan: (scope: 'changes' | 'codebase') => Promise<void>;
  clearSecurityScan: () => void;
  toggleSecurityFindingSelection: (id: string) => void;
  selectAllSecurityFindings: () => void;
  deselectAllSecurityFindings: () => void;
  fixSelectedSecurityIssues: () => Promise<void>;
  // Dep Audit
  runDepAudit: () => Promise<void>;
  clearDepAudit: () => void;
  toggleDepVulnerabilitySelection: (id: string) => void;
  toggleOutdatedPackageSelection: (name: string) => void;
  selectAllDepIssues: () => void;
  deselectAllDepIssues: () => void;
  fixSelectedDepIssues: () => Promise<void>;
}

const waitForStreamingComplete = (): Promise<string> => {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const aiState = useAIStore.getState();
      if (!aiState.isStreaming) {
        clearInterval(checkInterval);
        const conversation = aiState.activeConversation;
        const messages = conversation?.messages ?? [];
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        resolve(lastAssistant?.content ?? '');
      }
    }, 500);
    
    setTimeout(() => {
      clearInterval(checkInterval);
      const aiState = useAIStore.getState();
      const conversation = aiState.activeConversation;
      const messages = conversation?.messages ?? [];
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      resolve(lastAssistant?.content ?? '');
    }, 120000);
  });
};

export const useTestStore = create<TestState>((set, get) => ({
  pendingChanges: [],
  testPlan: null,
  selectedTests: new Set(),
  dependencyAudit: null,
  isAnalyzing: false,
  isCreatingTests: false,
  isFetchingChanges: false,
  customInstructions: '',
  error: null,
  lastFetchedAt: null,
  analysisProgress: '',
  creationProgress: '',
  creationSummary: null,
  snykResult: null,
  isScanningSnyk: false,
  securityScanResult: null,
  isSecurityScanning: false,
  securityScanProgress: '',
  selectedSecurityFindings: new Set(),
  isFixingSecurityIssues: false,
  securityFixProgress: '',
  depAuditResult: null,
  isAuditingDeps: false,
  depAuditProgress: '',
  selectedDepVulnerabilities: new Set(),
  selectedOutdatedPackages: new Set(),
  isFixingDepIssues: false,
  depFixProgress: '',

  fetchPendingChanges: async () => {
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    set({ isFetchingChanges: true, error: null });

    try {
      const status = await git.status(workspace.rootPath);
      
      const changes: PendingChange[] = [];
      
      status.staged.forEach((file: GitFileStatus) => {
        changes.push({
          path: file.path,
          status: file.status,
          staged: true,
        });
      });
      
      status.unstaged.forEach((file: GitFileStatus) => {
        const existing = changes.find(c => c.path === file.path);
        if (!existing) {
          changes.push({
            path: file.path,
            status: file.status,
            staged: false,
          });
        }
      });
      
      status.untracked.forEach((file: GitFileStatus) => {
        changes.push({
          path: file.path,
          status: 'untracked',
          staged: false,
        });
      });

      set({ 
        pendingChanges: changes, 
        isFetchingChanges: false,
        lastFetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      set({ 
        error: `Failed to fetch changes: ${error}`,
        isFetchingChanges: false,
      });
    }
  },

  analyzeChanges: async (instructions?: string, focusType?: 'unit' | 'security' | 'audit') => {
    const { pendingChanges } = get();
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    if (pendingChanges.length === 0) {
      set({ error: 'No pending changes to analyze' });
      return;
    }

    set({
      isAnalyzing: true,
      error: null,
      testPlan: null,
      dependencyAudit: null,
      selectedTests: new Set(),
      analysisProgress: 'Preparing analysis request...',
    });

    try {
      const aiStore = useAIStore.getState();

      aiStore.setAgentMode('test');

      let prompt = `Analyze the following pending changes and generate a test plan:\n\n`;
      prompt += `**Changed Files:**\n`;
      pendingChanges.forEach(change => {
        prompt += `- ${change.path} (${change.status}${change.staged ? ', staged' : ''})\n`;
      });
      
      if (focusType) {
        prompt += `\n**Focus:** ${focusType === 'unit' ? 'Unit Tests' : focusType === 'security' ? 'Security Tests' : 'Dependency Audit'}\n`;
      }
      
      if (instructions) {
        prompt += `\n**Additional Instructions:** ${instructions}\n`;
      }
      
      prompt += `\nPlease generate a structured test plan with <test_plan> tags.`;
      
      set({ analysisProgress: 'Sending request to AI...' });
      aiStore.sendMessage(prompt);

      set({ analysisProgress: 'AI is analyzing changes...' });
      const responseContent = await waitForStreamingComplete();

      set({ analysisProgress: 'Parsing test plan...' });
      const decodedContent = decodeXmlEntities(responseContent);
      const parsedPlan = parseTestPlan(responseContent) || parseTestPlan(decodedContent);
      const parsedAudit = parseDependencyAudit(responseContent) || parseDependencyAudit(decodedContent);

      if (!parsedPlan) {
        set({ analysisProgress: 'Retrying - asking AI for correct format...' });
        const retryPrompt = [
          'Your last response did not include the required <test_plan> XML.',
          'Return ONLY the <test_plan> block and optional <dependency_audit> block in the exact XML format.',
          'Do not include any extra text or code fences.',
        ].join('\n');
        useAIStore.getState().sendMessage(retryPrompt);

        set({ analysisProgress: 'Waiting for retry response...' });
        const retryContent = await waitForStreamingComplete();
        const retryDecoded = decodeXmlEntities(retryContent);
        const retryPlan = parseTestPlan(retryContent) || parseTestPlan(retryDecoded);
        const retryAudit = parseDependencyAudit(retryContent) || parseDependencyAudit(retryDecoded);

        if (!retryPlan) {
          set({
            isAnalyzing: false,
            analysisProgress: '',
            dependencyAudit: retryAudit ?? parsedAudit,
            error: 'No test plan found in the response. Try running analysis again.',
          });
          return;
        }

        set({
          testPlan: retryPlan,
          dependencyAudit: retryAudit ?? parsedAudit,
          isAnalyzing: false,
          analysisProgress: '',
        });
        return;
      }

      set({
        testPlan: parsedPlan,
        dependencyAudit: parsedAudit,
        isAnalyzing: false,
        analysisProgress: '',
      });
    } catch (error) {
      set({ 
        error: `Analysis failed: ${error}`,
        isAnalyzing: false,
        analysisProgress: '',
      });
    }
  },

  setCustomInstructions: (text: string) => {
    set({ customInstructions: text });
  },

  toggleTestSelection: (testId: string) => {
    set(state => {
      const newSelected = new Set(state.selectedTests);
      if (newSelected.has(testId)) {
        newSelected.delete(testId);
      } else {
        newSelected.add(testId);
      }
      return { selectedTests: newSelected };
    });
  },

  selectAllTests: () => {
    const { testPlan } = get();
    if (!testPlan) return;

    const allTestIds = new Set<string>();
    testPlan.categories.forEach(cat => {
      cat.testFiles.forEach(file => {
        allTestIds.add(file.id);
      });
    });
    set({ selectedTests: allTestIds });
  },

  deselectAllTests: () => {
    set({ selectedTests: new Set() });
  },

  toggleCategoryExpanded: (categoryId: string) => {
    set(state => {
      if (!state.testPlan) return state;
      
      const newCategories = state.testPlan.categories.map(cat => 
        cat.id === categoryId ? { ...cat, expanded: !cat.expanded } : cat
      );
      
      return {
        testPlan: {
          ...state.testPlan,
          categories: newCategories,
          lastUpdated: Date.now(),
        },
      };
    });
  },

  createSelectedTests: async () => {
    const { selectedTests, testPlan } = get();
    
    if (selectedTests.size === 0) {
      set({ error: 'No tests selected' });
      return;
    }

    if (!testPlan) {
      set({ error: 'No test plan available' });
      return;
    }

    // Collect all selected files
    const selectedFilesList: { id: string; path: string; description: string }[] = [];
    testPlan.categories.forEach(cat => {
      cat.testFiles.forEach(file => {
        if (selectedTests.has(file.id)) {
          selectedFilesList.push({ id: file.id, path: file.path, description: file.description });
        }
      });
    });

    // Batch size - AI can reliably generate ~5 files at a time
    const BATCH_SIZE = 5;
    const batches: typeof selectedFilesList[] = [];
    for (let i = 0; i < selectedFilesList.length; i += BATCH_SIZE) {
      batches.push(selectedFilesList.slice(i, i + BATCH_SIZE));
    }

    // Mark all selected tests as pending
    set(state => {
      if (!state.testPlan) return state;
      const newCategories = state.testPlan.categories.map(cat => ({
        ...cat,
        testFiles: cat.testFiles.map(file => ({
          ...file,
          creationStatus: selectedTests.has(file.id) ? 'pending' as const : file.creationStatus,
          creationMessage: selectedTests.has(file.id) ? 'Waiting to be created...' : file.creationMessage,
        })),
      }));
      return {
        testPlan: { ...state.testPlan, categories: newCategories, lastUpdated: Date.now() },
        isCreatingTests: true,
        creationProgress: batches.length > 1 
          ? `Creating ${selectedFilesList.length} files in ${batches.length} batches...`
          : `Creating ${selectedFilesList.length} test file(s)...`,
        creationSummary: null,
      };
    });

    const aiStore = useAIStore.getState();
    const allCreatedPaths = new Set<string>();
    let totalCreated = 0;
    let totalSkipped = 0;

    // Process each batch
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchIds = new Set(batch.map(f => f.id));

      set({ 
        creationProgress: batches.length > 1 
          ? `Batch ${batchIdx + 1}/${batches.length}: Creating ${batch.length} files...`
          : `Creating ${batch.length} test file(s)...`
      });

      // Mark this batch as in-progress
      set(state => {
        if (!state.testPlan) return state;
        const newCategories = state.testPlan.categories.map(cat => ({
          ...cat,
          testFiles: cat.testFiles.map(file => ({
            ...file,
            creationMessage: batchIds.has(file.id) ? 'Creating...' : file.creationMessage,
          })),
        }));
        return { testPlan: { ...state.testPlan, categories: newCategories, lastUpdated: Date.now() } };
      });

      const prompt = `Please create the following test files. For each file, use a <create_file path="..."> tag:\n\n${batch.map(f => `- ${f.path}: ${f.description}`).join('\n')}\n\nGenerate the complete test code for each file. Use <create_file path="PATH">CODE</create_file> for each one.`;
      
      aiStore.sendMessage(prompt);
      
      // Wait for streaming to complete
      const responseContent = await waitForStreamingComplete();
      
      // Parse which files were created from the response
      const createdPaths = new Set<string>();
      const createFileRegex = /<create_file\s+path="([^"]+)"/gi;
      let match;
      while ((match = createFileRegex.exec(responseContent)) !== null) {
        createdPaths.add(match[1]);
        allCreatedPaths.add(match[1]);
      }

      // Update status for files in this batch
      let batchCreated = 0;
      let batchSkipped = 0;

      set(state => {
        if (!state.testPlan) return state;
        const newCategories = state.testPlan.categories.map(cat => ({
          ...cat,
          testFiles: cat.testFiles.map(file => {
            if (!batchIds.has(file.id)) return file;
            
            const fileName = file.path.split('/').pop() || '';
            const wasCreated = createdPaths.has(file.path) || 
              [...createdPaths].some(p => {
                const createdFileName = p.split('/').pop() || '';
                return p.includes(fileName) || createdFileName.includes(fileName.replace('.test.ts', ''));
              });
            
            if (wasCreated) {
              batchCreated++;
              return {
                ...file,
                creationStatus: 'created' as const,
                creationMessage: 'File created successfully',
              };
            } else {
              batchSkipped++;
              return {
                ...file,
                creationStatus: 'skipped' as const,
                creationMessage: createdPaths.size === 0 
                  ? 'AI did not generate this file'
                  : `AI created ${createdPaths.size}/${batch.length} files in this batch`,
              };
            }
          }),
        }));
        return { testPlan: { ...state.testPlan, categories: newCategories, lastUpdated: Date.now() } };
      });

      totalCreated += batchCreated;
      totalSkipped += batchSkipped;

      // Small delay between batches to avoid rate limiting
      if (batchIdx < batches.length - 1) {
        set({ creationProgress: `Batch ${batchIdx + 1} complete. Starting batch ${batchIdx + 2}...` });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Final summary
    set({
      isCreatingTests: false,
      creationProgress: '',
      creationSummary: { created: totalCreated, skipped: totalSkipped, errors: 0 },
    });
  },

  updateTestFileStatus: (fileId: string, status: TestFile['creationStatus'], message?: string) => {
    set(state => {
      if (!state.testPlan) return state;
      const newCategories = state.testPlan.categories.map(cat => ({
        ...cat,
        testFiles: cat.testFiles.map(file => 
          file.id === fileId
            ? { ...file, creationStatus: status, creationMessage: message }
            : file
        ),
      }));
      return { testPlan: { ...state.testPlan, categories: newCategories, lastUpdated: Date.now() } };
    });
  },

  clearTestPlan: () => {
    set({ 
      testPlan: null, 
      selectedTests: new Set(),
      dependencyAudit: null,
    });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  runSnykScan: async () => {
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    set({ isScanningSnyk: true, error: null, snykResult: null });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { useSettingsStore } = await import('./settingsStore');
      const settings = useSettingsStore.getState();

      const result = await invoke<SnykScanResult>('snyk_scan', {
        workspacePath: workspace.rootPath,
        cliPath: settings.snykCliPath || undefined,
        authToken: settings.snykAuthToken || undefined,
      });

      set({ snykResult: result, isScanningSnyk: false });
    } catch (error) {
      set({
        error: `Snyk scan failed: ${error}`,
        isScanningSnyk: false,
        snykResult: {
          ok: false,
          vulnerabilities: [],
          summary: {
            totalVulnerabilities: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
          },
          error: String(error),
          projectName: null,
        },
      });
    }
  },

  clearSnykResult: () => {
    set({ snykResult: null });
  },

  runSecurityScan: async (scope: 'changes' | 'codebase') => {
    const { pendingChanges } = get();
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    if (scope === 'changes' && pendingChanges.length === 0) {
      set({ error: 'No pending changes to scan' });
      return;
    }

    set({
      isSecurityScanning: true,
      error: null,
      securityScanResult: null,
      securityScanProgress: 'Preparing security scan...',
    });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const aiStore = useAIStore.getState();
      
      let filesToScan: string[] = [];
      let fileContents: { path: string; content: string }[] = [];

      if (scope === 'changes') {
        filesToScan = pendingChanges
          .filter(c => c.status !== 'deleted')
          .map(c => c.path);
      } else {
        set({ securityScanProgress: 'Gathering source files...' });
        const result = await invoke<{ path: string }[]>('read_directory', {
          path: workspace.rootPath,
        });
        
        const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.rb', '.php'];
        const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'vendor'];
        
        filesToScan = result
          .map(f => f.path)
          .filter(p => {
            const isSourceFile = sourceExtensions.some(ext => p.endsWith(ext));
            const isExcluded = excludeDirs.some(dir => p.includes(`/${dir}/`) || p.includes(`\\${dir}\\`));
            return isSourceFile && !isExcluded;
          })
          .slice(0, 50);
      }

      set({ securityScanProgress: `Reading ${filesToScan.length} files...` });

      for (const filePath of filesToScan) {
        try {
          const fullPath = filePath.startsWith('/') ? filePath : `${workspace.rootPath}/${filePath}`;
          const content = await invoke<string>('read_file', { path: fullPath });
          if (content && content.length < 50000) {
            fileContents.push({ path: filePath, content });
          }
        } catch {
          // Skip files that can't be read
        }
      }

      if (fileContents.length === 0) {
        set({
          isSecurityScanning: false,
          securityScanProgress: '',
          error: 'No readable source files found to scan',
        });
        return;
      }

      set({ securityScanProgress: 'AI is analyzing for security vulnerabilities...' });

      const prompt = `You are a security expert. Analyze the following code files for security vulnerabilities.

Look for:
- SQL Injection vulnerabilities
- Cross-Site Scripting (XSS)
- Hardcoded secrets, API keys, passwords
- Path traversal vulnerabilities
- Command injection
- Insecure deserialization
- Authentication/authorization issues
- Sensitive data exposure
- CSRF vulnerabilities
- Security misconfigurations

FILES TO ANALYZE:
${fileContents.map(f => `
=== ${f.path} ===
${f.content.slice(0, 10000)}
${f.content.length > 10000 ? '\n... (truncated)' : ''}
`).join('\n')}

Return your findings in this EXACT XML format (no markdown code fences):
<security_scan>
  <finding severity="critical|high|medium|low|info" category="Category Name">
    <file>path/to/file.ts</file>
    <line>42</line>
    <title>Brief title of the issue</title>
    <description>Detailed description of the vulnerability</description>
    <code>The vulnerable code snippet</code>
    <suggestion>How to fix this vulnerability</suggestion>
    <references>CWE-xxx, OWASP link</references>
  </finding>
</security_scan>

If no vulnerabilities are found, return:
<security_scan></security_scan>`;

      aiStore.sendMessage(prompt);
      const responseContent = await waitForStreamingComplete();

      set({ securityScanProgress: 'Parsing results...' });
      const findings = parseSecurityScanResult(responseContent);

      set({
        isSecurityScanning: false,
        securityScanProgress: '',
        securityScanResult: {
          findings,
          summary: {
            critical: findings.filter(f => f.severity === 'critical').length,
            high: findings.filter(f => f.severity === 'high').length,
            medium: findings.filter(f => f.severity === 'medium').length,
            low: findings.filter(f => f.severity === 'low').length,
            info: findings.filter(f => f.severity === 'info').length,
          },
          scannedFiles: fileContents.length,
          scanScope: scope,
        },
      });
    } catch (error) {
      set({
        error: `Security scan failed: ${error}`,
        isSecurityScanning: false,
        securityScanProgress: '',
      });
    }
  },

  clearSecurityScan: () => {
    set({ securityScanResult: null, selectedSecurityFindings: new Set() });
  },

  toggleSecurityFindingSelection: (id: string) => {
    set(state => {
      const newSelected = new Set(state.selectedSecurityFindings);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedSecurityFindings: newSelected };
    });
  },

  selectAllSecurityFindings: () => {
    const { securityScanResult } = get();
    if (!securityScanResult) return;
    const allIds = new Set(securityScanResult.findings.map(f => f.id));
    set({ selectedSecurityFindings: allIds });
  },

  deselectAllSecurityFindings: () => {
    set({ selectedSecurityFindings: new Set() });
  },

  fixSelectedSecurityIssues: async () => {
    const { selectedSecurityFindings, securityScanResult } = get();
    const workspace = useWorkspaceStore.getState().currentWorkspace;

    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    if (selectedSecurityFindings.size === 0) {
      set({ error: 'No security issues selected' });
      return;
    }

    if (!securityScanResult) {
      set({ error: 'No security scan results available' });
      return;
    }

    const selectedFindings = securityScanResult.findings.filter(f => 
      selectedSecurityFindings.has(f.id)
    );

    set({
      isFixingSecurityIssues: true,
      error: null,
      securityFixProgress: 'Preparing fixes...',
    });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const aiStore = useAIStore.getState();

      const fileContents: Map<string, string> = new Map();
      const uniqueFiles = [...new Set(selectedFindings.map(f => f.file))];

      set({ securityFixProgress: `Reading ${uniqueFiles.length} files...` });

      for (const filePath of uniqueFiles) {
        try {
          const fullPath = filePath.startsWith('/') ? filePath : `${workspace.rootPath}/${filePath}`;
          const content = await invoke<string>('read_file', { path: fullPath });
          fileContents.set(filePath, content);
        } catch {
          // Skip files that can't be read
        }
      }

      set({ securityFixProgress: 'AI is generating fixes...' });

      const prompt = `You are a security expert. Fix the following security vulnerabilities in the code.

SECURITY ISSUES TO FIX:
${selectedFindings.map(f => `
Issue: ${f.title}
Category: ${f.category}
Severity: ${f.severity}
File: ${f.file}${f.line ? `:${f.line}` : ''}
Description: ${f.description}
${f.code ? `Vulnerable Code:\n${f.code}` : ''}
Suggested Fix: ${f.suggestion}
`).join('\n---\n')}

CURRENT FILE CONTENTS:
${[...fileContents.entries()].map(([path, content]) => `
=== ${path} ===
${content}
`).join('\n')}

For each file that needs to be modified, provide the fix using this EXACT format:
<fix file="path/to/file.ts">
<original>
The exact original code to replace (copy exactly from the file)
</original>
<replacement>
The fixed code that should replace the original
</replacement>
</fix>

Make sure to:
1. Copy the original code EXACTLY as it appears in the file
2. Provide complete, working replacement code
3. Fix all the security issues in each file
4. Maintain proper indentation and formatting`;

      aiStore.sendMessage(prompt);
      const responseContent = await waitForStreamingComplete();

      set({ securityFixProgress: 'Applying fixes...' });

      const fixes = parseFixes(responseContent);
      let appliedCount = 0;
      let failedCount = 0;

      for (const fix of fixes) {
        try {
          const fullPath = fix.file.startsWith('/') ? fix.file : `${workspace.rootPath}/${fix.file}`;
          const currentContent = await invoke<string>('read_file', { path: fullPath });
          
          if (currentContent.includes(fix.original)) {
            const newContent = currentContent.replace(fix.original, fix.replacement);
            await invoke('write_file', { path: fullPath, content: newContent });
            appliedCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
      }

      set({
        isFixingSecurityIssues: false,
        securityFixProgress: '',
        selectedSecurityFindings: new Set(),
      });

      if (appliedCount > 0) {
        set({ error: null });
        const { runSecurityScan, securityScanResult } = get();
        if (securityScanResult) {
          runSecurityScan(securityScanResult.scanScope);
        }
      }

      if (failedCount > 0) {
        set({ error: `Applied ${appliedCount} fixes, ${failedCount} could not be applied automatically` });
      }
    } catch (error) {
      set({
        error: `Failed to fix security issues: ${error}`,
        isFixingSecurityIssues: false,
        securityFixProgress: '',
      });
    }
  },

  runDepAudit: async () => {
    const workspace = useWorkspaceStore.getState().currentWorkspace;
    
    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    set({
      isAuditingDeps: true,
      error: null,
      depAuditResult: null,
      depAuditProgress: 'Detecting package manager...',
    });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const aiStore = useAIStore.getState();

      let packageManager = 'unknown';
      let manifestContent = '';
      let lockfileContent = '';

      const checkFile = async (path: string): Promise<string | null> => {
        try {
          return await invoke<string>('read_file', { path: `${workspace.rootPath}/${path}` });
        } catch {
          return null;
        }
      };

      const packageJson = await checkFile('package.json');
      if (packageJson) {
        packageManager = 'npm';
        manifestContent = packageJson;
        
        const packageLock = await checkFile('package-lock.json');
        const yarnLock = await checkFile('yarn.lock');
        const pnpmLock = await checkFile('pnpm-lock.yaml');
        
        if (yarnLock) {
          packageManager = 'yarn';
          lockfileContent = yarnLock.slice(0, 50000);
        } else if (pnpmLock) {
          packageManager = 'pnpm';
          lockfileContent = pnpmLock.slice(0, 50000);
        } else if (packageLock) {
          lockfileContent = packageLock.slice(0, 50000);
        }
      }

      const requirementsTxt = await checkFile('requirements.txt');
      if (requirementsTxt) {
        packageManager = 'pip';
        manifestContent = requirementsTxt;
        const pipfileLock = await checkFile('Pipfile.lock');
        if (pipfileLock) lockfileContent = pipfileLock.slice(0, 50000);
      }

      const cargoToml = await checkFile('Cargo.toml');
      if (cargoToml) {
        packageManager = 'cargo';
        manifestContent = cargoToml;
        const cargoLock = await checkFile('Cargo.lock');
        if (cargoLock) lockfileContent = cargoLock.slice(0, 50000);
      }

      const goMod = await checkFile('go.mod');
      if (goMod) {
        packageManager = 'go';
        manifestContent = goMod;
        const goSum = await checkFile('go.sum');
        if (goSum) lockfileContent = goSum.slice(0, 50000);
      }

      // Gradle (Java/Kotlin)
      const buildGradle = await checkFile('build.gradle');
      const buildGradleKts = await checkFile('build.gradle.kts');
      if (buildGradle || buildGradleKts) {
        packageManager = 'gradle';
        manifestContent = buildGradle || buildGradleKts || '';
        
        // Also check for settings.gradle
        const settingsGradle = await checkFile('settings.gradle') || await checkFile('settings.gradle.kts');
        if (settingsGradle) {
          manifestContent += '\n\n=== settings.gradle ===\n' + settingsGradle;
        }
        
        // Check gradle.lockfile if it exists
        const gradleLock = await checkFile('gradle.lockfile');
        if (gradleLock) lockfileContent = gradleLock.slice(0, 50000);
      }

      // Maven (Java)
      const pomXml = await checkFile('pom.xml');
      if (pomXml) {
        packageManager = 'maven';
        manifestContent = pomXml;
      }

      // Composer (PHP)
      const composerJson = await checkFile('composer.json');
      if (composerJson) {
        packageManager = 'composer';
        manifestContent = composerJson;
        const composerLock = await checkFile('composer.lock');
        if (composerLock) lockfileContent = composerLock.slice(0, 50000);
      }

      // Gemfile (Ruby)
      const gemfile = await checkFile('Gemfile');
      if (gemfile) {
        packageManager = 'bundler';
        manifestContent = gemfile;
        const gemfileLock = await checkFile('Gemfile.lock');
        if (gemfileLock) lockfileContent = gemfileLock.slice(0, 50000);
      }

      // pubspec.yaml (Dart/Flutter)
      const pubspec = await checkFile('pubspec.yaml');
      if (pubspec) {
        packageManager = 'pub';
        manifestContent = pubspec;
        const pubspecLock = await checkFile('pubspec.lock');
        if (pubspecLock) lockfileContent = pubspecLock.slice(0, 50000);
      }

      // sbt (Scala)
      const buildSbt = await checkFile('build.sbt');
      if (buildSbt) {
        packageManager = 'sbt';
        manifestContent = buildSbt;
        // Check for plugins.sbt
        const pluginsSbt = await checkFile('project/plugins.sbt');
        if (pluginsSbt) {
          manifestContent += '\n\n=== project/plugins.sbt ===\n' + pluginsSbt;
        }
        // Check for Dependencies.scala if using a dependencies object
        const dependenciesScala = await checkFile('project/Dependencies.scala');
        if (dependenciesScala) {
          manifestContent += '\n\n=== project/Dependencies.scala ===\n' + dependenciesScala;
        }
      }

      // CMake (C/C++)
      const cmakeLists = await checkFile('CMakeLists.txt');
      if (cmakeLists) {
        packageManager = 'cmake';
        manifestContent = cmakeLists;
        // Check for vcpkg.json (vcpkg package manager)
        const vcpkgJson = await checkFile('vcpkg.json');
        if (vcpkgJson) {
          manifestContent += '\n\n=== vcpkg.json ===\n' + vcpkgJson;
        }
      }

      // Conan (C/C++)
      const conanfile = await checkFile('conanfile.txt') || await checkFile('conanfile.py');
      if (conanfile) {
        packageManager = 'conan';
        manifestContent = conanfile;
        const conanLock = await checkFile('conan.lock');
        if (conanLock) lockfileContent = conanLock.slice(0, 50000);
      }

      // vcpkg standalone (C/C++)
      if (!manifestContent) {
        const vcpkgJson = await checkFile('vcpkg.json');
        if (vcpkgJson) {
          packageManager = 'vcpkg';
          manifestContent = vcpkgJson;
        }
      }

      // Meson (C/C++)
      const mesonBuild = await checkFile('meson.build');
      if (mesonBuild && !manifestContent) {
        packageManager = 'meson';
        manifestContent = mesonBuild;
        const wrapFiles = await checkFile('subprojects');
        // meson.build detected
      }

      // .NET (NuGet)
      const findCsprojContent = async (): Promise<string | null> => {
        // Check common .NET project files
        const extensions = ['.csproj', '.fsproj', '.vbproj'];
        for (const ext of extensions) {
          // Check root level common names
          const commonNames = ['App', 'Application', 'Project', 'Program'];
          for (const name of commonNames) {
            const content = await checkFile(`${name}${ext}`);
            if (content) return content;
          }
        }
        return null;
      };
      
      const packagesConfig = await checkFile('packages.config');
      const directoryPackagesProps = await checkFile('Directory.Packages.props');
      const csprojContent = await findCsprojContent();
      
      if (packagesConfig || directoryPackagesProps || csprojContent) {
        packageManager = 'nuget';
        manifestContent = '';
        if (csprojContent) {
          manifestContent += '=== .csproj ===\n' + csprojContent;
        }
        if (packagesConfig) {
          manifestContent += '\n\n=== packages.config ===\n' + packagesConfig;
        }
        if (directoryPackagesProps) {
          manifestContent += '\n\n=== Directory.Packages.props ===\n' + directoryPackagesProps;
        }
        const packagesLock = await checkFile('packages.lock.json');
        if (packagesLock) lockfileContent = packagesLock.slice(0, 50000);
      }

      // Makefile (C/C++ - basic detection, no package manager)
      if (!manifestContent) {
        const makefile = await checkFile('Makefile') || await checkFile('makefile');
        if (makefile) {
          packageManager = 'make';
          manifestContent = makefile;
        }
      }

      if (!manifestContent) {
        set({
          isAuditingDeps: false,
          depAuditProgress: '',
          error: 'No supported dependency file found. Supported: package.json, requirements.txt, Cargo.toml, go.mod, build.gradle, pom.xml, composer.json, Gemfile, pubspec.yaml, build.sbt, CMakeLists.txt, conanfile.txt, vcpkg.json, *.csproj, Makefile',
        });
        return;
      }

      set({ depAuditProgress: `Analyzing ${packageManager} dependencies...` });

      const prompt = `You are a security expert specializing in dependency analysis. Analyze the following ${packageManager} dependencies for known vulnerabilities and outdated packages.

DEPENDENCY MANIFEST (${packageManager}):
${manifestContent}

${lockfileContent ? `LOCKFILE CONTENT:
${lockfileContent}` : ''}

Analyze for:
1. Known CVEs and security vulnerabilities in these dependencies
2. Outdated packages that may have security implications
3. Dependencies with known security issues
4. Packages that should be updated for security reasons

Return your findings in this EXACT XML format (no markdown code fences):
<dep_audit package_manager="${packageManager}" total_dependencies="NUMBER">
  <vulnerability severity="critical|high|medium|low">
    <package>package-name</package>
    <version>1.0.0</version>
    <cve>CVE-2024-XXXXX</cve>
    <title>Brief vulnerability title</title>
    <description>Description of the vulnerability</description>
    <fixed_in>1.0.1</fixed_in>
    <recommendation>Update to version 1.0.1 or higher</recommendation>
  </vulnerability>
  <outdated update_type="major|minor|patch" has_security_impact="true|false">
    <package>package-name</package>
    <current>1.0.0</current>
    <latest>2.0.0</latest>
  </outdated>
</dep_audit>

If no issues are found, return:
<dep_audit package_manager="${packageManager}" total_dependencies="NUMBER"></dep_audit>`;

      aiStore.sendMessage(prompt);
      const responseContent = await waitForStreamingComplete();

      set({ depAuditProgress: 'Parsing results...' });
      const result = parseDepAuditResult(responseContent, packageManager);

      set({
        isAuditingDeps: false,
        depAuditProgress: '',
        depAuditResult: result,
      });
    } catch (error) {
      set({
        error: `Dependency audit failed: ${error}`,
        isAuditingDeps: false,
        depAuditProgress: '',
      });
    }
  },

  clearDepAudit: () => {
    set({ 
      depAuditResult: null,
      selectedDepVulnerabilities: new Set(),
      selectedOutdatedPackages: new Set(),
    });
  },

  toggleDepVulnerabilitySelection: (id: string) => {
    set(state => {
      const newSelected = new Set(state.selectedDepVulnerabilities);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedDepVulnerabilities: newSelected };
    });
  },

  toggleOutdatedPackageSelection: (name: string) => {
    set(state => {
      const newSelected = new Set(state.selectedOutdatedPackages);
      if (newSelected.has(name)) {
        newSelected.delete(name);
      } else {
        newSelected.add(name);
      }
      return { selectedOutdatedPackages: newSelected };
    });
  },

  selectAllDepIssues: () => {
    const { depAuditResult } = get();
    if (!depAuditResult) return;
    const vulnIds = new Set(depAuditResult.vulnerabilities.map(v => v.id));
    const outdatedNames = new Set(depAuditResult.outdatedPackages.map(p => p.name));
    set({ 
      selectedDepVulnerabilities: vulnIds,
      selectedOutdatedPackages: outdatedNames,
    });
  },

  deselectAllDepIssues: () => {
    set({ 
      selectedDepVulnerabilities: new Set(),
      selectedOutdatedPackages: new Set(),
    });
  },

  fixSelectedDepIssues: async () => {
    const { selectedDepVulnerabilities, selectedOutdatedPackages, depAuditResult } = get();
    const workspace = useWorkspaceStore.getState().currentWorkspace;

    if (!workspace?.rootPath) {
      set({ error: 'No workspace open' });
      return;
    }

    const totalSelected = selectedDepVulnerabilities.size + selectedOutdatedPackages.size;
    if (totalSelected === 0) {
      set({ error: 'No dependency issues selected' });
      return;
    }

    if (!depAuditResult) {
      set({ error: 'No audit results available' });
      return;
    }

    const selectedVulns = depAuditResult.vulnerabilities.filter(v =>
      selectedDepVulnerabilities.has(v.id)
    );
    const selectedOutdated = depAuditResult.outdatedPackages.filter(p =>
      selectedOutdatedPackages.has(p.name)
    );

    set({
      isFixingDepIssues: true,
      error: null,
      depFixProgress: `Generating fixes for ${totalSelected} issue(s)...`,
    });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const aiStore = useAIStore.getState();

      // Read the manifest file to know what to update
      const packageManager = depAuditResult.packageManager;
      let manifestPath = '';
      let manifestContent = '';

      const manifestFiles: Record<string, string> = {
        npm: 'package.json',
        yarn: 'package.json',
        pnpm: 'package.json',
        pip: 'requirements.txt',
        cargo: 'Cargo.toml',
        go: 'go.mod',
        gradle: 'build.gradle',
        maven: 'pom.xml',
        sbt: 'build.sbt',
        composer: 'composer.json',
        bundler: 'Gemfile',
        pub: 'pubspec.yaml',
        nuget: 'Directory.Packages.props',
        cmake: 'CMakeLists.txt',
        conan: 'conanfile.txt',
        vcpkg: 'vcpkg.json',
      };

      manifestPath = manifestFiles[packageManager] || 'package.json';
      
      try {
        manifestContent = await invoke<string>('read_file', { 
          path: `${workspace.rootPath}/${manifestPath}` 
        });
      } catch {
        // Try alternative files for gradle
        if (packageManager === 'gradle') {
          try {
            manifestPath = 'build.gradle.kts';
            manifestContent = await invoke<string>('read_file', { 
              path: `${workspace.rootPath}/${manifestPath}` 
            });
          } catch {
            set({
              isFixingDepIssues: false,
              depFixProgress: '',
              error: 'Could not read dependency manifest file',
            });
            return;
          }
        } else {
          set({
            isFixingDepIssues: false,
            depFixProgress: '',
            error: 'Could not read dependency manifest file',
          });
          return;
        }
      }

      const issuesDescription = [
        ...selectedVulns.map(v => 
          `- VULNERABILITY: ${v.packageName}@${v.currentVersion} (${v.severity}) - ${v.title}. Fix: Update to ${v.fixedInVersion || 'latest safe version'}`
        ),
        ...selectedOutdated.map(p => 
          `- OUTDATED: ${p.name}@${p.currentVersion} -> ${p.latestVersion}${p.updateType === 'major' ? ' (MAJOR UPDATE)' : ''}`
        ),
      ].join('\n');

      const prompt = `You are a dependency management expert. Update the following ${packageManager} manifest file to fix the selected dependency issues.

CURRENT MANIFEST FILE (${manifestPath}):
\`\`\`
${manifestContent}
\`\`\`

ISSUES TO FIX:
${issuesDescription}

IMPORTANT INSTRUCTIONS:
1. For vulnerabilities, update to the fixed version specified or the latest safe version
2. For outdated packages marked as BREAKING CHANGE, be cautious and use the recommended version
3. Preserve the file format and structure exactly
4. Only modify version numbers for the specified packages
5. Do NOT add new packages or remove existing ones

Respond with ONLY the updated file content. Do not include any explanation, markdown code blocks, or other text. Just the raw file content.`;

      set({ depFixProgress: 'AI is generating updated manifest...' });

      aiStore.sendMessage(prompt);
      const updatedContent = await waitForStreamingComplete();

      if (!updatedContent || updatedContent.trim().length === 0) {
        set({
          isFixingDepIssues: false,
          depFixProgress: '',
          error: 'AI did not generate updated manifest content',
        });
        return;
      }

      // Clean the response - remove markdown code blocks if present
      let cleanContent = updatedContent.trim();
      if (cleanContent.startsWith('```')) {
        const lines = cleanContent.split('\n');
        lines.shift(); // Remove first line (```json or similar)
        if (lines[lines.length - 1] === '```') {
          lines.pop();
        }
        cleanContent = lines.join('\n');
      }

      set({ depFixProgress: `Writing updated ${manifestPath}...` });

      // Write the updated manifest
      await invoke('write_file', {
        path: `${workspace.rootPath}/${manifestPath}`,
        content: cleanContent,
      });

      set({
        isFixingDepIssues: false,
        depFixProgress: '',
        selectedDepVulnerabilities: new Set(),
        selectedOutdatedPackages: new Set(),
        error: null,
      });

      // Re-run audit to show updated results
      const { runDepAudit } = get();
      await runDepAudit();

    } catch (error) {
      set({
        isFixingDepIssues: false,
        depFixProgress: '',
        error: `Failed to fix dependency issues: ${error}`,
      });
    }
  },
}));

interface FixPatch {
  file: string;
  original: string;
  replacement: string;
}

const parseFixes = (content: string): FixPatch[] => {
  const fixes: FixPatch[] = [];
  const decodedContent = decodeXmlEntities(content);
  
  const fixRegex = /<fix\s+file="([^"]+)">([\s\S]*?)<\/fix>/gi;
  let fixMatch;

  while ((fixMatch = fixRegex.exec(decodedContent)) !== null) {
    const file = fixMatch[1];
    const body = fixMatch[2];

    const originalMatch = body.match(/<original>([\s\S]*?)<\/original>/i);
    const replacementMatch = body.match(/<replacement>([\s\S]*?)<\/replacement>/i);

    if (originalMatch && replacementMatch) {
      fixes.push({
        file,
        original: originalMatch[1].trim(),
        replacement: replacementMatch[1].trim(),
      });
    }
  }

  if (fixes.length === 0) {
    const altFixRegex = /<fix\s+file="([^"]+)">([\s\S]*?)<\/fix>/gi;
    let altFixMatch;
    while ((altFixMatch = altFixRegex.exec(content)) !== null) {
      const file = altFixMatch[1];
      const body = altFixMatch[2];

      const originalMatch = body.match(/<original>([\s\S]*?)<\/original>/i);
      const replacementMatch = body.match(/<replacement>([\s\S]*?)<\/replacement>/i);

      if (originalMatch && replacementMatch) {
        fixes.push({
          file,
          original: originalMatch[1].trim(),
          replacement: replacementMatch[1].trim(),
        });
      }
    }
  }

  return fixes;
};

const parseSecurityScanResult = (content: string): SecurityFinding[] => {
  const findings: SecurityFinding[] = [];
  const decodedContent = decodeXmlEntities(content);
  const scanMatch = decodedContent.match(/<security_scan\b[^>]*>([\s\S]*?)<\/security_scan>/i) ||
                    content.match(/<security_scan\b[^>]*>([\s\S]*?)<\/security_scan>/i);
  
  if (!scanMatch) return findings;

  const scanContent = scanMatch[1];
  const findingRegex = /<finding\s+([^>]+)>([\s\S]*?)<\/finding>/gi;
  let findingMatch;
  let idCounter = 0;

  while ((findingMatch = findingRegex.exec(scanContent)) !== null) {
    const attrs = parseAttributes(findingMatch[1]);
    const body = findingMatch[2];

    const getTagContent = (tag: string): string => {
      const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return match ? match[1].trim() : '';
    };

    const severityValue = (attrs.severity || 'info').toLowerCase();
    const severity: SecurityFinding['severity'] =
      ['critical', 'high', 'medium', 'low', 'info'].includes(severityValue)
        ? (severityValue as SecurityFinding['severity'])
        : 'info';

    const lineStr = getTagContent('line');
    const refsStr = getTagContent('references');

    findings.push({
      id: `sec-${++idCounter}`,
      severity,
      category: attrs.category || 'Unknown',
      title: getTagContent('title') || 'Security Issue',
      description: getTagContent('description'),
      file: getTagContent('file'),
      line: lineStr ? parseInt(lineStr, 10) : undefined,
      code: getTagContent('code'),
      suggestion: getTagContent('suggestion'),
      references: refsStr ? refsStr.split(',').map(r => r.trim()) : undefined,
    });
  }

  return findings;
};

const parseDepAuditResult = (content: string, defaultPkgManager: string): DepAuditResult => {
  const vulnerabilities: DependencyVulnerability[] = [];
  const outdatedPackages: OutdatedPackage[] = [];
  
  const decodedContent = decodeXmlEntities(content);
  const auditMatch = decodedContent.match(/<dep_audit\s+([^>]*)>([\s\S]*?)<\/dep_audit>/i) ||
                     content.match(/<dep_audit\s+([^>]*)>([\s\S]*?)<\/dep_audit>/i);

  let packageManager = defaultPkgManager;
  let totalDependencies = 0;

  if (auditMatch) {
    const attrs = parseAttributes(auditMatch[1]);
    packageManager = attrs.package_manager || defaultPkgManager;
    totalDependencies = parseInt(attrs.total_dependencies || '0', 10);
    const auditContent = auditMatch[2];

    const vulnRegex = /<vulnerability\s+([^>]*)>([\s\S]*?)<\/vulnerability>/gi;
    let vulnMatch;
    let vulnCounter = 0;

    while ((vulnMatch = vulnRegex.exec(auditContent)) !== null) {
      const attrs = parseAttributes(vulnMatch[1]);
      const body = vulnMatch[2];

      const getTagContent = (tag: string): string => {
        const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return match ? match[1].trim() : '';
      };

      const severityValue = (attrs.severity || 'low').toLowerCase();
      const severity: DependencyVulnerability['severity'] =
        ['critical', 'high', 'medium', 'low'].includes(severityValue)
          ? (severityValue as DependencyVulnerability['severity'])
          : 'low';

      vulnerabilities.push({
        id: `vuln-${++vulnCounter}`,
        packageName: getTagContent('package'),
        currentVersion: getTagContent('version'),
        severity,
        cveId: getTagContent('cve') || undefined,
        title: getTagContent('title'),
        description: getTagContent('description'),
        fixedInVersion: getTagContent('fixed_in') || undefined,
        recommendation: getTagContent('recommendation'),
      });
    }

    const outdatedRegex = /<outdated\s+([^>]*)>([\s\S]*?)<\/outdated>/gi;
    let outdatedMatch;

    while ((outdatedMatch = outdatedRegex.exec(auditContent)) !== null) {
      const attrs = parseAttributes(outdatedMatch[1]);
      const body = outdatedMatch[2];

      const getTagContent = (tag: string): string => {
        const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return match ? match[1].trim() : '';
      };

      const updateType = (attrs.update_type || 'patch').toLowerCase();
      
      outdatedPackages.push({
        name: getTagContent('package'),
        currentVersion: getTagContent('current'),
        latestVersion: getTagContent('latest'),
        updateType: ['major', 'minor', 'patch'].includes(updateType) 
          ? (updateType as 'major' | 'minor' | 'patch')
          : 'patch',
        hasSecurityImpact: attrs.has_security_impact === 'true',
      });
    }
  }

  return {
    vulnerabilities,
    outdatedPackages,
    summary: {
      critical: vulnerabilities.filter(v => v.severity === 'critical').length,
      high: vulnerabilities.filter(v => v.severity === 'high').length,
      medium: vulnerabilities.filter(v => v.severity === 'medium').length,
      low: vulnerabilities.filter(v => v.severity === 'low').length,
      outdated: outdatedPackages.length,
    },
    packageManager,
    totalDependencies,
  };
};
