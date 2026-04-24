import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, StopCircle, Copy, Check, Globe, TrendingUp } from 'lucide-react';
import { useNotesStore, Message } from '../store/notesStore';
import styles from './ChatPanel.module.css';

const SETTINGS_KEY = 'opencodebrew-notes-settings';

interface AISettings {
  aiProvider: 'ollama' | 'openai' | 'anthropic' | 'copilot' | 'custom';
  model: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  customBaseUrl: string;
  customApiKey: string;
  temperature: number;
  maxTokens: number;
  mcpServers?: MCPServerConfig[];
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
}

interface MarketMovers {
  gainers: StockQuote[];
  losers: StockQuote[];
  most_active: StockQuote[];
}

interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  is_error: boolean;
}

interface MCPServerState {
  id: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  tools: MCPTool[];
  error?: string;
}

// Global MCP server states for Notes app
let mcpServerStates: MCPServerState[] = [];

function migrateMCPSettings(settings: AISettings): AISettings {
  if (!settings.mcpServers) return settings;
  
  // Fix old package names
  const packageMigrations: Record<string, string> = {
    '@anthropic-ai/mcp-server-brave-search': '@modelcontextprotocol/server-brave-search',
    '@anthropic-ai/mcp-server-filesystem': '@modelcontextprotocol/server-filesystem',
    '@anthropic-ai/mcp-server-github': '@modelcontextprotocol/server-github',
  };
  
  let migrated = false;
  const migratedServers = settings.mcpServers.map(server => {
    const newArgs = server.args.map(arg => {
      if (packageMigrations[arg]) {
        migrated = true;
        console.log(`[Notes] Migrating MCP package: ${arg} -> ${packageMigrations[arg]}`);
        return packageMigrations[arg];
      }
      return arg;
    });
    return { ...server, args: newArgs };
  });
  
  if (migrated) {
    const newSettings = { ...settings, mcpServers: migratedServers };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
    console.log('[Notes] MCP settings migrated and saved');
    return newSettings;
  }
  
  return settings;
}

function getAISettings(): AISettings {
  const defaults: AISettings = {
    aiProvider: 'ollama',
    model: 'gemma4:latest',
    ollamaUrl: 'http://localhost:11434',
    openaiKey: '',
    anthropicKey: '',
    customBaseUrl: '',
    customApiKey: '',
    temperature: 0.7,
    maxTokens: 4096,
  };
  
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const settings = { ...defaults, ...JSON.parse(stored) };
      return migrateMCPSettings(settings);
    }
  } catch (e) {
    console.error('Failed to load AI settings:', e);
  }
  return defaults;
}

function getWebAccessSystemPrompt(): string {
  const now = new Date();
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const timestamp = now.toISOString();
  const shortDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `You are a helpful AI assistant with web access and real-time market data capabilities.

**CURRENT DATE/TIME:** ${today} (${timestamp})

## CRITICAL OUTPUT FORMAT

**ALL internal reasoning MUST be wrapped in <think>...</think> tags.** Only content OUTSIDE these tags is shown to the user.
- NEVER output reasoning, analysis, or "I will/need/should" statements outside of <think> tags
- NEVER mention tool names or XML syntax outside of <think> tags
- Go directly from <think> to the tool tag, then to your response

**Example - CORRECT:**
<think>User wants AMD stock price. I'll fetch it.</think>
<get_stock_quote symbol="AMD" />
Here's the current price for AMD...

**Example - WRONG (never do this):**
The user is asking for AMD. I will use the get_stock_quote tool.
<get_stock_quote symbol="AMD" />

CRITICAL: When searching for news or current events, ALWAYS include today's date "${shortDate}" or "today" in your search queries to get the most recent results. Do NOT rely on cached or outdated information.

## DATA ACCESS TOOLS

You have access to real-time market data and web search. **TO USE A TOOL, YOU MUST OUTPUT THE XML TAG EXACTLY AS SHOWN BELOW.**

Write the XML tags directly — do NOT describe them.

**Get stock/futures quote (via Yahoo Finance MCP):**
<get_stock_quote symbol="AAPL" />

**Get market movers (top gainers, losers, most active):**
<get_market_movers />

**Search the web (ALWAYS include current date for news):**
<search_web query="your search query ${shortDate}" />

### SYMBOL REFERENCE:
- **Stocks**: Use ticker symbols (AAPL, MSFT, GOOGL, TSLA, NVDA, AMD, etc.)
- **Index Futures**: ES=F (S&P 500), NQ=F (Nasdaq 100), YM=F (Dow Jones), RTY=F (Russell 2000)
- **Commodities**: GC=F (Gold), SI=F (Silver), CL=F (Crude Oil), NG=F (Natural Gas)
- **Crypto**: BTC-USD (Bitcoin), ETH-USD (Ethereum)
- **Indices**: ^GSPC (S&P 500), ^IXIC (Nasdaq), ^DJI (Dow Jones)

### DATA SOURCES:
Stock quotes are fetched from Google Finance (e.g., https://www.google.com/finance/quote/AMD:NASDAQ)
The data includes: price, change amount, and change percentage.

### ERROR HANDLING:
If a stock symbol is not found, inform the user and ask them to verify the ticker symbol.
Common issues: typos, delisted stocks, or using wrong exchange.

### FOR MARKET FUTURES REQUESTS:
When asked about market futures or pre-market data, get quotes for these futures:
<get_stock_quote symbol="ES=F" />
<get_stock_quote symbol="NQ=F" />
<get_stock_quote symbol="YM=F" />

### URL HANDLING:
When the user pastes a URL, I will automatically fetch its content and include it below the message.
You can then summarize, analyze, or use that content as requested.

### IMPORTANT RULES:
1. ALWAYS use tools for real-time data - never say you can't access it
2. For futures/pre-market: use multiple <get_stock_quote> calls with futures symbols
3. For market overview: use <get_market_movers /> to get top movers
4. Multiple tool calls in one response are encouraged for comprehensive data
5. When URL content is provided, summarize or process it as the user requests

### MULTI-TURN RULE:
Even if you already fetched data earlier, if the user asks another question about real-time data, **you MUST output the XML tag again**. Do NOT reference previous tool calls. Do NOT say "as mentioned before". Output the fresh XML tag for every new data request.
`;
}

function getSummarizationPrompt(): string {
  return `You are a helpful AI assistant. Summarize the following web search results or data concisely.

INSTRUCTIONS:
1. Provide a clear, informative summary of the key information
2. For news articles: summarize the main points and include relevant links at the end
3. For stock/market data: present in a clean table format with key metrics
4. Keep the summary focused and easy to read
5. Include source links in markdown format: [Source Name](url)
6. Don't just list the results - synthesize and summarize them
7. Use bullet points for multiple key takeaways

FORMAT FOR NEWS:
- Brief summary paragraph
- Key takeaways as bullet points
- "Sources:" section with linked article titles`;
}

interface WebOperation {
  type: 'search_web' | 'get_stock_quote' | 'get_market_movers';
  query?: string;
  symbol?: string;
}

function parseWebOperations(content: string): WebOperation[] {
  const operations: WebOperation[] = [];
  
  // Match double-quoted queries (allows apostrophes inside)
  const searchRegexDouble = /<search_web\s+query="([^"]+)"[^>]*\/?>/gi;
  // Match single-quoted queries (allows double quotes inside)  
  const searchRegexSingle = /<search_web\s+query='([^']+)'[^>]*\/?>/gi;
  
  let match;
  while ((match = searchRegexDouble.exec(content)) !== null) {
    operations.push({ type: 'search_web', query: match[1] });
  }
  while ((match = searchRegexSingle.exec(content)) !== null) {
    operations.push({ type: 'search_web', query: match[1] });
  }
  
  // Same for stock quotes
  const stockQuoteRegexDouble = /<get_stock_quote\s+symbol="([^"]+)"[^>]*\/?>/gi;
  const stockQuoteRegexSingle = /<get_stock_quote\s+symbol='([^']+)'[^>]*\/?>/gi;
  
  while ((match = stockQuoteRegexDouble.exec(content)) !== null) {
    operations.push({ type: 'get_stock_quote', symbol: match[1] });
  }
  while ((match = stockQuoteRegexSingle.exec(content)) !== null) {
    operations.push({ type: 'get_stock_quote', symbol: match[1] });
  }
  
  const marketMoversRegex = /<get_market_movers[^>]*\/?>/gi;
  while ((match = marketMoversRegex.exec(content)) !== null) {
    operations.push({ type: 'get_market_movers' });
  }
  
  console.log('[Notes] Parsed web operations:', operations, 'from content length:', content.length);
  return operations.slice(0, 5);
}

/** Fallback: detect tool intent in model text (e.g., "I will call the get_stock_quote tool") */
function parseWebOperationsFromIntent(content: string): WebOperation[] {
  const operations: WebOperation[] = [];

  // Detect "I will call/use X tool" patterns
  if (/will call the?\s*`?get_stock_quote`? tool|need to use the?\s*`?get_stock_quote`? tool|will fetch the?\s*`?get_stock_quote`? tool|will use the?\s*`?get_stock_quote`? tool/i.test(content)) {
    operations.push({ type: 'get_stock_quote', symbol: 'AMD' });
  }
  if (/will call the?\s*`?get_market_movers`? tool|need to use the?\s*`?get_market_movers`? tool/i.test(content)) {
    operations.push({ type: 'get_market_movers' });
  }
  if (/will call the?\s*`?search_web`? tool|need to use the?\s*`?search_web`? tool/i.test(content)) {
    operations.push({ type: 'search_web', query: 'web search' });
  }

  // Detect "I need to get quotes for X and Y" or similar symbol lists
  const quoteMatch = content.match(/(?:quotes?|prices?)\s*(?:for|of|on)\s*([A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5}|\s*and\s*[A-Z]{2,5})*)/i);
  if (quoteMatch && !operations.find(o => o.type === 'get_stock_quote')) {
    const symbols = quoteMatch[1].replace(/\s*,\s*/g, ' ').split(/\s+and\s+/).map(s => s.trim().toUpperCase());
    symbols.forEach(s => {
      if (/^[A-Z]{2,5}$/.test(s)) {
        operations.push({ type: 'get_stock_quote', symbol: s });
      }
    });
  }

  // Detect "search for X" or "search X price" patterns with symbols
  const searchMatch = content.match(/(?:search|find|look up)\s+(?:for\s+)?(?:the\s+)?(?:price|current|stock|quote)\s+(?:of|for)\s*([A-Z]{2,5}(?:\s*and\s*[A-Z]{2,5})*)/i);
  if (searchMatch && !operations.find(o => o.type === 'get_stock_quote')) {
    const symbols = searchMatch[1].split(/\s+and\s+/).map(s => s.trim().toUpperCase());
    symbols.forEach(s => {
      if (/^[A-Z]{2,5}$/.test(s)) {
        operations.push({ type: 'get_stock_quote', symbol: s });
      }
    });
  }

  // Detect direct "get price for X" or "get quote of Y"
  const symbolDirect = content.match(/get\s+(?:price|quote|stock|data)\s+(?:for|of)\s*([A-Z]{2,5})/gi);
  if (symbolDirect) {
    symbolDirect.forEach(match => {
      const sym = match.match(/[A-Z]{2,5}/)?.[0];
      if (sym && !operations.find(o => o.type === 'get_stock_quote' && o.symbol === sym)) {
        operations.push({ type: 'get_stock_quote', symbol: sym });
      }
    });
  }

  if (operations.length > 0) {
    console.log('[Notes] Parsed web operations from intent:', operations);
  }

  return operations.slice(0, 5);
}

function cleanWebOperationTags(content: string): string {
  return content
    // Extract content inside <think>...</think> blocks (strip tags, keep text)
    .replace(/<think>([\s\S]*?)<\/think>/gi, '$1')
    // Remove all variations of tool XML tags
    .replace(/<search_web[^>]*\/?>/gi, '')
    .replace(/<get_stock_quote[^>]*\/?>/gi, '')
    .replace(/<get_market_movers[^>]*\/?>/gi, '')
    .replace(/<fetch_url[^>]*\/?>/gi, '')
    // Remove tool mentions in backticks (e.g., `<get_stock_quote>`)
    .replace(/`<(?:search_web|get_stock_quote|get_market_movers|fetch_url)[^`]*>`/gi, 'the tool')
    .trim();
}

function cleanThinkingFromResponse(content: string): string {
  return content
    // Remove <think>...</think> blocks
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove "Thinking Process:" sections until we hit actual response content
    .replace(/\*?\*?Thinking Process:?\*?\*?[\s\S]*?(?=Based on|Here is|Here's|The current|In summary|To summarize|##|$)/gi, '')
    // Remove numbered/bulleted reasoning steps
    .replace(/^[\s]*[\d]+\.\s*\*?\*?(?:Analyze|Determine|Extract|Format|Review|Final|Identify|Consider|Check|Evaluate)[^\n]*(?:\n(?!Based on|Here|In summary|##)[^\n]*)*\n?/gim, '')
    // Remove lines starting with reasoning patterns
    .replace(/^[\s]*[-•*]?\s*(?:Analyze the|Determine|Extract Data|Format the|Review|Final Polish|I will|I need|I should|Let me)[^\n]*\n?/gim, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function separateThinkingContent(content: string): { thinking: string; response: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinking = '';
  let response = content;
  
  let match;
  while ((match = thinkRegex.exec(content)) !== null) {
    thinking += match[1] + '\n';
  }
  
  response = response.replace(thinkRegex, '').trim();
  return { thinking: thinking.trim(), response };
}

function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return 'No search results found.';
  
  let formatted = '**Web Search Results:**\n\n';
  results.forEach((result, i) => {
    formatted += `${i + 1}. **[${result.title}](${result.url})**\n`;
    formatted += `   ${result.snippet}\n\n`;
  });
  return formatted;
}

function formatStockQuote(quote: StockQuote): string {
  const changeSign = quote.change >= 0 ? '+' : '';
  const emoji = quote.change >= 0 ? '🟢' : '🔴';
  return `**${quote.symbol}** (${quote.name})
- Price: $${quote.price.toFixed(2)}
- Change: ${emoji} ${changeSign}$${quote.change.toFixed(2)} (${changeSign}${quote.change_percent.toFixed(2)}%)
- Volume: ${quote.volume.toLocaleString()}`;
}

function formatMarketMovers(movers: MarketMovers): string {
  let result = '## 📈 Market Movers\n\n';
  
  result += '### Top Gainers:\n';
  result += '| Symbol | Price | Change |\n|--------|-------|--------|\n';
  movers.gainers.slice(0, 5).forEach((stock) => {
    result += `| **${stock.symbol}** | $${stock.price.toFixed(2)} | +${stock.change_percent.toFixed(2)}% |\n`;
  });
  
  result += '\n### Top Losers:\n';
  result += '| Symbol | Price | Change |\n|--------|-------|--------|\n';
  movers.losers.slice(0, 5).forEach((stock) => {
    result += `| **${stock.symbol}** | $${stock.price.toFixed(2)} | ${stock.change_percent.toFixed(2)}% |\n`;
  });
  
  result += '\n### Most Active:\n';
  result += '| Symbol | Price | Volume |\n|--------|-------|--------|\n';
  movers.most_active.slice(0, 5).forEach((stock) => {
    result += `| **${stock.symbol}** | $${stock.price.toFixed(2)} | ${stock.volume.toLocaleString()} |\n`;
  });
  
  return result;
}

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

async function getListen() {
  const { listen } = await import('@tauri-apps/api/event');
  return listen;
}

// MCP helper functions
async function startMCPServers(settings: AISettings): Promise<void> {
  const invoke = await getInvoke();
  const servers = settings.mcpServers?.filter(s => s.enabled) || [];
  
  for (const server of servers) {
    const existing = mcpServerStates.find(s => s.id === server.id);
    if (existing?.status === 'running') continue;
    
    try {
      console.log(`[Notes MCP] Starting server: ${server.id}`);
      const tools = await invoke<MCPTool[]>('mcp_start_server', { config: server });
      mcpServerStates = mcpServerStates.filter(s => s.id !== server.id);
      mcpServerStates.push({ id: server.id, status: 'running', tools });
      console.log(`[Notes MCP] Server ${server.id} started with ${tools.length} tools`);
    } catch (error) {
      console.error(`[Notes MCP] Failed to start ${server.id}:`, error);
      mcpServerStates = mcpServerStates.filter(s => s.id !== server.id);
      mcpServerStates.push({ id: server.id, status: 'error', tools: [], error: String(error) });
    }
  }
}

async function callMCPTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
  const invoke = await getInvoke();
  return invoke('mcp_call_tool', { serverId, toolName, arguments: args });
}

async function getStockQuoteWithMCP(symbol: string): Promise<StockQuote> {
  const invoke = await getInvoke();
  const symbolUpper = symbol.toUpperCase().trim();
  
  console.log(`[Notes] Getting stock quote for: "${symbolUpper}"`);
  
  // Try web scraping FIRST (faster and more reliable)
  try {
    console.log(`[Notes] Trying web scraping for ${symbolUpper}`);
    const quote = await invoke<StockQuote>('get_stock_quote', { symbol: symbolUpper });
    
    // Verify we got the right symbol back
    if (quote && quote.price > 0) {
      const returnedSymbol = (quote.symbol || '').toUpperCase();
      if (returnedSymbol !== symbolUpper) {
        console.log(`[Notes] Symbol mismatch from web: requested "${symbolUpper}", got "${returnedSymbol}"`);
        throw new Error(`Symbol mismatch: got ${returnedSymbol} instead of ${symbolUpper}`);
      }
      console.log(`[Notes] Got quote from web: $${quote.price} (${quote.change_percent}%)`);
      return quote;
    }
  } catch (webError) {
    console.log(`[Notes] Web scraping failed for ${symbolUpper}:`, webError);
  }
  
  // Fallback to MCP servers only if web failed
  const runningServers = mcpServerStates.filter(s => s.status === 'running');
  
  for (const server of runningServers) {
    const quoteTool = server.tools.find(t => 
      t.name === 'get_quote' || 
      t.name === 'get_stock_quote' || 
      t.name === 'getStockQuote'
    );
    
    if (quoteTool) {
      try {
        console.log(`[Notes MCP] Trying ${server.id} for stock quote: ${symbolUpper}`);
        const result = await callMCPTool(server.id, quoteTool.name, { symbol: symbolUpper });
        
        if (!result.is_error && result.content.length > 0) {
          const text = result.content.find(c => c.type === 'text')?.text;
          if (text) {
            try {
              const data = JSON.parse(text);
              // Verify we got the right symbol
              const returnedSymbol = (data.symbol || '').toUpperCase();
              if (returnedSymbol && returnedSymbol !== symbolUpper) {
                console.log(`[Notes MCP] Symbol mismatch: requested "${symbolUpper}", got "${returnedSymbol}"`);
                continue;
              }
              console.log(`[Notes MCP] Got quote for ${symbolUpper}:`, data);
              return {
                symbol: symbolUpper,
                name: data.shortName || data.longName || data.name || symbolUpper,
                price: data.regularMarketPrice || data.price || 0,
                change: data.regularMarketChange || data.change || 0,
                change_percent: data.regularMarketChangePercent || data.change_percent || data.changePercent || 0,
                volume: data.regularMarketVolume || data.volume || 0,
              };
            } catch {
              console.log(`[Notes MCP] Response not JSON`);
            }
          }
        }
      } catch (error) {
        console.log(`[Notes MCP] Tool call failed:`, error);
      }
    }
  }
  
  // If all else fails, throw error
  throw new Error(`Could not get quote for symbol "${symbolUpper}". Please verify the ticker symbol is correct.`);
}

async function getMarketMoversWithMCP(): Promise<MarketMovers> {
  const invoke = await getInvoke();
  
  // Try web scraping FIRST (faster)
  try {
    console.log(`[Notes] Trying web scraping for market movers`);
    const movers = await invoke<MarketMovers>('get_market_movers');
    if (movers && (movers.gainers?.length > 0 || movers.most_active?.length > 0)) {
      console.log(`[Notes] Got market movers from web`);
      return movers;
    }
  } catch (webError) {
    console.log(`[Notes] Web scraping failed for market movers:`, webError);
  }
  
  // Fallback to MCP servers
  const runningServers = mcpServerStates.filter(s => s.status === 'running');
  
  for (const server of runningServers) {
    const moversTool = server.tools.find(t => 
      t.name === 'get_market_movers' || 
      t.name === 'getMarketMovers' ||
      t.name === 'get_movers'
    );
    
    if (moversTool) {
      try {
        console.log(`[Notes MCP] Trying ${server.id} for market movers`);
        const result = await callMCPTool(server.id, moversTool.name, {});
        
        if (!result.is_error && result.content.length > 0) {
          const text = result.content.find(c => c.type === 'text')?.text;
          if (text) {
            try {
              const data = JSON.parse(text);
              console.log(`[Notes MCP] Got market movers`);
              return {
                gainers: data.gainers || [],
                losers: data.losers || [],
                most_active: data.most_active || data.mostActive || [],
              };
            } catch {
              console.log(`[Notes MCP] Response not JSON`);
            }
          }
        }
      } catch (error) {
        console.log(`[Notes MCP] Tool call failed:`, error);
      }
    }
  }
  
  return { gainers: [], losers: [], most_active: [] };
}

async function webSearchWithMCP(query: string): Promise<WebSearchResult[]> {
  const invoke = await getInvoke();
  const runningServers = mcpServerStates.filter(s => s.status === 'running');
  
  // Try MCP servers first (brave-search, web-search, etc.)
  for (const server of runningServers) {
    const searchTool = server.tools.find(t => 
      t.name === 'brave_web_search' || 
      t.name === 'web_search' ||
      t.name === 'search'
    );
    
    if (searchTool) {
      try {
        console.log(`[Notes MCP] Trying ${server.id} for web search: ${query}`);
        const result = await callMCPTool(server.id, searchTool.name, { query, count: 5 });
        
        if (!result.is_error && result.content.length > 0) {
          const text = result.content.find(c => c.type === 'text')?.text;
          if (text) {
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) {
                console.log(`[Notes MCP] Got ${data.length} search results`);
                return data.map((item: any) => ({
                  title: item.title || '',
                  url: item.url || item.link || '',
                  snippet: item.description || item.snippet || '',
                }));
              } else if (data.results) {
                return data.results.map((item: any) => ({
                  title: item.title || '',
                  url: item.url || item.link || '',
                  snippet: item.description || item.snippet || '',
                }));
              }
            } catch {
              console.log(`[Notes MCP] Search response not JSON`);
            }
          }
        }
      } catch (error) {
        console.log(`[Notes MCP] Search tool call failed:`, error);
      }
    }
  }
  
  // Fallback to built-in web search
  console.log(`[Notes] Falling back to built-in web search`);
  return invoke<WebSearchResult[]>('search_web', { query, maxResults: 5 });
}

interface WebContent {
  url: string;
  title: string;
  content: string;
  content_type: string;
}

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

async function fetchUrlContent(url: string): Promise<WebContent | null> {
  try {
    const invoke = await getInvoke();
    console.log(`[Notes] Fetching URL content: ${url}`);
    const content = await invoke<WebContent>('fetch_url', { url });
    console.log(`[Notes] Fetched ${content.title}, ${content.content.length} chars`);
    return content;
  } catch (error) {
    console.error(`[Notes] Failed to fetch URL:`, error);
    return null;
  }
}

function formatFetchedContent(contents: WebContent[]): string {
  if (contents.length === 0) return '';
  
  let formatted = '\n\n---\n**Fetched Web Content:**\n\n';
  for (const content of contents) {
    formatted += `### [${content.title || content.url}](${content.url})\n\n`;
    // Truncate very long content
    const truncated = content.content.length > 8000 
      ? content.content.substring(0, 8000) + '\n\n...(content truncated)...'
      : content.content;
    formatted += truncated + '\n\n';
  }
  return formatted;
}

async function summarizeWithAI(
  invoke: any,
  settings: AISettings,
  userQuery: string,
  webResults: string,
  conversationId: string
): Promise<string> {
  const listenFn = await getListen();
  
  let summaryContent = '';
  const unlisten = await listenFn(`ai-stream-${conversationId}`, (event: any) => {
    const { content } = event.payload;
    if (content) {
      summaryContent += content;
    }
  });

  const summaryMessages = [
    { role: 'system', content: getSummarizationPrompt() },
    { role: 'user', content: `User question: "${userQuery}"\n\nWeb search results:\n${webResults}\n\nPlease summarize these results with key insights and source links.` }
  ];

  try {
    if (settings.aiProvider === 'ollama') {
      await invoke('chat_ollama', {
        baseUrl: settings.ollamaUrl || 'http://localhost:11434',
        model: settings.model || 'gemma4:latest',
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
      });
    } else if (settings.aiProvider === 'openai') {
      await invoke('chat_openai', {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: settings.openaiKey,
        model: settings.model || 'gpt-4o',
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
      });
    } else if (settings.aiProvider === 'anthropic') {
      await invoke('chat_openai', {
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: settings.anthropicKey,
        model: settings.model || 'claude-3-5-sonnet-20241022',
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
      });
    } else if (settings.aiProvider === 'copilot') {
      await invoke('chat_copilot', {
        model: settings.model || 'gpt-4o',
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
      });
    } else if (settings.aiProvider === 'custom') {
      await invoke('chat_openai', {
        baseUrl: settings.customBaseUrl,
        apiKey: settings.customApiKey,
        model: settings.model,
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
      });
    }
  } finally {
    unlisten();
  }

  return summaryContent || webResults;
}

export function ChatPanel() {
  const {
    messages,
    activeConversationId,
    isLoading,
    isStreaming,
    setMessages,
    addMessage,
    updateMessageContent,
    setIsLoading,
    setIsStreaming,
    getActiveConversation,
  } = useNotesStore();

  const [input, setInput] = useState('');
  const [webStatus, setWebStatus] = useState<string | null>(null);
  const [streamingPhase, setStreamingPhase] = useState<'streaming' | 'executing' | 'done'>('streaming');
  const [rawThinkingContent, setRawThinkingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const conversation = getActiveConversation();

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeConversationId) return;
      
      try {
        const invoke = await getInvoke();
        const loadedMessages = await invoke('list_messages', { conversationId: activeConversationId });
        setMessages(loadedMessages as Message[]);
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };

    loadMessages();
  }, [activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const executeWebOperations = async (operations: WebOperation[]): Promise<string> => {
    const results: string[] = [];
    
    // Start MCP servers if not already running
    const settings = getAISettings();
    await startMCPServers(settings);
    
    // Execute operations concurrently where possible
    const promises = operations.map(async (op) => {
      try {
        if (op.type === 'search_web' && op.query) {
          setWebStatus(`Searching: ${op.query}`);
          console.log('[Notes] Executing web search with MCP fallback:', op.query);
          const searchResults = await webSearchWithMCP(op.query);
          console.log('[Notes] Search results:', searchResults.length);
          return formatSearchResults(searchResults);
        } else if (op.type === 'get_stock_quote' && op.symbol) {
          setWebStatus(`Getting quote: ${op.symbol}`);
          console.log('[Notes] Executing stock quote with MCP fallback:', op.symbol);
          const quote = await getStockQuoteWithMCP(op.symbol);
          console.log('[Notes] Stock quote:', quote);
          return formatStockQuote(quote);
        } else if (op.type === 'get_market_movers') {
          setWebStatus('Getting market movers...');
          console.log('[Notes] Executing market movers with MCP fallback');
          const movers = await getMarketMoversWithMCP();
          console.log('[Notes] Market movers:', movers);
          return formatMarketMovers(movers);
        }
        return null;
      } catch (error) {
        console.error(`[Notes] Web operation failed:`, op.type, error);
        return `*Failed to execute ${op.type}: ${error}*`;
      }
    });
    
    const resolvedResults = await Promise.all(promises);
    results.push(...resolvedResults.filter((r): r is string => r !== null));
    
    setWebStatus(null);
    return results.join('\n\n---\n\n');
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConversationId || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      const invoke = await getInvoke();
      
      // Detect URLs in the message
      const urls = extractUrls(userMessage);
      let fetchedContent = '';
      
      if (urls.length > 0) {
        setWebStatus(`Fetching ${urls.length} URL(s)...`);
        console.log(`[Notes] Detected ${urls.length} URLs in message:`, urls);
        
        // Fetch all URLs concurrently
        const fetchPromises = urls.slice(0, 3).map(url => fetchUrlContent(url)); // Limit to 3 URLs
        const fetchedContents = await Promise.all(fetchPromises);
        const validContents = fetchedContents.filter((c): c is WebContent => c !== null);
        
        if (validContents.length > 0) {
          fetchedContent = formatFetchedContent(validContents);
          console.log(`[Notes] Fetched content from ${validContents.length} URLs`);
        }
        setWebStatus(null);
      }
      
      // Add user message
      const savedUserMessage = await invoke('add_message', {
        conversationId: activeConversationId,
        role: 'user',
        content: userMessage,
        attachments: null,
      }) as Message;
      
      addMessage(savedUserMessage);

      // Create placeholder for assistant response
      const assistantPlaceholder: Message = {
        id: `temp-${Date.now()}`,
        conversation_id: activeConversationId,
        role: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
      };
      addMessage(assistantPlaceholder);

      setIsStreaming(true);

      // Setup stream listener
      const listenFn = await getListen();
      const conversationId = `notes-${activeConversationId}`;
      
      let fullContent = '';
      const unlisten = await listenFn(`ai-stream-${conversationId}`, (event: any) => {
        const { content, done } = event.payload;
        if (content) {
          fullContent += content;
          // Always show full stream in thinking panel (cleaned of tool tags)
          setRawThinkingContent(cleanWebOperationTags(fullContent));
          // Response panel: clean all thinking content (tags + reasoning patterns)
          const cleanedResponse = cleanThinkingFromResponse(cleanWebOperationTags(fullContent));
          updateMessageContent(assistantPlaceholder.id, cleanedResponse);
        }
        if (done) {
          setStreamingPhase('done');
          // Final cleanup when done
          const cleanedResponse = cleanThinkingFromResponse(cleanWebOperationTags(fullContent));
          updateMessageContent(assistantPlaceholder.id, cleanedResponse);
        }
      });

      // Get AI settings
      const settings = getAISettings();
      
      // Build user content - include fetched URL content if any
      const userContent = fetchedContent 
        ? `${userMessage}\n${fetchedContent}`
        : userMessage;
      
      // Build messages with system prompt for web access
      // Limit conversation history to last 20 messages for faster responses
      const MAX_HISTORY_MESSAGES = 20;
      const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);
      
      const systemMessage = { role: 'system', content: getWebAccessSystemPrompt() };
      const messagesForAI = [
        systemMessage,
        ...recentMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ];
      
      console.log(`[Notes] Sending ${messagesForAI.length} messages (limited from ${messages.length + 1})`);

      try {
        if (settings.aiProvider === 'ollama') {
          await invoke('chat_ollama', {
            baseUrl: settings.ollamaUrl || 'http://localhost:11434',
            model: settings.model || 'gemma4:latest',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
          });
        } else if (settings.aiProvider === 'openai') {
          await invoke('chat_openai', {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: settings.openaiKey,
            model: settings.model || 'gpt-4o',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
          });
        } else if (settings.aiProvider === 'anthropic') {
          await invoke('chat_openai', {
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: settings.anthropicKey,
            model: settings.model || 'claude-3-5-sonnet-20241022',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
          });
        } else if (settings.aiProvider === 'copilot') {
          await invoke('chat_copilot', {
            model: settings.model || 'gpt-4o',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
          });
        } else if (settings.aiProvider === 'custom') {
          await invoke('chat_openai', {
            baseUrl: settings.customBaseUrl,
            apiKey: settings.customApiKey,
            model: settings.model,
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
          });
        }

        // Small delay to ensure streaming is fully complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check for web operations in the response
        console.log('[Notes] Checking for web operations in response:', fullContent.substring(0, 200));
        let webOps = parseWebOperations(fullContent);
        // Fallback: detect tool intent in text for models that don't emit XML tags
        if (webOps.length === 0) {
          webOps = parseWebOperationsFromIntent(fullContent);
        }
        
        if (webOps.length > 0) {
          console.log('[Notes] Found web operations, executing:', webOps);
          setStreamingPhase('executing');
          const cleanedContent = cleanWebOperationTags(fullContent);
          
          // Execute web operations
          try {
            const webResults = await executeWebOperations(webOps);
            
            // Show interim message while summarizing
            updateMessageContent(assistantPlaceholder.id, cleanedContent + '\n\n*Analyzing results...*');

            // Send results back to AI for summarization
            setWebStatus('Summarizing results...');
            const summarizedContent = await summarizeWithAI(
              invoke,
              settings,
              userMessage,
              webResults,
              conversationId + '-summary'
            );
            
            // Update message with summarized results
            const finalContent = cleanedContent 
              ? `${cleanedContent}\n\n${summarizedContent}`
              : summarizedContent;
            
            updateMessageContent(assistantPlaceholder.id, finalContent);
            fullContent = finalContent;
          } catch (webError) {
            console.error('[Notes] Web operation execution failed:', webError);
            const errorContent = cleanedContent + '\n\n*Web search failed. Please try again.*';
            updateMessageContent(assistantPlaceholder.id, errorContent);
            fullContent = errorContent;
          }
        } else {
          console.log('[Notes] No web operations found in response');
        }
      } catch (aiError) {
        console.error('AI chat error:', aiError);
        const errorMsg = aiError instanceof Error ? aiError.message : String(aiError);
        updateMessageContent(assistantPlaceholder.id, `Error: ${errorMsg}\n\nPlease check your AI settings and make sure the provider is running.`);
        fullContent = `Error: ${errorMsg}`;
      }

      // Save assistant message
      const finalContent = fullContent || 'Sorry, I could not generate a response.';
      await invoke('add_message', {
        conversationId: activeConversationId,
        role: 'assistant',
        content: finalContent,
        attachments: null,
      });

      unlisten();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setWebStatus(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{conversation?.title || 'Chat'}</h2>
        <div className={styles.headerBadges}>
          <span className={styles.webBadge} title="Web search enabled">
            <Globe size={14} />
            <span>Web</span>
          </span>
          <span className={styles.webBadge} title="Stock data enabled">
            <TrendingUp size={14} />
            <span>Stocks</span>
          </span>
        </div>
      </div>

      <div className={styles.messages}>
        {messages.map((message, index) => {
          const showDateSeparator = index === 0 || (
            message.created_at && 
            messages[index - 1]?.created_at &&
            new Date(message.created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString()
          );
          
          return (
            <React.Fragment key={message.id}>
              {showDateSeparator && message.created_at && (
                <div className={styles.dateSeparator}>
                  <span>{formatDateSeparator(message.created_at)}</span>
                </div>
              )}
              <MessageBubble
                message={message}
                thinking={streamingPhase !== 'done' && message.role === 'assistant' && rawThinkingContent ? rawThinkingContent : undefined}
                hasResponse={!!message.content.trim()}
              />
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {webStatus && (
        <div className={styles.webStatus}>
          <Loader2 size={14} className={styles.spinner} />
          <span>{webStatus}</span>
        </div>
      )}

      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (supports web search & stock data)"
            className={styles.input}
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            className={styles.sendBtn}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              isStreaming ? <StopCircle size={20} /> : <Loader2 size={20} className={styles.spinner} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  showDate?: boolean;
  thinking?: string;
  hasResponse?: boolean;
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  if (isToday) {
    return timeStr;
  } else if (isYesterday) {
    return `Yesterday ${timeStr}`;
  } else {
    const dateFormatted = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
    return `${dateFormatted} ${timeStr}`;
  }
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) {
    return 'Today';
  } else if (isYesterday) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

function MessageBubble({ message, showDate = true, thinking, hasResponse }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isAssistant = !isUser;
  const messageContentRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-scroll message during streaming
  useEffect(() => {
    if (thinking && messageContentRef.current) {
      messageContentRef.current.scrollTop = messageContentRef.current.scrollHeight;
    }
  }, [thinking, message.content]);

  // Render: thinking text inline (muted) or final response (cleaned markdown)
  const renderBody = () => {
    // If we have a response and were showing thinking, replace thinking with response
    if (hasResponse) {
      return <MarkdownRenderer content={message.content} />;
    }
    if (thinking) {
      return <div className={styles.thinkingText}>{cleanWebOperationTags(thinking)}</div>;
    }
    if (message.content) {
      return isUser ? message.content : <MarkdownRenderer content={message.content} />;
    }
    return (
      <span className={styles.typing}>
        <span></span>
        <span></span>
        <span></span>
      </span>
    );
  };

  return (
    <div className={`${styles.messageBubble} ${isUser ? styles.user : styles.assistant}`}>
      <div className={`${styles.messageContent} ${thinking ? styles.thinkingInline : ''}`} ref={messageContentRef}>
        {renderBody()}
      </div>
      <div className={styles.messageFooter}>
        {showDate && message.created_at && (
          <span className={styles.messageTime}>{formatMessageTime(message.created_at)}</span>
        )}
        {!isUser && message.content && (
          <div className={styles.messageActions}>
            <button onClick={handleCopy} className={styles.actionBtn} title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>
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

      // Code blocks
      const codeBlockMatch = line.match(/^(\s*)```(\w*)\s*$/);
      if (codeBlockMatch || line.trim().startsWith('```')) {
        const lang = codeBlockMatch ? codeBlockMatch[2] : line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length) {
          const currentLine = lines[i];
          if (currentLine.trim() === '```' || currentLine.match(/^\s*```\s*$/)) {
            i++;
            break;
          }
          codeLines.push(currentLine);
          i++;
        }
        
        elements.push(
          <pre key={key++} className={styles.codeBlock}>
            {lang && <div className={styles.codeLang}>{lang}</div>}
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        continue;
      }

      // Headers
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

      // Unordered lists
      if (line.match(/^[\s]*[-*+]\s/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
          const itemContent = lines[i].replace(/^[\s]*[-*+]\s/, '');
          listItems.push(<li key={key++}>{renderInline(itemContent)}</li>);
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

      // Tables
      const trimmedLine = line.trim();
      const pipeCount = (line.match(/\|/g) || []).length;
      const looksLikeTableRow = trimmedLine.startsWith('|') || pipeCount >= 2;
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      
      const isSeparatorLine = (l: string): boolean => {
        const trimmed = l.trim();
        const withoutOuterPipes = trimmed.startsWith('|') && trimmed.endsWith('|') 
          ? trimmed.slice(1, -1) 
          : trimmed;
        const cells = withoutOuterPipes.split('|');
        return cells.length >= 1 && cells.every(cell => /^[\s:-]+$/.test(cell) && cell.includes('-'));
      };
      
      if (looksLikeTableRow && isSeparatorLine(nextLine)) {
        const tableRows: string[][] = [];
        let hasHeader = false;
        
        const parseTableRow = (row: string): string[] => {
          let trimmed = row.trim();
          if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
          if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
          return trimmed.split('|').map(cell => cell.trim());
        };
        
        const isTableRow = (l: string): boolean => {
          const t = l.trim();
          return t.startsWith('|') || (l.match(/\|/g) || []).length >= 2;
        };
        
        while (i < lines.length && isTableRow(lines[i])) {
          const row = lines[i];
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

  const renderInline = (rawText: string): React.ReactNode => {
    let text = rawText;
    
    interface InlineMatch {
      start: number;
      end: number;
      element: React.ReactNode;
    }

    const matches: InlineMatch[] = [];
    let key = 0;

    const noOverlap = (start: number, end: number) =>
      !matches.some(m => start < m.end && end > m.start);

    // Inline code
    const codeRegex = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = codeRegex.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        element: <code key={key++} className={styles.inlineCode}>{m[1]}</code>,
      });
    }

    // Bold **text**
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

    // Italic *text*
    const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
    while ((m = italicRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <em key={key++}>{m[1]}</em>,
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
          element: <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className={styles.mdLink}>{m[1]}</a>,
        });
      }
    }

    if (matches.length === 0) return text;

    matches.sort((a, b) => a.start - b.start);

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    for (const match of matches) {
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
