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
}));
