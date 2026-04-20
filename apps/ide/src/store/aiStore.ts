import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fs, web, mcp, WebSearchResult, WebContent, StockQuote, MarketMovers, MCPServerConfig, MCPTool, MCPToolResult } from '../services/tauri';

export type AIProvider = 'ollama' | 'claude' | 'openai' | 'custom' | 'copilot';
export type AgentMode = 'chat' | 'agent' | 'edit' | 'plan';
export type AgentTaskStatus = 'pending' | 'in-progress' | 'completed' | 'skipped';
export type WebAccessStatus = 'idle' | 'searching' | 'fetching' | null;

export interface WebAccessTrace {
  id: string;
  type: 'search' | 'fetch';
  query?: string;
  url?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  searchResults?: WebSearchResult[];
  fetchContent?: WebContent;
  expanded?: boolean;
}

export interface AgentTask {
  id: string;
  text: string;
  status: AgentTaskStatus;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  path?: string;
  data?: string; // base64 for images
  mimeType?: string;
  size?: number;
}

export interface AIConversation {
  id: string;
  title: string;
  messages: AIMessage[];
  createdAt: string;
  updatedAt: string;
  appliedFileOps?: string[]; // Array of operation identifiers that have been kept
}

export interface AIProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  copilotClientId?: string;
  copilotUsageOrg?: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  thinkAloud: boolean;
  claudeExtendedThinking: boolean;
  mcpServers: MCPServerConfig[];
}

export interface MCPServerState {
  id: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  tools: MCPTool[];
  error?: string;
}

interface AIState {
  config: AIProviderConfig;
  conversations: AIConversation[];
  activeConversation: AIConversation | null;
  isStreaming: boolean;
  thinkingStatus: string | null;
  availableModels: Record<AIProvider, string[]>;
  copilotVisionModels: string[];
  currentWorkspacePath: string | null;
  promptQueue: string[];
  agentMode: AgentMode;
  agentTasks: AgentTask[];
  agentTaskIndex: number;
  webAccessStatus: WebAccessStatus;
  webAccessTraces: WebAccessTrace[];
  mcpServerStates: MCPServerState[];
  
  setConfig: (config: Partial<AIProviderConfig>) => void;
  setWebAccessStatus: (status: WebAccessStatus) => void;
  setWebAccessTraces: (traces: WebAccessTrace[]) => void;
  clearWebAccessTraces: () => void;
  toggleWebAccessTraceExpanded: (traceId: string) => void;
  setAgentMode: (mode: AgentMode) => void;
  setAgentTasks: (tasks: string[]) => void;
  advanceAgentTask: () => void;
  updateAgentTaskStatus: (id: string, status: AgentTaskStatus) => void;
  clearAgentTasks: () => void;
  createConversation: () => void;
  setActiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  sendMessage: (content: string, attachments?: MessageAttachment[]) => Promise<void>;
  queuePrompt: (content: string) => void;
  clearQueue: () => void;
  stopStreaming: () => void;
  clearConversation: () => void;
  refreshAvailableModels: () => Promise<void>;
  loadWorkspaceHistory: (workspacePath: string) => Promise<void>;
  saveWorkspaceHistory: () => Promise<void>;
  setThinkingStatus: (status: string | null) => void;
  importConversationsFromPath: (sourcePath: string) => Promise<{ imported: number; error?: string }>;
  exportConversation: (conversationId: string) => Promise<string | null>;
  markFileOperationsAsKept: (operationIds: string[]) => void;
  isFileOperationKept: (operationId: string) => boolean;
  addMCPServer: (config: MCPServerConfig) => void;
  removeMCPServer: (serverId: string) => void;
  updateMCPServer: (serverId: string, config: Partial<MCPServerConfig>) => void;
  startMCPServer: (serverId: string) => Promise<void>;
  stopMCPServer: (serverId: string) => Promise<void>;
  callMCPTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<MCPToolResult>;
}

const AI_HISTORY_FILE = 'ai-history.json';

/**
 * Converts a workspace filesystem path into a safe directory name by replacing
 * path separators and colons with underscores and stripping leading underscores.
 * e.g. /Users/alice/work/myproject → Users_alice_work_myproject
 */
function workspaceSlug(workspacePath: string): string {
  return workspacePath.replace(/[\\/: ]+/g, '_').replace(/^_+/, '');
}

/**
 * Returns the centralized storage directory for the given workspace.
 * ~/Library/Application Support/OpenCodeBrew/workspaces/<slug>/
 * Falls back to the workspace path itself if the app data dir is unavailable.
 */
async function getWorkspaceStorageDir(workspacePath: string): Promise<string> {
  try {
    const appDataDir = await fs.getAppDataDir();
    const slug = workspaceSlug(workspacePath);
    return `${appDataDir}/workspaces/${slug}`;
  } catch (e) {
    console.warn('Could not resolve app data dir, falling back to workspace path:', e);
    return `${workspacePath}/.opencodebrew`;
  }
}

function formatAIError(error: unknown): string {
  let errorMessage = '';
  
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') {
      errorMessage = maybeMessage;
    } else {
      const maybeError = (error as { error?: unknown }).error;
      if (typeof maybeError === 'string') {
        errorMessage = maybeError;
      } else {
        try {
          errorMessage = JSON.stringify(error);
        } catch {
          return 'Failed to get response from AI';
        }
      }
    }
  } else {
    return 'Failed to get response from AI';
  }
  
  // Enhance vision-related error messages with helpful guidance
  if (errorMessage.includes('not supported for vision') || errorMessage.includes('image media type')) {
    return `${errorMessage}\n\nTip: This model doesn't support images. For Copilot vision, try selecting a gpt-4o model from the dropdown.`;
  }
  
  return errorMessage;
}

async function ensureStorageDir(storageDir: string): Promise<void> {
  try {
    const exists = await fs.pathExists(storageDir);
    if (!exists) {
      await fs.createDirectory(storageDir);
      console.log('Created storage directory:', storageDir);
    }
  } catch (e) {
    console.log('Could not create storage directory:', e);
  }
}

async function loadHistoryFromFile(workspacePath: string): Promise<AIConversation[]> {
  try {
    const storageDir = await getWorkspaceStorageDir(workspacePath);
    const historyPath = `${storageDir}/${AI_HISTORY_FILE}`;
    const exists = await fs.pathExists(historyPath);
    if (!exists) {
      return [];
    }
    const content = await fs.readFile(historyPath);
    const data = JSON.parse(content);
    return data.conversations || [];
  } catch (error) {
    console.log('Could not load AI history:', error);
    return [];
  }
}

async function saveHistoryToFile(workspacePath: string, conversations: AIConversation[]): Promise<void> {
  try {
    const storageDir = await getWorkspaceStorageDir(workspacePath);
    console.log('Saving AI history to:', storageDir);
    await ensureStorageDir(storageDir);
    const historyPath = `${storageDir}/${AI_HISTORY_FILE}`;
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      conversations,
    };
    await fs.writeFile(historyPath, JSON.stringify(data, null, 2));
    console.log('AI history saved successfully to:', historyPath);
  } catch (error) {
    console.error('Could not save AI history:', error);
  }
}

const AGENT_MODE_PROMPT = `

## FILE OPERATIONS

You can create, read, and edit files in the user's workspace. Use XML-style tags to perform file operations:

### Create a new file:
<create_file path="src/example.ts">
export function hello() {
  return "Hello World";
}
</create_file>

### Edit an existing file (replace content):
<edit_file path="src/example.ts" mode="replace">
<old_content>
export function hello() {
  return "Hello World";
}
</old_content>
<new_content>
export function hello(name: string) {
  return \`Hello \${name}\`;
}
</new_content>
</edit_file>

### Edit file (insert at line):
<edit_file path="src/example.ts" mode="insert" line="5">
// New code to insert at line 5
const greeting = "Hi there";
</edit_file>

### Delete a file:
<delete_file path="src/old-file.ts" />

IMPORTANT:
- Always use relative paths from the workspace root
- Explain what you're doing before each operation
- For edits, include enough context in old_content to uniquely identify the location
- Multiple operations are allowed in a single response
- The user will see a preview before changes are applied

## END OF RESPONSE SUMMARY

At the end of your response, ALWAYS include a brief summary of what you accomplished:

**Summary:**
- List the files you created/modified/deleted
- Briefly describe the key changes made
- Mention any important implementation details
- Note if there are any follow-up steps needed

Example:
**Summary:**
- Created \`src/components/Button.tsx\` with primary and secondary variants
- Modified \`src/App.tsx\` to import and use the new Button component
- Added proper TypeScript types and props validation
- Next steps: Add unit tests for the Button component`;

const EDIT_MODE_PROMPT = `

## EDIT MODE

You are in edit mode. Focus on making precise code changes. Use file operation tags to edit existing files:

<edit_file path="relative/path/to/file.ts" mode="replace">
<old_content>
// Exact content to replace (must match exactly)
</old_content>
<new_content>
// New content
</new_content>
</edit_file>

- Be precise with your edits
- Include enough context in old_content for unique matching
- Explain the changes you're making
- Focus on the specific changes requested

## END OF RESPONSE SUMMARY

At the end of your response, ALWAYS include a concise summary:

**Changes Made:**
- File: \`path/to/file\` - Brief description of what changed
- File: \`path/to/file\` - Brief description of what changed
- Note any side effects or additional changes needed`;

const PLAN_MODE_PROMPT = `

## PLAN MODE - Strategic Planning & Architecture

You are in PLAN MODE. Your role is to help users think through problems, explore solutions, and design implementations BEFORE writing code.

### Planning Approach

1. **Understand & Clarify**
   - Ask clarifying questions if requirements are unclear
   - Identify constraints, dependencies, and edge cases
   - Consider the broader context and impact

2. **Explore Options**
   - Present multiple approaches with trade-offs
   - Discuss pros and cons of each solution
   - Consider scalability, maintainability, and performance

3. **Break Down Complexity**
   - Decompose large tasks into manageable steps
   - Identify prerequisites and dependencies
   - Suggest logical implementation order

4. **Visualize Architecture**
   - Use mermaid diagrams for system architecture
   - Show data flow and component relationships
   - Illustrate state management and API design

### Planning Outputs

Use these structured formats in your responses:

**Implementation Plan:**
<plan title="Feature: User Authentication">
<overview>
High-level description of what we're building and why.
</overview>

<approach name="Option 1: JWT Tokens" recommended="true">
<pros>
- Stateless and scalable
- Works well with microservices
- Industry standard
</pros>
<cons>
- Token invalidation challenges
- Requires secure storage
</cons>
</approach>

<approach name="Option 2: Session-based">
<pros>
- Simpler to implement
- Easy to invalidate sessions
</pros>
<cons>
- Requires stateful server
- Scaling challenges
</cons>
</approach>

<tasks>
- [ ] Set up authentication middleware
- [ ] Create user model and database schema
- [ ] Implement login/logout endpoints
- [ ] Add token validation
- [ ] Write tests for auth flow
</tasks>

<architecture>
graph LR
  Client --> API[API Gateway]
  API --> Auth[Auth Service]
  Auth --> DB[User Database]
  Auth --> Cache[Token Cache]
</architecture>

**IMPORTANT:** Inside <architecture> tags, write Mermaid syntax directly WITHOUT markdown code fences (no \`\`\`mermaid). The architecture content is automatically rendered as a Mermaid diagram.

<considerations>
- Security: Hash passwords with bcrypt
- Performance: Cache tokens in Redis
- UX: Implement refresh token flow
</considerations>
</plan>

**Quick Checklist (for simpler tasks):**
<checklist title="Add Dark Mode">
- [ ] Define color variables in CSS
- [ ] Create theme context/store
- [ ] Add toggle button in settings
- [ ] Persist preference to localStorage
- [ ] Test all components in both themes
</checklist>

**Decision Matrix:**
<decision question="Which state management library?">
| Criteria | Redux | Zustand | Jotai | Winner |
|----------|-------|---------|-------|--------|
| Learning curve | Complex | Simple | Simple | Zustand/Jotai |
| Bundle size | Large | Small | Tiny | Jotai |
| DevTools | Excellent | Good | Basic | Redux |
| Our use case | Overkill | Perfect | Good | Zustand |

**Recommendation:** Zustand - best balance of simplicity and features for this project.
</decision>

### Key Principles

- **No code implementation** - Focus on design and strategy
- **NO CODE BLOCKS** - Do NOT write any code snippets, bash commands, JavaScript, TypeScript, or any programming language code
- **Conceptual only** - Describe what needs to be done in plain language
- **READ-ONLY MODE** - Do NOT generate file operation tags (<create_file>, <edit_file>, <delete_file>)
- **No file modifications** - Plan Mode is for planning only, not coding
- **Task lists instead of code** - Instead of showing code examples, create actionable task lists describing what to implement
- **Ask questions** - Clarify before assuming
- **Multiple perspectives** - Show different approaches
- **Visual thinking** - Use Mermaid diagrams for architecture (inside <architecture> tags only)
- **Actionable output** - Provide clear next steps as task lists
- **Consider trade-offs** - No solution is perfect
- **Think long-term** - Maintainability matters

**CRITICAL RULES FOR PLAN MODE:**
1. You are in READ-ONLY PLAN MODE
2. NEVER write code blocks with triple backticks (bash, javascript, typescript, python, etc.)
3. NEVER show command-line examples or shell commands
4. Instead of code, describe WHAT needs to be done as a task list
5. Users will switch to Agent Mode when ready to see actual code
6. Focus on WHY and WHAT, not HOW (implementation details)

**Example - WRONG (Code):**
Do not write: npm install next react (in a bash code block)

**Example - RIGHT (Task):**
- [ ] Install Next.js and React dependencies using npm

Users will switch to Agent/Edit mode when ready to implement and see actual code.

### When to Use Plan Mode

- Designing new features or systems
- Refactoring large codebases
- Making architectural decisions
- Evaluating technology choices
- Breaking down complex problems
- Before starting implementation

## END OF RESPONSE TODO LIST

At the end of your response, ALWAYS include a comprehensive checklist summarizing all action items:

<checklist title="Implementation Checklist">
- [ ] Task 1: Brief description
- [ ] Task 2: Brief description
- [ ] Task 3: Brief description
- [ ] Task 4: Brief description
</checklist>

This checklist should:
- Include ALL actionable steps discussed in your response
- Be organized in logical implementation order
- Use clear, actionable language
- Group related tasks together
- Include testing and documentation tasks

Remember: The goal is to help the user make informed decisions. Be thorough but concise. Use structured formats to organize information clearly.`;

const THINK_ALOUD_PROMPT = `

IMPORTANT: Think through your response step by step. Before giving your final answer:
1. First, analyze what the user is asking
2. Consider the relevant context and code
3. Think through possible approaches or solutions
4. Explain your reasoning process
5. Then provide your final answer

Format your thinking in a "Thinking:" section before your response.`;

function getCurrentDatePrompt(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  const dateStr = now.toLocaleDateString('en-US', options);
  const shortDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timestamp = now.toISOString();
  const year = now.getFullYear();
  return `

## CURRENT DATE/TIME
**Today is ${dateStr}** (${timestamp})

CRITICAL: When searching for news or current events:
- ALWAYS include "${shortDate}" or "today ${year}" in search queries
- Do NOT rely on cached data - always fetch fresh results
- For stock news, use: <search_web query="TOPIC ${shortDate}" />`;
}

function getWebAccessPrompt(): string {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `

## WEB ACCESS

You have tools to search the web and fetch actual data. You MUST use these for ANY question about:
- **Stock prices, market data, cryptocurrency prices** - These change constantly
- **Current events, recent news, or anything time-sensitive**
- **Weather, sports scores, or live data**
- **Product prices, reviews, or availability**

### Available Tools:

**Search the web:**
<search_web query="your search query" />

**Fetch content from a URL:**
<fetch_url url="https://example.com/page" />

**Get market movers (gainers/losers/active):**
<get_market_movers />

**Get quote for a specific stock:**
<get_stock_quote symbol="AAPL" />

### STOCK QUERIES - USE THESE PATTERNS:

| User asks about | You MUST do |
|-----------------|-------------|
| Top gainers/losers/active | <get_market_movers /> |
| Specific stock price | <get_stock_quote symbol="TICKER" /> |
| After-hours movers | <fetch_url url="https://www.marketwatch.com/tools/screener/after-hours" /> |
| Pre-market movers | <fetch_url url="https://www.marketwatch.com/tools/screener/premarket" /> |
| Stock news | <search_web query="TICKER news ${today}" /> |

### CRITICAL: NEVER JUST PROVIDE LINKS

**WRONG approach:**
"Here are some resources where you can find after-hours data: [list of links]"

**CORRECT approach:**
1. Use <fetch_url> to get the actual page content
2. Extract the stock data from the response
3. Present the actual prices and changes in a table

You MUST ALWAYS:
1. FETCH the actual data using your tools
2. EXTRACT specific prices, percentages, and stock symbols
3. PRESENT the data in a table format
4. NEVER tell users to "check these links" or "visit these sites"

**DATA QUALITY - AUTOMATIC CORRECTION:**
If you receive stock data with $0.00 prices or 0.00% changes:
1. Use <get_stock_quote symbol="TICKER" /> for EACH stock with bad data
2. Present ONLY corrected, accurate prices
3. NEVER show broken data or say "data may be incomplete"

**WORKFLOW EXAMPLE for "after hours movers":**
1. Fetch: <fetch_url url="https://www.marketwatch.com/tools/screener/after-hours" />
2. Extract stock symbols, prices, changes, and % changes from the response
3. Present in a table with color coding for positive and negative changes:
   | Ticker | Price | Change | Change % |
   |--------|-------|--------|--------|
   | NVDA   | $145  | $1.23 | +5.2%  |

DO NOT give generic advice, provide resource links, or suggest checking elsewhere. YOU have the tools - USE THEM and present actual data.`;
}

interface WebOperation {
  type: 'search_web' | 'fetch_url' | 'get_stock_quote' | 'get_market_movers';
  query?: string;
  url?: string;
  symbol?: string;
}

function parseWebOperations(content: string): WebOperation[] {
  const operations: WebOperation[] = [];
  
  const searchRegex = /<search_web\s+query="([^"]+)"\s*\/?>/gi;
  let match;
  while ((match = searchRegex.exec(content)) !== null) {
    operations.push({ type: 'search_web', query: match[1] });
  }
  
  const fetchRegex = /<fetch_url\s+url="([^"]+)"\s*\/?>/gi;
  while ((match = fetchRegex.exec(content)) !== null) {
    operations.push({ type: 'fetch_url', url: match[1] });
  }
  
  const stockQuoteRegex = /<get_stock_quote\s+symbol="([^"]+)"\s*\/?>/gi;
  while ((match = stockQuoteRegex.exec(content)) !== null) {
    operations.push({ type: 'get_stock_quote', symbol: match[1] });
  }
  
  const marketMoversRegex = /<get_market_movers\s*\/?>/gi;
  while ((match = marketMoversRegex.exec(content)) !== null) {
    operations.push({ type: 'get_market_movers' });
  }
  
  return operations.slice(0, 10);
}

function cleanWebOperationTags(content: string): string {
  return content
    .replace(/<search_web\s+query="[^"]+"\s*\/?>/gi, '')
    .replace(/<fetch_url\s+url="[^"]+"\s*\/?>/gi, '')
    .replace(/<get_stock_quote\s+symbol="[^"]+"\s*\/?>/gi, '')
    .replace(/<get_market_movers\s*\/?>/gi, '')
    .trim();
}

function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return 'No search results found.';
  }
  
  let formatted = '**Web Search Results:**\n\n';
  results.forEach((result, i) => {
    formatted += `${i + 1}. **[${result.title}](${result.url})**\n`;
    formatted += `   ${result.snippet}\n\n`;
  });
  return formatted;
}

function formatFetchContent(content: WebContent): string {
  return `**Content from [${content.title || content.url}](${content.url}):**\n\n${content.content}`;
}

function formatStockQuote(quote: StockQuote): string {
  const changeSign = quote.change >= 0 ? '+' : '';
  const changeColor = quote.change >= 0 ? '🟢' : '🔴';
  return `**${quote.symbol}** (${quote.name})
- Price: $${quote.price.toFixed(2)}
- Change: ${changeColor} ${changeSign}$${quote.change.toFixed(2)} (${changeSign}${quote.change_percent.toFixed(2)}%)
- Volume: ${quote.volume.toLocaleString()}
${quote.market_cap ? `- Market Cap: $${quote.market_cap}` : ''}`;
}

function formatMarketMovers(movers: MarketMovers): string {
  let result = '**📈 Top Gainers:**\n';
  movers.gainers.forEach((stock, i) => {
    result += `${i + 1}. **${stock.symbol}** - $${stock.price.toFixed(2)} (+${stock.change_percent.toFixed(2)}%)\n`;
  });
  
  result += '\n**📉 Top Losers:**\n';
  movers.losers.forEach((stock, i) => {
    result += `${i + 1}. **${stock.symbol}** - $${stock.price.toFixed(2)} (${stock.change_percent.toFixed(2)}%)\n`;
  });
  
  result += '\n**🔥 Most Active:**\n';
  movers.most_active.forEach((stock, i) => {
    const sign = stock.change >= 0 ? '+' : '';
    result += `${i + 1}. **${stock.symbol}** - $${stock.price.toFixed(2)} (${sign}${stock.change_percent.toFixed(2)}%) Vol: ${stock.volume.toLocaleString()}\n`;
  });
  
  result += '\n*Source: MarketWatch/Google Finance*';
  return result;
}

function createWebAccessTraces(operations: WebOperation[]): WebAccessTrace[] {
  return operations.map((op, i) => {
    let type: 'search' | 'fetch' = 'search';
    let query = op.query;
    let url = op.url;
    
    if (op.type === 'search_web') {
      type = 'search';
      query = op.query;
    } else if (op.type === 'fetch_url') {
      type = 'fetch';
      url = op.url;
    } else if (op.type === 'get_stock_quote') {
      type = 'fetch';
      query = `Stock quote: ${op.symbol}`;
    } else if (op.type === 'get_market_movers') {
      type = 'fetch';
      query = 'Market movers (gainers, losers, most active)';
    }
    
    return {
      id: `web-${Date.now()}-${i}`,
      type,
      query,
      url,
      status: 'pending' as const,
    };
  });
}

async function getStockQuoteWithFallback(symbol: string): Promise<StockQuote> {
  const store = useAIStore.getState();
  const runningServers = (store.mcpServerStates || []).filter(s => s.status === 'running');
  
  for (const server of runningServers) {
    const quoteTool = server.tools.find(t => 
      t.name === 'get_quote' || 
      t.name === 'get_stock_quote' || 
      t.name === 'getStockQuote'
    );
    
    if (quoteTool) {
      try {
        console.log(`[aiStore] Trying MCP server ${server.id} for stock quote: ${symbol}`);
        const result = await mcp.callTool(server.id, quoteTool.name, { symbol });
        
        if (!result.is_error && result.content.length > 0) {
          const text = result.content.find(c => c.type === 'text')?.text;
          if (text) {
            try {
              const data = JSON.parse(text);
              console.log(`[aiStore] MCP returned quote data for ${symbol}:`, data);
              return {
                symbol: data.symbol || symbol,
                name: data.shortName || data.longName || data.name || symbol,
                price: data.regularMarketPrice || data.price || 0,
                change: data.regularMarketChange || data.change || 0,
                change_percent: data.regularMarketChangePercent || data.change_percent || data.changePercent || 0,
                volume: data.regularMarketVolume || data.volume || 0,
                market_cap: data.marketCap || data.market_cap || null,
              };
            } catch {
              console.log(`[aiStore] MCP response not JSON, falling back to web scraping`);
            }
          }
        }
      } catch (error) {
        console.log(`[aiStore] MCP call failed, falling back to web scraping:`, error);
      }
    }
  }
  
  return web.getStockQuote(symbol);
}

async function getMarketMoversWithFallback(): Promise<MarketMovers> {
  const store = useAIStore.getState();
  const runningServers = (store.mcpServerStates || []).filter(s => s.status === 'running');
  
  for (const server of runningServers) {
    const moversTool = server.tools.find(t => 
      t.name === 'get_market_movers' || 
      t.name === 'getMarketMovers' ||
      t.name === 'get_movers'
    );
    
    if (moversTool) {
      try {
        console.log(`[aiStore] Trying MCP server ${server.id} for market movers`);
        const result = await mcp.callTool(server.id, moversTool.name, {});
        
        if (!result.is_error && result.content.length > 0) {
          const text = result.content.find(c => c.type === 'text')?.text;
          if (text) {
            try {
              const data = JSON.parse(text);
              return {
                gainers: data.gainers || [],
                losers: data.losers || [],
                most_active: data.most_active || data.mostActive || [],
              };
            } catch {
              console.log(`[aiStore] MCP response not JSON, falling back to web scraping`);
            }
          }
        }
      } catch (error) {
        console.log(`[aiStore] MCP call failed, falling back to web scraping:`, error);
      }
    }
  }
  
  // MCP server doesn't have market movers - use web scraping
  return web.getMarketMovers();
}

async function executeWebOperationsWithTraces(
  operations: WebOperation[],
  traces: WebAccessTrace[],
  updateTraces: (traces: WebAccessTrace[]) => void,
  setStatus: (status: WebAccessStatus) => void
): Promise<string> {
  const results: string[] = [];
  const updatedTraces = [...traces];
  
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    updatedTraces[i] = { ...updatedTraces[i], status: 'running' };
    updateTraces([...updatedTraces]);
    
    try {
      if (op.type === 'search_web' && op.query) {
        setStatus('searching');
        console.log(`[aiStore] Executing web search: ${op.query}`);
        const searchResults = await web.search(op.query, 5);
        const formatted = formatSearchResults(searchResults);
        results.push(formatted);
        updatedTraces[i] = { 
          ...updatedTraces[i], 
          status: 'completed', 
          result: `Found ${searchResults.length} results`,
          searchResults: searchResults,
          expanded: false
        };
      } else if (op.type === 'fetch_url' && op.url) {
        setStatus('fetching');
        console.log(`[aiStore] Fetching URL: ${op.url}`);
        const content = await web.fetchUrl(op.url);
        const formatted = formatFetchContent(content);
        results.push(formatted);
        updatedTraces[i] = { 
          ...updatedTraces[i], 
          status: 'completed', 
          result: `Fetched: ${content.title || op.url}`,
          fetchContent: content,
          expanded: false
        };
      } else if (op.type === 'get_stock_quote' && op.symbol) {
        setStatus('fetching');
        console.log(`[aiStore] Getting stock quote: ${op.symbol}`);
        const quote = await getStockQuoteWithFallback(op.symbol);
        const formatted = formatStockQuote(quote);
        results.push(formatted);
        updatedTraces[i] = { 
          ...updatedTraces[i], 
          status: 'completed', 
          result: `${quote.symbol}: $${quote.price.toFixed(2)} (${quote.change >= 0 ? '+' : ''}${quote.change_percent.toFixed(2)}%)`,
          expanded: false
        };
      } else if (op.type === 'get_market_movers') {
        setStatus('fetching');
        console.log(`[aiStore] Getting market movers`);
        const movers = await getMarketMoversWithFallback();
        const formatted = formatMarketMovers(movers);
        results.push(formatted);
        const totalStocks = movers.gainers.length + movers.losers.length + movers.most_active.length;
        updatedTraces[i] = { 
          ...updatedTraces[i], 
          status: 'completed', 
          result: `Retrieved ${totalStocks} stocks (gainers, losers, most active)`,
          expanded: false
        };
      }
    } catch (error) {
      console.error(`[aiStore] Web operation failed:`, error);
      const opName = op.type === 'search_web' ? 'search' : 
                     op.type === 'get_stock_quote' ? `get quote for ${op.symbol}` :
                     op.type === 'get_market_movers' ? 'get market data' : 'fetch';
      results.push(`**Error:** Failed to ${opName}: ${error}`);
      updatedTraces[i] = { ...updatedTraces[i], status: 'error', error: String(error) };
    }
    updateTraces([...updatedTraces]);
  }
  
  setStatus(null);
  return results.join('\n\n---\n\n');
}

const defaultConfig: AIProviderConfig = {
  provider: 'ollama',
  model: 'llama3',
  baseUrl: 'http://localhost:11434',
  copilotClientId: '',
  copilotUsageOrg: '',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: `You are an expert coding assistant integrated into the OpenCodeBrew code editor. You have access to the user's currently open files and project context.

When the user asks about code:
- Reference the specific file content provided in the context
- Give concrete suggestions based on their actual code
- Point to specific line numbers or sections when relevant

When explaining code:
- Break down the logic step by step
- Explain the purpose of functions, classes, and key variables
- Highlight any potential issues or improvements

Always be concise but thorough. Format code examples with proper syntax highlighting using markdown code blocks.`,
  thinkAloud: false,
  claudeExtendedThinking: false,
  mcpServers: [
    {
      id: 'yahoo-finance',
      name: 'Yahoo Finance MCP',
      command: 'npx',
      args: ['-y', 'yfinance-mcp'],
      env: {},
      enabled: false,
    },
    {
      id: 'brave-search',
      name: 'Brave Search MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
      enabled: false,
    },
    {
      id: 'filesystem',
      name: 'Filesystem MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/openCodeBrew'],
      env: {},
      enabled: false,
    },
    {
      id: 'github',
      name: 'GitHub MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
      enabled: false,
    },
  ],
};

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      config: defaultConfig,
      conversations: [],
      activeConversation: null,
      isStreaming: false,
      thinkingStatus: null,
      currentWorkspacePath: null,
      promptQueue: [],
      agentMode: 'chat',
      agentTasks: [],
      agentTaskIndex: -1,
      webAccessStatus: null,
      webAccessTraces: [],
      mcpServerStates: [],
      availableModels: {
        ollama: [],
        claude: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
        openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
        custom: [],
        copilot: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
      },
      copilotVisionModels: [],

      setConfig: (newConfig) => {
        set((state) => ({
          config: { ...state.config, ...newConfig },
        }));
      },

      setWebAccessStatus: (status: WebAccessStatus) => {
        set({ webAccessStatus: status });
      },

      setWebAccessTraces: (traces: WebAccessTrace[]) => {
        set({ webAccessTraces: traces });
      },

      clearWebAccessTraces: () => {
        set({ webAccessTraces: [] });
      },

      toggleWebAccessTraceExpanded: (traceId: string) => {
        set((state) => ({
          webAccessTraces: state.webAccessTraces.map((trace) =>
            trace.id === traceId ? { ...trace, expanded: !trace.expanded } : trace
          ),
        }));
      },

      setAgentMode: (mode: AgentMode) => {
        set({ agentMode: mode });
      },

      setAgentTasks: (taskTexts: string[]) => {
        const tasks: AgentTask[] = taskTexts.map((text, i) => ({
          id: `agent-task-${i}-${Date.now()}`,
          text,
          status: (i === 0 ? 'in-progress' : 'pending') as AgentTaskStatus,
        }));
        set({ agentTasks: tasks, agentTaskIndex: 0 });
      },

      advanceAgentTask: () => {
        const { agentTasks, agentTaskIndex } = get();
        if (agentTasks.length === 0 || agentTaskIndex < 0) return;
        const nextIndex = agentTaskIndex + 1;
        const updated = agentTasks.map((t, i) => {
          if (i === agentTaskIndex) return { ...t, status: 'completed' as AgentTaskStatus };
          if (i === nextIndex) return { ...t, status: 'in-progress' as AgentTaskStatus };
          return t;
        });
        set({ agentTasks: updated, agentTaskIndex: nextIndex });
      },

      updateAgentTaskStatus: (id: string, status: AgentTaskStatus) => {
        set((state) => ({
          agentTasks: state.agentTasks.map(t => t.id === id ? { ...t, status } : t),
        }));
      },

      clearAgentTasks: () => {
        set({ agentTasks: [], agentTaskIndex: -1 });
      },

      setThinkingStatus: (status) => {
        set({ thinkingStatus: status });
      },

      loadWorkspaceHistory: async (workspacePath: string) => {
        console.log('Loading AI history from workspace:', workspacePath);
        const conversations = await loadHistoryFromFile(workspacePath);
        set({
          currentWorkspacePath: workspacePath,
          conversations,
          activeConversation: conversations.length > 0 ? conversations[0] : null,
        });
      },

      saveWorkspaceHistory: async () => {
        const { currentWorkspacePath, conversations } = get();
        if (currentWorkspacePath) {
          await saveHistoryToFile(currentWorkspacePath, conversations);
        }
      },

      createConversation: () => {
        const newConversation: AIConversation = {
          id: crypto.randomUUID(),
          title: 'New Conversation',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversation: newConversation,
        }));
        // Auto-save after creating conversation
        get().saveWorkspaceHistory();
      },

      setActiveConversation: (id) => {
        const conversation = get().conversations.find((c) => c.id === id);
        set({ activeConversation: conversation || null });
      },

      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversation:
            state.activeConversation?.id === id ? null : state.activeConversation,
        }));
        // Auto-save after deleting conversation
        get().saveWorkspaceHistory();
      },

      sendMessage: async (content: string, attachments?: MessageAttachment[]) => {
        let conversation = get().activeConversation;
        const { config } = get();
        
        if (!conversation) {
          get().createConversation();
          conversation = get().activeConversation;
        }
        
        if (!conversation) return;

        // Get context from editor store
        const { useEditorStore } = await import('./editorStore');
        const { useWorkspaceStore } = await import('./workspaceStore');
        const editorState = useEditorStore.getState();
        const workspaceState = useWorkspaceStore.getState();
        
        // Build context from open files
        let contextInfo = '';
        
        if (workspaceState.currentWorkspace) {
          contextInfo += `\n\nProject: ${workspaceState.currentWorkspace.name}\nPath: ${workspaceState.currentWorkspace.rootPath}\n`;
        }
        
        if (editorState.activeFile) {
          contextInfo += `\n\nCurrently open file: ${editorState.activeFile.path}\n`;
          contextInfo += `Language: ${editorState.activeFile.language}\n`;
          contextInfo += `\n--- File Content ---\n${editorState.activeFile.content}\n--- End of File ---\n`;
        }
        
        if (editorState.openFiles.length > 1) {
          contextInfo += `\nOther open files:\n`;
          editorState.openFiles
            .filter(f => f.path !== editorState.activeFile?.path)
            .forEach(f => {
              contextInfo += `- ${f.name} (${f.language})\n`;
            });
        }

        // Enhance the user message with context if it seems like a code question
        const enhancedContent = contextInfo 
          ? `${content}\n\n[Context from IDE]${contextInfo}`
          : content;

        const userMessage: AIMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content, // Show original content in UI
          timestamp: new Date().toISOString(),
          attachments: attachments || [],
        };

        set((state) => {
          const conv = state.activeConversation!;
          const updatedConversation = {
            ...conv,
            messages: [...conv.messages, userMessage],
            updatedAt: new Date().toISOString(),
          };
          return {
            activeConversation: updatedConversation,
            conversations: state.conversations.map((c) =>
              c.id === conv.id ? updatedConversation : c
            ),
            isStreaming: true,
            thinkingStatus: 'Understanding your question...',
          };
        });

        try {
          const { ai } = await import('../services/tauri');
          
          // Update thinking status as we prepare context
          set({ thinkingStatus: 'Gathering context from open files...' });
          
          // Build messages array for API call - use enhanced content for the actual API call
          const conversationMessages = get().activeConversation!.messages;
          const { agentMode } = get();
          
          // Build system prompt based on mode
          let systemPrompt = config.systemPrompt;
          
          // Add mode-specific prompts
          if (agentMode === 'agent') {
            systemPrompt += AGENT_MODE_PROMPT;
          } else if (agentMode === 'edit') {
            systemPrompt += EDIT_MODE_PROMPT;
          } else if (agentMode === 'plan') {
            systemPrompt += PLAN_MODE_PROMPT;
          }
          
          // Add web access capability for all modes (with current date)
          systemPrompt += getCurrentDatePrompt() + getWebAccessPrompt();
          
          // Add think aloud prompt if enabled
          if (config.thinkAloud) {
            systemPrompt += THINK_ALOUD_PROMPT;
          }
          
          const messages = [
            { role: 'system', content: systemPrompt, attachments: undefined },
            ...conversationMessages.slice(0, -1).map(m => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
            })),
            // Use enhanced content with context for the last (current) message
            { role: 'user', content: enhancedContent, attachments: attachments },
          ];
          // Check for images and override model if needed
          const hasImageAttachments = messages.some((message) =>
            message.attachments?.some((attachment) => attachment.type === 'image')
          );

          let responseContent = '';
          const conversationId = conversation.id;
          
          // Set up streaming listener
          let hasStartedStreaming = false;
          const unlisten = await ai.onStreamChunk(conversationId, (chunk) => {
            if (chunk.content) {
              // Clear thinking status once we start receiving content
              if (!hasStartedStreaming) {
                hasStartedStreaming = true;
                set({ thinkingStatus: null });
              }
              responseContent += chunk.content;
              // Update the message as chunks come in
              set((state) => {
                const conv = state.activeConversation;
                if (!conv) return state;
                
                const existingMessages = conv.messages;
                const lastMessage = existingMessages[existingMessages.length - 1];
                
                // Clean web operation tags from displayed content during streaming
                const displayContent = cleanWebOperationTags(responseContent);
                
                let updatedMessages;
                if (lastMessage?.role === 'assistant') {
                  // Update existing assistant message
                  updatedMessages = existingMessages.map((m, i) =>
                    i === existingMessages.length - 1
                      ? { ...m, content: displayContent }
                      : m
                  );
                } else {
                  // Add new assistant message
                  updatedMessages = [
                    ...existingMessages,
                    {
                      id: crypto.randomUUID(),
                      role: 'assistant' as const,
                      content: displayContent,
                      timestamp: new Date().toISOString(),
                    },
                  ];
                }
                
                const updatedConversation = {
                  ...conv,
                  messages: updatedMessages,
                  title: conv.messages.length <= 2 ? content.slice(0, 50) : conv.title,
                  updatedAt: new Date().toISOString(),
                };
                
                return {
                  activeConversation: updatedConversation,
                  conversations: state.conversations.map((c) =>
                    c.id === conv.id ? updatedConversation : c
                  ),
                };
              });
            }
            
            if (chunk.done) {
              // Check for web operations in the response (all modes)
              const { agentMode: currentMode } = get();
              const webOps = parseWebOperations(responseContent);
              
              if (webOps.length > 0) {
                // Clean web operation tags from the displayed content
                const cleanedContent = cleanWebOperationTags(responseContent);
                
                // Update assistant message to show cleaned content
                set((state) => {
                  const conv = state.activeConversation;
                  if (!conv) return state;
                  
                  const existingMessages = conv.messages;
                  const lastMessage = existingMessages[existingMessages.length - 1];
                  
                  if (lastMessage?.role === 'assistant') {
                    const updatedMessages = existingMessages.map((m, i) =>
                      i === existingMessages.length - 1
                        ? { ...m, content: cleanedContent }
                        : m
                    );
                    
                    return {
                      activeConversation: { ...conv, messages: updatedMessages },
                      conversations: state.conversations.map((c) =>
                        c.id === conv.id ? { ...conv, messages: updatedMessages } : c
                      ),
                    };
                  }
                  return state;
                });
                
                // Create and set traces for web operations
                const traces = createWebAccessTraces(webOps);
                get().setWebAccessTraces(traces);
                set({ thinkingStatus: 'Accessing the web...' });
                
                // Execute web operations with trace updates
                executeWebOperationsWithTraces(
                  webOps, 
                  traces, 
                  get().setWebAccessTraces,
                  get().setWebAccessStatus
                ).then(async (webResults) => {
                  // Helper to append web results directly to the message
                  const appendWebResultsToMessage = (results: string) => {
                    const finalContent = cleanedContent.trim() 
                      ? `${cleanedContent.trim()}\n\n${results}`
                      : results;
                    
                    set((state) => {
                      const currentConv = state.activeConversation;
                      if (!currentConv) return state;
                      
                      const existingMessages = currentConv.messages;
                      const lastMessage = existingMessages[existingMessages.length - 1];
                      
                      if (lastMessage?.role === 'assistant') {
                        const updatedMessages = existingMessages.map((m, i) =>
                          i === existingMessages.length - 1
                            ? { ...m, content: finalContent }
                            : m
                        );
                        
                        return {
                          activeConversation: { ...currentConv, messages: updatedMessages },
                          conversations: state.conversations.map((c) =>
                            c.id === currentConv.id ? { ...currentConv, messages: updatedMessages } : c
                          ),
                        };
                      }
                      return state;
                    });
                  };
                  
                  // Continue the conversation internally with web results
                  set({ thinkingStatus: 'Processing web results...' });
                  
                  try {
                    const { ai } = await import('../services/tauri');
                    const conv = get().activeConversation;
                    if (!conv) {
                      // Fallback: append results directly
                      appendWebResultsToMessage(webResults);
                      set({ isStreaming: false, thinkingStatus: null });
                      get().clearWebAccessTraces();
                      get().saveWorkspaceHistory();
                      return;
                    }
                    
                    // Build continuation messages with web results as context
                    const continuationMessages = [
                      { role: 'system', content: systemPrompt, attachments: undefined },
                      ...conv.messages.slice(0, -1).map(m => ({
                        role: m.role,
                        content: m.content,
                        attachments: m.attachments,
                      })),
                      // Include the cleaned assistant response so far
                      { role: 'assistant', content: cleanedContent, attachments: undefined },
                      // Add web results as context for continuation
                      { role: 'user', content: `Here are the web results you requested:\n\n${webResults}\n\nNow please provide your complete response based on this information. Format the data nicely in a table or list. Do not repeat the web access tags.`, attachments: undefined },
                    ];
                    
                    // Track content for the continuation
                    let continuationContent = cleanedContent ? cleanedContent.trim() + '\n\n' : '';
                    let hasReceivedContent = false;
                    
                    // Set up listener for continuation with timeout
                    const timeoutMs = 15000;
                    let timeoutId: ReturnType<typeof setTimeout>;
                    
                    const contUnlisten = await ai.onStreamChunk(conversationId, (contChunk) => {
                      if (contChunk.content) {
                        hasReceivedContent = true;
                        clearTimeout(timeoutId);
                        continuationContent += contChunk.content;
                        
                        // Clean any web operation tags from continuation content
                        const displayContinuationContent = cleanWebOperationTags(continuationContent);
                        
                        // Update the assistant message with continued content
                        set((state) => {
                          const currentConv = state.activeConversation;
                          if (!currentConv) return state;
                          
                          const existingMessages = currentConv.messages;
                          const lastMessage = existingMessages[existingMessages.length - 1];
                          
                          if (lastMessage?.role === 'assistant') {
                            const updatedMessages = existingMessages.map((m, i) =>
                              i === existingMessages.length - 1
                                ? { ...m, content: displayContinuationContent }
                                : m
                            );
                            
                            return {
                              activeConversation: { ...currentConv, messages: updatedMessages },
                              conversations: state.conversations.map((c) =>
                                c.id === currentConv.id ? { ...currentConv, messages: updatedMessages } : c
                              ),
                            };
                          }
                          return state;
                        });
                      }
                      
                      if (contChunk.done) {
                        clearTimeout(timeoutId);
                        // If no content was received, append web results directly
                        if (!hasReceivedContent) {
                          appendWebResultsToMessage(webResults);
                        }
                        set({ isStreaming: false, thinkingStatus: null });
                        get().clearWebAccessTraces();
                        get().saveWorkspaceHistory();
                        
                        // Advance agent task if needed
                        const { agentTasks, agentTaskIndex } = get();
                        if (currentMode === 'agent' && agentTasks.length > 0 && agentTaskIndex >= 0) {
                          get().advanceAgentTask();
                        }
                      }
                    });
                    
                    // Set timeout to fallback to direct append if continuation takes too long
                    timeoutId = setTimeout(() => {
                      if (!hasReceivedContent) {
                        console.log('[aiStore] Continuation timeout, appending results directly');
                        appendWebResultsToMessage(webResults);
                        set({ isStreaming: false, thinkingStatus: null });
                        get().clearWebAccessTraces();
                        get().saveWorkspaceHistory();
                        contUnlisten();
                      }
                    }, timeoutMs);
                    
                    // Make continuation API call
                    if (config.provider === 'ollama') {
                      await ai.chatOllama(
                        config.baseUrl || 'http://localhost:11434',
                        config.model,
                        continuationMessages,
                        config.temperature,
                        config.maxTokens,
                        conversationId
                      );
                    } else if (config.provider === 'copilot') {
                      await ai.chatCopilot(
                        config.model,
                        continuationMessages,
                        config.temperature,
                        config.maxTokens,
                        conversationId
                      );
                    } else if (config.provider === 'openai' || config.provider === 'claude' || config.provider === 'custom') {
                      const baseUrl = config.provider === 'openai' 
                        ? 'https://api.openai.com/v1'
                        : config.provider === 'claude'
                        ? 'https://api.anthropic.com/v1'
                        : config.baseUrl || '';
                      
                      await ai.chatOpenAI(
                        baseUrl,
                        config.apiKey || '',
                        config.model,
                        continuationMessages,
                        config.temperature,
                        config.maxTokens,
                        conversationId
                      );
                    }
                    
                    clearTimeout(timeoutId);
                    contUnlisten();
                  } catch (error) {
                    console.error('[aiStore] Web continuation failed:', error);
                    // Fallback: append web results directly to message
                    appendWebResultsToMessage(webResults);
                    set({ isStreaming: false, thinkingStatus: null });
                    get().clearWebAccessTraces();
                    get().saveWorkspaceHistory();
                  }
                }).catch((error) => {
                  console.error('[aiStore] Web operations failed:', error);
                  set({ isStreaming: false, thinkingStatus: null });
                  get().clearWebAccessTraces();
                  get().saveWorkspaceHistory();
                });
              } else {
                set({ isStreaming: false, thinkingStatus: null });
                // Auto-save when streaming completes
                get().saveWorkspaceHistory();

                // Advance agent task progress when a response completes in agent mode
                const { agentTasks, agentTaskIndex } = get();
                if (currentMode === 'agent' && agentTasks.length > 0 && agentTaskIndex >= 0) {
                  get().advanceAgentTask();
                }

                // Process next queued prompt if any
                const { promptQueue } = get();
                if (promptQueue.length > 0) {
                  const [nextPrompt, ...remaining] = promptQueue;
                  set({ promptQueue: remaining });
                  setTimeout(() => get().sendMessage(nextPrompt), 100);
                }
              }
            }
          });

          // Update thinking status before API call
          const providerLabel = config.provider === 'ollama'
            ? 'Ollama'
            : config.provider === 'copilot'
            ? 'GitHub Copilot'
            : config.provider;
          set({ thinkingStatus: `Connecting to ${providerLabel}...` });

          let copilotModel = config.model;
          if (config.provider === 'copilot') {
            try {
              const models = get().availableModels.copilot;
              if (models.length === 0) {
                const freshModels = await ai.listCopilotModels();
                if (freshModels.length > 0) {
                  const uniqueModels = Array.from(new Set(freshModels));
                  const selectedModel = uniqueModels.includes(copilotModel) ? copilotModel : uniqueModels[0];
                  set((state) => ({
                    availableModels: {
                      ...state.availableModels,
                      copilot: uniqueModels,
                    },
                    config: {
                      ...state.config,
                      model: uniqueModels.includes(state.config.model)
                        ? state.config.model
                        : selectedModel,
                    },
                  }));
                  copilotModel = selectedModel;
                }
              } else if (!models.includes(copilotModel)) {
                copilotModel = models[0];
                set((state) => ({
                  config: {
                    ...state.config,
                    model: copilotModel,
                  },
                }));
              }
              
              // Vision model selection is handled right before the API call
            } catch (error) {
              console.warn('Failed to refresh Copilot models:', error);
            }
          }

          // Call the appropriate AI backend
          if (config.provider === 'ollama') {
            set({ thinkingStatus: `Waiting for ${config.model} to respond...` });
            await ai.chatOllama(
              config.baseUrl || 'http://localhost:11434',
              config.model,
              messages,
              config.temperature,
              config.maxTokens,
              conversationId
            );
          } else if (config.provider === 'copilot') {
            let finalModel = copilotModel;
            if (hasImageAttachments) {
              const visionModels = get().copilotVisionModels;
              if (visionModels.includes(copilotModel)) {
                // User's selected model supports vision — use it as-is
                console.log(`[aiStore] VISION: User model ${copilotModel} supports vision, using it`);
              } else if (visionModels.length > 0) {
                // Fall back to gpt-4o variant or first known vision model
                const preferred = visionModels.find(m => m.startsWith('gpt-4o'))
                  ?? visionModels.find(m => m.startsWith('gpt-4'))
                  ?? visionModels[0];
                finalModel = preferred;
                console.log(`[aiStore] VISION: ${copilotModel} not in vision list, switching to ${finalModel}`);
              } else {
                console.warn('[aiStore] Vision models list empty — using selected model');
              }
            }
            set({ thinkingStatus: 'Waiting for GitHub Copilot to respond...' });
            await ai.chatCopilot(
              finalModel,
              messages,
              config.temperature,
              config.maxTokens,
              conversationId
            );
          } else if (config.provider === 'openai' || config.provider === 'claude' || config.provider === 'custom') {
            const providerName = config.provider === 'openai' ? 'OpenAI' : config.provider === 'claude' ? 'Claude' : 'API';
            set({ thinkingStatus: `Waiting for ${providerName} to respond...` });
            
            const baseUrl = config.provider === 'openai' 
              ? 'https://api.openai.com/v1'
              : config.provider === 'claude'
              ? 'https://api.anthropic.com/v1'
              : config.baseUrl || '';
            
            await ai.chatOpenAI(
              baseUrl,
              config.apiKey || '',
              config.model,
              messages,
              config.temperature,
              config.maxTokens,
              conversationId
            );
          }

          // Cleanup listener
          unlisten();
          set({ isStreaming: false, thinkingStatus: null });
          
        } catch (error) {
          const errorText = formatAIError(error);
          console.error('Failed to send message:', errorText);
          
          // Add error message
          const errorMessage: AIMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${errorText}`,
            timestamp: new Date().toISOString(),
          };
          
          set((state) => {
            const conv = state.activeConversation;
            if (!conv) return { ...state, isStreaming: false };
            
            const updatedConversation = {
              ...conv,
              messages: [...conv.messages, errorMessage],
              updatedAt: new Date().toISOString(),
            };
            
            return {
              activeConversation: updatedConversation,
              conversations: state.conversations.map((c) =>
                c.id === conv.id ? updatedConversation : c
              ),
              isStreaming: false,
              thinkingStatus: null,
            };
          });
          // Auto-save after error
          get().saveWorkspaceHistory();

          // Advance agent task (mark as skipped on error) and move on
          const { agentMode: currentMode, agentTasks, agentTaskIndex } = get();
          if (currentMode === 'agent' && agentTasks.length > 0 && agentTaskIndex >= 0) {
            get().advanceAgentTask();
          }

          // Process next queued prompt if any
          const { promptQueue } = get();
          if (promptQueue.length > 0) {
            const [nextPrompt, ...remaining] = promptQueue;
            set({ promptQueue: remaining });
            setTimeout(() => get().sendMessage(nextPrompt), 100);
          }
        }
      },

      queuePrompt: (content: string) => {
        set((state) => ({
          promptQueue: [...state.promptQueue, content],
        }));
      },

      clearQueue: () => {
        set({ promptQueue: [] });
      },

      stopStreaming: () => {
        set({ isStreaming: false, thinkingStatus: null });
        // Call the backend to stop streaming
        import('../services/tauri').then(({ ai }) => {
          ai.stopStream().catch((err) => console.error('Failed to stop stream:', err));
        });
        // Process next queued prompt if any
        const { promptQueue } = get();
        if (promptQueue.length > 0) {
          const [nextPrompt, ...remaining] = promptQueue;
          set({ promptQueue: remaining });
          setTimeout(() => get().sendMessage(nextPrompt), 100);
        }
      },

      clearConversation: () => {
        set((state) => {
          if (!state.activeConversation) return state;
          const updatedConversation = {
            ...state.activeConversation,
            messages: [],
            updatedAt: new Date().toISOString(),
          };
          return {
            activeConversation: updatedConversation,
            conversations: state.conversations.map((c) =>
              c.id === state.activeConversation!.id ? updatedConversation : c
            ),
          };
        });
        // Auto-save after clearing
        get().saveWorkspaceHistory();
      },

      refreshAvailableModels: async () => {
        const { config } = get();
        if (config.provider === 'ollama') {
          try {
            const { ai } = await import('../services/tauri');
            const models = await ai.listOllamaModels(config.baseUrl);
            set((state) => ({
              availableModels: {
                ...state.availableModels,
                ollama: models.map(m => m.name),
              },
              config: {
                ...state.config,
                model: models.length > 0 && !models.find(m => m.name === state.config.model)
                  ? models[0].name
                  : state.config.model,
              },
            }));
          } catch (error) {
            console.error('Failed to fetch Ollama models:', error);
          }
        } else if (config.provider === 'copilot') {
          try {
            const { ai } = await import('../services/tauri');
            // Fetch all models and vision-capable models in parallel
            const [models, visionModels] = await Promise.all([
              ai.listCopilotModels(),
              ai.listCopilotVisionModels().catch(() => [] as string[]),
            ]);
            const uniqueModels = Array.from(new Set(models));
            if (uniqueModels.length === 0) {
              return;
            }
            console.log('[aiStore] Copilot vision models:', visionModels);
            set((state) => ({
              availableModels: {
                ...state.availableModels,
                copilot: uniqueModels,
              },
              copilotVisionModels: visionModels,
              config: {
                ...state.config,
                model: uniqueModels.includes(state.config.model)
                  ? state.config.model
                  : uniqueModels[0],
              },
            }));
          } catch (error) {
            console.error('Failed to fetch Copilot models:', error);
          }
        }
      },

      importConversationsFromPath: async (sourcePath: string) => {
        try {
          const storageDir = await getWorkspaceStorageDir(sourcePath);
          const historyPath = `${storageDir}/${AI_HISTORY_FILE}`;
          const exists = await fs.pathExists(historyPath);
          
          if (!exists) {
            return { imported: 0, error: 'No AI history found in the selected project' };
          }
          
          const content = await fs.readFile(historyPath);
          const data = JSON.parse(content);
          const importedConversations: AIConversation[] = data.conversations || [];
          
          if (importedConversations.length === 0) {
            return { imported: 0, error: 'No conversations found in the selected project' };
          }
          
          // Generate new IDs for imported conversations to avoid conflicts
          const existingIds = new Set(get().conversations.map(c => c.id));
          const conversationsToImport = importedConversations.map(conv => {
            let newId = conv.id;
            while (existingIds.has(newId)) {
              newId = crypto.randomUUID();
            }
            existingIds.add(newId);
            return {
              ...conv,
              id: newId,
              title: conv.title ? `[Imported] ${conv.title}` : '[Imported] New Conversation',
            };
          });
          
          set((state) => ({
            conversations: [...conversationsToImport, ...state.conversations],
          }));
          
          // Save after import
          get().saveWorkspaceHistory();
          
          return { imported: conversationsToImport.length };
        } catch (error) {
          console.error('Failed to import conversations:', error);
          return { imported: 0, error: error instanceof Error ? error.message : 'Failed to import' };
        }
      },

      exportConversation: async (conversationId: string) => {
        const conversation = get().conversations.find(c => c.id === conversationId);
        if (!conversation) return null;
        
        return JSON.stringify(conversation, null, 2);
      },

      markFileOperationsAsKept: (operationIds: string[]) => {
        set((state) => {
          const conv = state.activeConversation;
          if (!conv) return state;

          const existingKept = conv.appliedFileOps || [];
          const newKept = [...new Set([...existingKept, ...operationIds])];

          const updatedConversation = {
            ...conv,
            appliedFileOps: newKept,
            updatedAt: new Date().toISOString(),
          };

          return {
            activeConversation: updatedConversation,
            conversations: state.conversations.map((c) =>
              c.id === conv.id ? updatedConversation : c
            ),
          };
        });
        // Auto-save after marking operations
        get().saveWorkspaceHistory();
      },

      isFileOperationKept: (operationId: string) => {
        const conv = get().activeConversation;
        if (!conv || !conv.appliedFileOps) return false;
        return conv.appliedFileOps.includes(operationId);
      },

      addMCPServer: (config: MCPServerConfig) => {
        set((state) => ({
          config: {
            ...state.config,
            mcpServers: [...(state.config.mcpServers || []), config],
          },
        }));
      },

      removeMCPServer: (serverId: string) => {
        set((state) => ({
          config: {
            ...state.config,
            mcpServers: (state.config.mcpServers || []).filter((s) => s.id !== serverId),
          },
          mcpServerStates: (state.mcpServerStates || []).filter((s) => s.id !== serverId),
        }));
      },

      updateMCPServer: (serverId: string, updates: Partial<MCPServerConfig>) => {
        set((state) => ({
          config: {
            ...state.config,
            mcpServers: (state.config.mcpServers || []).map((s) =>
              s.id === serverId ? { ...s, ...updates } : s
            ),
          },
        }));
      },

      startMCPServer: async (serverId: string) => {
        const config = (get().config.mcpServers || []).find((s) => s.id === serverId);
        if (!config) {
          throw new Error(`MCP server ${serverId} not found`);
        }

        set((state) => ({
          mcpServerStates: [
            ...(state.mcpServerStates || []).filter((s) => s.id !== serverId),
            { id: serverId, name: config.name, status: 'starting', tools: [] },
          ],
        }));

        try {
          const tools = await mcp.startServer(config);
          set((state) => ({
            mcpServerStates: (state.mcpServerStates || []).map((s) =>
              s.id === serverId ? { ...s, status: 'running', tools } : s
            ),
          }));
          console.log(`[aiStore] MCP server ${serverId} started with ${tools.length} tools`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          set((state) => ({
            mcpServerStates: (state.mcpServerStates || []).map((s) =>
              s.id === serverId ? { ...s, status: 'error', error: errorMsg } : s
            ),
          }));
          throw error;
        }
      },

      stopMCPServer: async (serverId: string) => {
        try {
          await mcp.stopServer(serverId);
          set((state) => ({
            mcpServerStates: (state.mcpServerStates || []).map((s) =>
              s.id === serverId ? { ...s, status: 'stopped', tools: [] } : s
            ),
          }));
          console.log(`[aiStore] MCP server ${serverId} stopped`);
        } catch (error) {
          console.error(`[aiStore] Failed to stop MCP server ${serverId}:`, error);
          throw error;
        }
      },

      callMCPTool: async (serverId: string, toolName: string, args: Record<string, unknown>) => {
        console.log(`[aiStore] Calling MCP tool ${toolName} on ${serverId}`);
        return mcp.callTool(serverId, toolName, args);
      },
    }),
    {
      name: 'opencodebrew-ai',
      partialize: (state) => ({
        config: state.config,
        // Conversations are stored per-workspace in the app data dir
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AIState>;
        
        // Migration: fix old MCP package names
        const packageMigrations: Record<string, string> = {
          '@anthropic-ai/mcp-server-brave-search': '@modelcontextprotocol/server-brave-search',
          '@anthropic-ai/mcp-server-filesystem': '@modelcontextprotocol/server-filesystem',
          '@anthropic-ai/mcp-server-github': '@modelcontextprotocol/server-github',
        };
        
        const migrateServerArgs = (server: MCPServerConfig): MCPServerConfig => {
          const newArgs = server.args.map(arg => packageMigrations[arg] || arg);
          if (newArgs.some((arg, i) => arg !== server.args[i])) {
            console.log(`[aiStore] Migrating MCP package names for ${server.id}`);
          }
          return { ...server, args: newArgs };
        };
        
        // Merge MCP servers: keep user customizations but ensure all default servers are present
        const defaultServers = currentState.config.mcpServers;
        const persistedServers = (persisted.config?.mcpServers || []).map(migrateServerArgs);
        
        // Start with default servers, then overlay any persisted customizations
        const mergedServers = defaultServers.map(defaultServer => {
          const persistedServer = persistedServers.find(s => s.id === defaultServer.id);
          if (persistedServer) {
            // Keep user's customizations (enabled state, env vars, etc.)
            return { ...defaultServer, ...persistedServer };
          }
          return defaultServer;
        });
        
        // Add any custom (non-default) servers the user created
        const defaultIds = new Set(defaultServers.map(s => s.id));
        const customServers = persistedServers.filter(s => !defaultIds.has(s.id));
        
        return {
          ...currentState,
          ...persisted,
          mcpServerStates: currentState.mcpServerStates || [],
          config: {
            ...currentState.config,
            ...persisted.config,
            mcpServers: [...mergedServers, ...customServers],
          },
        };
      },
    }
  )
);
