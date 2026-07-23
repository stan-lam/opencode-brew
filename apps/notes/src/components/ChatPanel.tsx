import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, StopCircle, Copy, Check, Globe, TrendingUp, Paperclip, X, Image, FileText, File as FileIcon, FileCode, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { useNotesStore, Message } from '../store/notesStore';
import styles from './ChatPanel.module.css';

const SETTINGS_KEY = 'opencodebrew-notes-settings';
const GLOBAL_SETTINGS_KEY = 'opencodebrew-settings';

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
  contextSummaryEnabled?: boolean;
  contextTokenLimit?: number;
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

interface Attachment {
  id: string;
  file: File;
  type: 'image' | 'pdf' | 'document' | 'text';
  mimeType: string;
  base64Data?: string;
  preview?: string;
  extractedText?: string;
  isProcessing?: boolean;
  sourcePath?: string; // Original file path from Tauri drag-drop
}

interface MessageAttachment {
  id: string;
  type: string;
  name: string;
  mimeType: string;
  data?: string;
}

// Global MCP server states for Notes app
let mcpServerStates: MCPServerState[] = [];

// Estimate token count from text (approximately 4 characters per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Estimate total tokens for an array of messages
function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
}

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
    const globalStored = localStorage.getItem(GLOBAL_SETTINGS_KEY);
    const globalSettings = globalStored ? JSON.parse(globalStored) : null;
    if (stored) {
      const settings = { ...defaults, ...JSON.parse(stored) };
      const mergedSettings = globalSettings
        ? {
            ...settings,
            aiProvider: globalSettings.aiProvider ?? settings.aiProvider,
            model: globalSettings.model ?? settings.model,
            ollamaUrl: globalSettings.ollamaUrl ?? settings.ollamaUrl,
            openaiKey: globalSettings.openaiKey ?? settings.openaiKey,
            anthropicKey: globalSettings.anthropicKey ?? settings.anthropicKey,
            customBaseUrl: globalSettings.customBaseUrl ?? settings.customBaseUrl,
            customApiKey: globalSettings.customApiKey ?? settings.customApiKey,
            temperature: globalSettings.temperature ?? settings.temperature,
            maxTokens: globalSettings.maxTokens ?? settings.maxTokens,
            mcpServers: globalSettings.mcpServers ?? settings.mcpServers,
          }
        : settings;
      return migrateMCPSettings(mergedSettings);
    }
    if (globalSettings) {
      const mergedSettings = {
        ...defaults,
        aiProvider: globalSettings.aiProvider ?? defaults.aiProvider,
        model: globalSettings.model ?? defaults.model,
        ollamaUrl: globalSettings.ollamaUrl ?? defaults.ollamaUrl,
        openaiKey: globalSettings.openaiKey ?? defaults.openaiKey,
        anthropicKey: globalSettings.anthropicKey ?? defaults.anthropicKey,
        customBaseUrl: globalSettings.customBaseUrl ?? defaults.customBaseUrl,
        customApiKey: globalSettings.customApiKey ?? defaults.customApiKey,
        temperature: globalSettings.temperature ?? defaults.temperature,
        maxTokens: globalSettings.maxTokens ?? defaults.maxTokens,
        mcpServers: globalSettings.mcpServers ?? defaults.mcpServers,
      };
      return migrateMCPSettings(mergedSettings);
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

## 🚨 ZERO HALLUCINATION POLICY 🚨

**NEVER fabricate, invent, or make up ANY factual data.**
- If you don't have real data from a tool, say "I don't have that information"
- NEVER generate fake numbers, prices, statistics, or results
- ONLY present data that was returned by an executed tool

## 🚫 NEVER PROVIDE LINK TABLES - THIS IS FORBIDDEN

**ABSOLUTELY FORBIDDEN responses:**
- Tables of source links: "| Source | Link | Nasdaq | [link] | MarketBeat | [link] |"
- "Here are some resources where you can find..."
- "You can check these sites..."
- "Sources for this information include..."

**THIS IS USELESS. The user asked YOU to get the data, not to tell them where to find it.**

When you have search results:
- EXTRACT the actual data (numbers, facts, answers) from the results
- PRESENT the data directly
- If search returned no useful data, say "I couldn't find specific information about [X]"
- NEVER just list the sources/links as your answer

## ABSOLUTE RULES - READ FIRST

**NEVER output your thinking process, planning, analysis, or self-reflection to the user.**
**NEVER say things like "Let me analyze...", "Here's my thinking...", "Thinking Process:", "Action Plan:", "Plan:", "Strategy:", "Goal:", "Challenge:", "Analyze the Request:", "Self-Correction"**
**NEVER show numbered steps of your reasoning process.**
**NEVER generate fake or hallucinated search results - only real data from executed tools.**

If you need to think, put it ONLY inside <think>...</think> tags. Everything outside those tags goes directly to the user.

**YOUR OUTPUT MUST BE:**
- A direct answer (e.g., "The top 5 ATP players are: 1. Sinner 2. Alcaraz...")
- OR a brief acknowledgment + action suggestion (e.g., "I can search for that.\n\n[ACTION:search_web:query:Search]")
- NOTHING ELSE - especially no fake results after an action tag

## WHEN TO AUTO-SEARCH vs SHOW ACTION BUTTON

**AUTO-EXECUTE (just do it):** For simple factual queries, execute automatically using XML tags:
- Weather queries: "weather in seattle" → <get_weather location="Seattle, WA" />
- Stock prices: "aapl price" → <get_stock_quote symbol="AAPL" />
- Simple facts: "who won the superbowl" → <search_web query="superbowl winner 2026" />
- Current events: "latest news on X" → <search_web query="X news ${shortDate}" />

**SHOW ACTION BUTTON:** For complex/ambiguous requests that might need refinement:
- Product research: User might want to clarify which product
- Vague queries: "find me something good" needs more context
- Expensive operations: Large data fetches the user should confirm

**ACTION BUTTON FORMAT:**
- [ACTION:tool_name:parameter:Button Label]
- [ACTION:get_mlb_standings:Get MLB Standings]
- [ACTION:get_stock_quote:AAPL:Get Apple Quote]

**CRITICAL: After outputting an [ACTION:...] tag, STOP IMMEDIATELY. Do NOT add fake results.**

**Example - AUTO-EXECUTE (weather):**
User: "weather in issaquah wa"
<get_weather location="Issaquah, WA" />

**Example - AUTO-SEARCH (stock):**
User: "How's AMD doing?"
<get_stock_quote symbol="AMD" />

**Example - ACTION BUTTON (ambiguous):**
User: "What's this brake and how much?"
Assistant: I can search for this product's information and price.

[ACTION:search_web:TRP REPO HD brake price:Search for price]

**STOCK PRICE QUERIES - IMPORTANT:**
When the user asks about a stock price (e.g., "himx price", "aapl stock", "what's msft at?"):
1. Extract the ticker symbol and convert to UPPERCASE
2. Use the get_stock_quote action - NEVER use search_web for stock prices
3. Examples:
   - "himx price" → [ACTION:get_stock_quote:HIMX:Get HIMX Quote]
   - "nvda?" → [ACTION:get_stock_quote:NVDA:Get NVDA Quote]
   - "aapl stock" → [ACTION:get_stock_quote:AAPL:Get AAPL Quote]

**Example - WRONG (auto-executing without asking):**
<get_mlb_standings />
Here are the standings...

**Example - WRONG (verbose reasoning):**
The user is asking for MLB standings. This requires real-time data. I should use the get_mlb_standings tool...

**Example - WRONG (continuing after action tag with fake results):**
[ACTION:search_web:product name:Search]

Here are the results...
(NEVER do this - the action hasn't executed yet!)

**Example - WRONG (planning before action):**
Action Plan:
1. Identify the product
2. Search for price
[ACTION:search_web:product:Search]
(NEVER show planning - just offer to search and show the action button)

CRITICAL: When searching for news or current events, ALWAYS include today's date "${shortDate}" or "today" in your search queries to get the most recent results. Do NOT rely on cached or outdated information.

## DATA ACCESS TOOLS

You have access to real-time market data and web search. **TO USE A TOOL, YOU MUST OUTPUT THE XML TAG EXACTLY AS SHOWN BELOW.**

Write the XML tags directly — do NOT describe them.

**Get stock/futures quote (via Yahoo Finance MCP):**
<get_stock_quote symbol="AAPL" />

**Get market movers (top gainers, losers, most active):**
<get_market_movers />

**Get MLB standings (baseball):**
<get_mlb_standings />

**Get weather for a location:**
<get_weather location="Seattle, WA" />
Use this for any weather query - it returns real temperature data.

**Search the web (use concise keyword queries, not sentences):**
<search_web query="topic keywords ${shortDate}" />
IMPORTANT: Search queries must be KEYWORD-BASED, not conversational. Examples:
- Good: "top 5 ATP tennis players 2026"
- Good: "WTA rankings April 2026"
- Bad: "the top players for you" (too vague)
- Bad: "who are the best tennis players" (conversational, not keywords)

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

### RESPONSE STYLE - SIMPLE QUESTIONS:
For simple or generic questions (rankings, "best of", general knowledge):
1. **Give a direct answer FIRST** - Don't explain your reasoning, just answer
2. **Keep it concise** - A brief summary or list is often enough
3. **Offer follow-ups at the end** - "Would you like more details on [specific aspect]?"

**Example - Good (direct + follow-up):**
User: "Who are the top tennis players?"
<think>Rankings query, search for current ATP rankings.</think>
<search_web query="ATP top 10 rankings Apr 2026" />
The current top 5 ATP players are:
1. Jannik Sinner
2. Carlos Alcaraz
3. Novak Djokovic
...

Would you like details on WTA rankings, recent tournament results, or head-to-head records?

**Example - BAD (FORBIDDEN - never do this):**
"The user is asking for the top 5 ATP players. This is a request for current, frequently changing sports ranking data. I need to use the search_web tool...

Plan:
1. Acknowledge the request.
2. Suggest using search_web...

Here's a thinking process to arrive at the desired summary:
1. Analyze the Request..."

THIS IS ABSOLUTELY FORBIDDEN. Never output planning, analysis, thinking processes, strategies, goals, or self-reflection. Just answer directly.

### MULTI-TURN RULE:
Even if you already fetched data earlier, if the user asks another question about real-time data, **you MUST output the XML tag again**. Do NOT reference previous tool calls. Do NOT say "as mentioned before". Output the fresh XML tag for every new data request.

### OUTPUT FORMATTING RULES:
1. **NO LaTeX math notation** - Do NOT use $...$ or \\(...\\) syntax. This chat does not render LaTeX.
2. **Use Unicode symbols** instead of LaTeX:
   - Arrows: → ← ↔ ↑ ↓ (not $\\rightarrow$ etc.)
   - Math: × ÷ ≠ ≤ ≥ ± ∞ (not $\\times$ etc.)
3. **For sequence diagrams**: ALWAYS use Mermaid code blocks - they render as visual diagrams:
   \`\`\`mermaid
   sequenceDiagram
       participant App as MobileApp
       participant API as API Gateway
       participant Order as Order Service
       participant DB as Database
       
       App->>API: submitOrder(items)
       API->>Order: validateAndReserve()
       Order->>DB: checkInventory()
       DB-->>Order: available
       Order-->>API: confirmed
       API-->>App: orderID
   \`\`\`
4. **For flowcharts**: Use Mermaid flowchart syntax:
   \`\`\`mermaid
   flowchart TD
       A[Start] --> B{Decision}
       B -->|Yes| C[Action 1]
       B -->|No| D[Action 2]
   \`\`\`
5. **Use markdown** for formatting: headers (#), bold (**), lists (-), code blocks (\`\`\`)
6. **For rankings/leaderboards** (sports, players, teams, etc.): ALWAYS use a markdown table:
   | Rank | Name | Details |
   |------|------|---------|
   | 1 | Player Name | Country, Points |
   | 2 | Player Name | Country, Points |
   
   Example for ATP tennis rankings:
   | Rank | Player | Country | Points |
   |------|--------|---------|--------|
   | 1 | Jannik Sinner | ITA | 13,350 |
   | 2 | Carlos Alcaraz | ESP | 12,960 |
`;
}

function getSummarizationPrompt(): string {
  return `You are a helpful assistant. Give a DIRECT, CONCISE answer to the user's question based on the search results.

## OUTPUT FORMAT

**For WEATHER queries:**
🌤️ **[Location] Weather**
- Current: [temp]°F, [conditions]
- High/Low: [high]°F / [low]°F
- [Any relevant details like rain chance, wind]

**For FACTUAL questions:**
Answer directly in 1-3 sentences with the key facts.

**For RANKINGS/LISTS:**
1. [Item] - [key detail]
2. [Item] - [key detail]
...

**For PRODUCTS/PRICES:**
**[Product Name]** - $[price]
[1-2 sentence description]

## RULES

1. **BE DIRECT** - Start with the answer, not "Based on the search results..."
2. **EXTRACT DATA** - Pull actual numbers, facts, temperatures from the results
3. **KEEP IT SHORT** - 2-5 lines for simple queries, more for complex topics
4. **NO LINK LISTS** - Don't just list websites to visit
5. **NO THINKING** - Never show "Thinking Process:", "Analysis:", numbered steps

## IF DATA NOT FOUND

Say briefly: "I couldn't find specific [weather/price/etc.] data for [topic]. You might try [suggestion]."

## EXAMPLES

**User asks about weather:**
☀️ **Issaquah, WA Weather**
- Currently: 68°F, Partly Cloudy
- High: 72°F / Low: 54°F  
- 10% chance of rain this afternoon

**User asks about a product:**
**Sony WH-1000XM5** - $348
Premium noise-cancelling headphones with 30-hour battery life and multipoint connection.`;
}

interface WebOperation {
  type: 'search_web' | 'get_stock_quote' | 'get_market_movers' | 'get_mlb_standings' | 'get_weather';
  query?: string;
  symbol?: string;
  location?: string;
}

interface MLBTeamStanding {
  team_name: string;
  wins: number;
  losses: number;
  pct: string;
  games_back: string;
  division: string;
  league: string;
  streak: string;
  last_ten: string;
}

interface MLBStandings {
  season: number;
  standings: MLBTeamStanding[];
}

interface WeatherData {
  location: string;
  current_temp: string;
  condition: string;
  feels_like: string;
  humidity: string;
  wind: string;
  forecast: string;
}

interface SuggestedAction {
  tool: string;
  param?: string;
  label: string;
}

function parseSuggestedActions(content: string): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  // Match [ACTION:tool:param:label] or [ACTION:tool:label]
  const actionRegex = /\[ACTION:(\w+)(?::([^:\]]+))?:([^\]]+)\]/g;
  
  let match;
  while ((match = actionRegex.exec(content)) !== null) {
    const tool = match[1];
    // If there are 3 capture groups and match[3] exists, format is tool:param:label
    // If only tool:label, match[2] is the label and match[3] is undefined
    if (match[3]) {
      actions.push({ tool, param: match[2], label: match[3] });
    } else {
      actions.push({ tool, label: match[2] || tool });
    }
  }
  
  return actions;
}

function stripActionTags(content: string): string {
  return content.replace(/\[ACTION:[^\]]+\]/g, '').trim();
}

function cleanSearchQuery(query: string): string {
  const original = query;
  const cleaned = query
    // Remove malformed brackets, braces, and special chars from AI output errors
    .replace(/[\[\]{}()<>]/g, '')
    // Remove XML/HTML-like fragments that might leak through
    .replace(/<[^>]*>/g, '')
    // Remove escape sequences
    .replace(/\\[nrt"']/g, ' ')
    // Remove conversational filler phrases
    .replace(/\b(?:for you|for me|please|can you|could you|i need|i want)\b/gi, '')
    // Remove question words at start
    .replace(/^(?:what|who|where|when|how|which|why)\s+(?:are|is|were|was|do|does|did)?\s*/i, '')
    // Remove "the" at start
    .replace(/^the\s+/i, '')
    // Remove trailing punctuation that shouldn't be in queries
    .replace(/[.,;:!?]+$/g, '')
    // Remove quotes that might wrap the query
    .replace(/^["']+|["']+$/g, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Log if significant cleaning occurred
  if (original !== cleaned && original.length - cleaned.length > 2) {
    console.log(`[Notes] Cleaned malformed query: "${original}" -> "${cleaned}"`);
  }
  
  return cleaned;
}

function isValidSearchQuery(query: string): boolean {
  // Reject empty or too short queries
  if (!query || query.length < 2) return false;
  // Reject queries that are only special characters
  if (!/[a-zA-Z0-9]/.test(query)) return false;
  // Reject queries that look like code/JSON fragments
  if (/^[{}\[\]()]+$/.test(query)) return false;
  return true;
}

function parseWebOperations(content: string): WebOperation[] {
  const operations: WebOperation[] = [];
  
  // Match double-quoted queries (allows apostrophes inside)
  const searchRegexDouble = /<search_web\s+query="([^"]+)"[^>]*\/?>/gi;
  // Match single-quoted queries (allows double quotes inside)  
  const searchRegexSingle = /<search_web\s+query='([^']+)'[^>]*\/?>/gi;
  
  let match;
  while ((match = searchRegexDouble.exec(content)) !== null) {
    const cleanedQuery = cleanSearchQuery(match[1]);
    if (isValidSearchQuery(cleanedQuery)) {
      operations.push({ type: 'search_web', query: cleanedQuery });
    } else {
      console.warn(`[Notes] Rejected invalid search query: "${match[1]}" -> "${cleanedQuery}"`);
    }
  }
  while ((match = searchRegexSingle.exec(content)) !== null) {
    const cleanedQuery = cleanSearchQuery(match[1]);
    if (isValidSearchQuery(cleanedQuery)) {
      operations.push({ type: 'search_web', query: cleanedQuery });
    } else {
      console.warn(`[Notes] Rejected invalid search query: "${match[1]}" -> "${cleanedQuery}"`);
    }
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
  
  // MLB standings
  const mlbStandingsRegex = /<get_mlb_standings[^>]*\/?>/gi;
  while ((match = mlbStandingsRegex.exec(content)) !== null) {
    operations.push({ type: 'get_mlb_standings' });
  }
  
  // Weather
  const weatherRegexDouble = /<get_weather\s+location="([^"]+)"[^>]*\/?>/gi;
  const weatherRegexSingle = /<get_weather\s+location='([^']+)'[^>]*\/?>/gi;
  
  while ((match = weatherRegexDouble.exec(content)) !== null) {
    operations.push({ type: 'get_weather', location: match[1] });
  }
  while ((match = weatherRegexSingle.exec(content)) !== null) {
    operations.push({ type: 'get_weather', location: match[1] });
  }
  
  // Convert web searches for weather to get_weather
  // E.g., <search_web query="seattle weather" /> should become get_weather
  let searchOps = operations.filter(o => o.type === 'search_web');
  for (const searchOp of searchOps) {
    if (searchOp.query) {
      // Match patterns like "seattle weather", "weather in seattle", "issaquah wa weather"
      const weatherQueryMatch = searchOp.query.match(/^(?:weather\s+(?:in\s+)?)?(.+?)(?:\s+weather)?(?:\s+today)?$/i);
      const isWeatherQuery = /weather/i.test(searchOp.query);
      if (isWeatherQuery && weatherQueryMatch) {
        // Extract location from the query
        let location = weatherQueryMatch[1].replace(/\bweather\b/gi, '').replace(/\btoday\b/gi, '').replace(/\bin\b/gi, '').trim();
        if (location) {
          console.log(`[Notes] Converting search_web "${searchOp.query}" to get_weather "${location}"`);
          const idx = operations.indexOf(searchOp);
          if (idx > -1) operations.splice(idx, 1);
          if (!operations.find(o => o.type === 'get_weather' && o.location === location)) {
            operations.push({ type: 'get_weather', location });
          }
        }
      }
    }
  }
  
  // Convert web searches for stock prices to get_stock_quote
  // E.g., <search_web query="himx price" /> should become get_stock_quote for HIMX
  searchOps = operations.filter(o => o.type === 'search_web');
  for (const searchOp of searchOps) {
    if (searchOp.query) {
      const stockQueryMatch = searchOp.query.match(/^([a-z]{2,5})\s+(?:price|stock|quote|share)s?$/i);
      if (stockQueryMatch) {
        const symbol = stockQueryMatch[1].toUpperCase();
        console.log(`[Notes] Converting search_web "${searchOp.query}" to get_stock_quote ${symbol}`);
        const idx = operations.indexOf(searchOp);
        if (idx > -1) operations.splice(idx, 1);
        if (!operations.find(o => o.type === 'get_stock_quote' && o.symbol === symbol)) {
          operations.push({ type: 'get_stock_quote', symbol });
        }
      }
    }
  }
  
  console.log('[Notes] Parsed web operations:', operations, 'from content length:', content.length);
  return operations.slice(0, 5);
}

/** Fallback: detect tool intent in model text (e.g., "I will call the get_stock_quote tool") */
function parseWebOperationsFromIntent(content: string): WebOperation[] {
  const operations: WebOperation[] = [];

  // Detect stock quote intent with symbol extraction
  const stockToolMatch = content.match(/(?:will|need to|should)\s+(?:call|use|fetch)\s+(?:the\s+)?`?get_stock_quote`?\s+tool\s+(?:with\s+)?(?:the\s+)?(?:symbol\s+)?["']?([A-Z]{1,5})["']?/i);
  if (stockToolMatch && stockToolMatch[1]) {
    operations.push({ type: 'get_stock_quote', symbol: stockToolMatch[1].toUpperCase() });
  }
  
  // Also check for "symbol X" or "ticker X" patterns
  // IMPORTANT: Must skip common words like "is", "are", "the"
  if (operations.length === 0) {
    // Pattern: "ticker HIMX" or "symbol: AAPL" or "ticker is HIMX"
    const symbolMatch = content.match(/(?:symbol|ticker)(?:\s+is|\s*:)?\s+["']?([A-Z]{2,5})["']?(?:\s|$|\.)/i);
    if (symbolMatch && /get_stock_quote/i.test(content)) {
      const sym = symbolMatch[1].toUpperCase();
      // Skip common words that aren't stock symbols
      if (!['IS', 'ARE', 'THE', 'FOR', 'AND', 'NOT'].includes(sym)) {
        operations.push({ type: 'get_stock_quote', symbol: sym });
      }
    }
  }
  
  if (/will call the?\s*`?get_market_movers`? tool|need to use the?\s*`?get_market_movers`? tool/i.test(content)) {
    operations.push({ type: 'get_market_movers' });
  }
  
  // Detect MLB standings from XML tags or intent
  if (/<get_mlb_standings\s*\/?>/i.test(content)) {
    operations.push({ type: 'get_mlb_standings' });
  } else if (/\b(?:mlb|baseball)\s+(?:standings|rankings|teams)/i.test(content) && 
             /(?:get_mlb_standings|mlb.*tool|baseball.*standings)/i.test(content)) {
    operations.push({ type: 'get_mlb_standings' });
  }
  
  // Detect search_web intent with query extraction
  // Look for patterns like: search_web with query "dinner ideas"
  const searchQueryMatch = content.match(/search_web.*?(?:query|with)\s*["']([^"']+)["']/i);
  if (searchQueryMatch && searchQueryMatch[1]) {
    const cleanedQuery = cleanSearchQuery(searchQueryMatch[1]);
    if (isValidSearchQuery(cleanedQuery)) {
      operations.push({ type: 'search_web', query: cleanedQuery });
    } else {
      console.warn(`[Notes] Rejected invalid search query from intent: "${searchQueryMatch[1]}"`);
    }
  }
  
  // If no search operation found yet, try to extract from natural language
  if (!operations.find(o => o.type === 'search_web')) {
    // Detect "web search tool" or "search_web" mentions
    const mentionsWebSearch = /(?:search_web|web search tool|use.+search|will search|should search)/i.test(content);
    
    if (mentionsWebSearch) {
      // Try multiple patterns to extract the search query
      const searchPatterns = [
        // "search for the latest ATP rankings"
        /(?:will |should |need to )?search(?:ing)?\s+(?:for|about|the web for)\s+["']?([^"'\n.]+?)["']?(?:\.|,|$)/i,
        // "find the most current rankings"
        /(?:to find|find|look up|get)\s+(?:the most |the latest |current )?["']?([^"'\n.]+?)["']?(?:\.|,|$)/i,
        // search_web tool to find/get X
        /search_web.*?(?:to find|to get|for)\s+["']?([^"'\n.]+?)["']?(?:\.|,|$)/i,
        // quoted search term
        /search.*?["']([^"']+)["']/i,
      ];
      
      for (const pattern of searchPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          const query = match[1].trim()
            .replace(/^(?:the most |the latest |current |information on |data on |rankings for )/i, '')
            .trim();
          if (query.length > 3) {
            // Add date context for ranking queries
            const finalQuery = /ranking|player|athlete|team/i.test(query) 
              ? `${cleanSearchQuery(query)} ${new Date().getFullYear()}` 
              : cleanSearchQuery(query);
            if (isValidSearchQuery(finalQuery)) {
              operations.push({ type: 'search_web', query: finalQuery });
              console.log('[Notes] Extracted search query from intent:', finalQuery);
              break;
            } else {
              console.warn(`[Notes] Rejected invalid extracted query: "${query}"`);
            }
          }
        }
      }
    }
  }

  // Only extract symbols that appear in UPPERCASE in the original text
  // This prevents "for you" from being parsed as "YOU" symbol
  const isUppercaseInOriginal = (text: string, symbol: string): boolean => {
    // Check if the symbol appears as uppercase in the original text
    const upperPattern = new RegExp(`\\b${symbol}\\b`);
    return upperPattern.test(text);
  };

  // Detect "I need to get quotes for AMD" - symbol must be uppercase in original
  const quoteMatch = content.match(/(?:quotes?|prices?)\s*(?:for|of|on)\s*([A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5}|\s*and\s*[A-Z]{2,5})*)/);
  if (quoteMatch && !operations.find(o => o.type === 'get_stock_quote')) {
    const symbols = quoteMatch[1].replace(/\s*,\s*/g, ' ').split(/\s+and\s+/).map(s => s.trim());
    symbols.forEach(s => {
      if (/^[A-Z]{2,5}$/.test(s) && isUppercaseInOriginal(content, s)) {
        operations.push({ type: 'get_stock_quote', symbol: s });
      }
    });
  }

  // Detect "get price for AMD" - symbol must be uppercase
  const searchMatch = content.match(/(?:search|find|look up|get)\s+(?:for\s+)?(?:the\s+)?(?:price|current|stock|quote)\s+(?:of|for)\s*([A-Z]{2,5})/);
  if (searchMatch && !operations.find(o => o.type === 'get_stock_quote')) {
    const sym = searchMatch[1];
    if (/^[A-Z]{2,5}$/.test(sym) && isUppercaseInOriginal(content, sym)) {
      operations.push({ type: 'get_stock_quote', symbol: sym });
    }
  }

  // CRITICAL: If we have a search_web for what looks like a stock price query, convert to get_stock_quote
  // This catches cases where AI searched for "himx price" instead of using get_stock_quote
  const searchOps = operations.filter(o => o.type === 'search_web');
  for (const searchOp of searchOps) {
    if (searchOp.query) {
      // Pattern: "SYMBOL price" or "SYMBOL stock" (2-5 letter symbol)
      const stockQueryMatch = searchOp.query.match(/^([a-z]{2,5})\s+(?:price|stock|quote|share)s?$/i);
      if (stockQueryMatch) {
        const symbol = stockQueryMatch[1].toUpperCase();
        console.log(`[Notes] Converting web search for "${searchOp.query}" to stock quote for ${symbol}`);
        // Remove the search op and add stock quote instead
        const idx = operations.indexOf(searchOp);
        if (idx > -1) {
          operations.splice(idx, 1);
        }
        if (!operations.find(o => o.type === 'get_stock_quote' && o.symbol === symbol)) {
          operations.push({ type: 'get_stock_quote', symbol });
        }
      }
    }
  }

  if (operations.length > 0) {
    console.log('[Notes] Parsed web operations from intent:', operations);
  }

  return operations.slice(0, 5);
}

function stripVerboseReasoning(content: string): string {
  // Remove <think>...</think> blocks entirely (not just tags)
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // Remove all tool XML tags
  cleaned = cleaned.replace(/<(?:search_web|get_stock_quote|get_market_movers|get_mlb_standings|get_weather|fetch_url)[^>]*\/?>/gi, '');
  
  // AGGRESSIVE: Remove everything from start through "Thinking Process" sections
  cleaned = cleaned.replace(/^[\s\S]*?Thinking Process:[\s\S]*?(?=\n\n(?:The search results|Based on|Here are|The current|The top|\*\*[A-Z]|#{1,3}\s))/gi, '');
  
  // Remove verbose intro that starts with "The user is asking/wants"
  cleaned = cleaned.replace(/^The user (?:is asking|wants|asked|requested)[\s\S]*?(?=\n\n(?:The |Here|Based|I can|#{1,3}\s|\*\*))/i, '');
  
  // Remove "I can search..." action suggestions at start
  cleaned = cleaned.replace(/^I can (?:search|fetch|get|look up)[^\n]*\n+\[ACTION:[^\]]+\]\n*/i, '');
  
  // Remove standalone [ACTION:...] lines
  cleaned = cleaned.replace(/^\[ACTION:[^\]]+\]\s*\n*/gim, '');
  
  // Remove "*Self-Correction*" and similar meta sections
  cleaned = cleaned.replace(/\*?(?:Self-Correction|Final Polish|Review against)[^*\n]*\*?:?[\s\S]*?(?=\n\n(?:The |Here|Based|#{1,3}\s|\*\*)|\n\n$)/gi, '');
  
  // Remove numbered analysis steps (1. **Analyze**, 2. **Determine**, etc.)
  cleaned = cleaned.replace(/^\s*\d+\.\s+\*\*(?:Analyze|Determine|Address|Formulate|Final Output|Review|Identify|Gather|Synthesize|Draft|Challenge|Goal|Strategy)[^*]*\*\*:?[^\n]*(?:\n(?!\n).*)*\n?/gim, '');
  
  // Remove bullet points that are meta-commentary
  cleaned = cleaned.replace(/^\s*\*\s+\*?(?:Goal|Challenge|Strategy|Approach|Main Point)[\s\S]*?(?=\n\n|\n\*\s+[A-Z])/gim, '');
  
  // Remove lines that are purely meta-commentary
  cleaned = cleaned.replace(/^\s*\((?:Drafting|This leads|Self-Correction|This fits|Not applicable)[^)]*\)\s*$/gim, '');
  
  // Remove status messages
  cleaned = cleaned.replace(/^\s*(?:Analyzing|Processing|Fetching|Loading)\s+\w+\.{3}\s*$/gim, '');
  
  // Remove "Key insights gathered from the search" redundant headers
  cleaned = cleaned.replace(/^Key insights gathered from the search results indicate:\s*\n/gim, '');
  
  // Clean up multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
}

function cleanWebOperationTags(content: string): string {
  return content
    // Remove <think>...</think> blocks entirely
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Remove all variations of tool XML tags
    .replace(/<search_web[^>]*\/?>/gi, '')
    .replace(/<get_stock_quote[^>]*\/?>/gi, '')
    .replace(/<get_market_movers[^>]*\/?>/gi, '')
    .replace(/<get_mlb_standings[^>]*\/?>/gi, '')
    .replace(/<get_weather[^>]*\/?>/gi, '')
    .replace(/<fetch_url[^>]*\/?>/gi, '')
    // Remove tool mentions in backticks (e.g., `<get_stock_quote>`)
    .replace(/`<(?:search_web|get_stock_quote|get_market_movers|get_mlb_standings|get_weather|fetch_url)[^`]*>`/gi, 'the tool')
    // Remove "Analyzing results..." status lines
    .replace(/^\s*Analyzing results\.{3}\s*$/gim, '')
    .trim();
}

// For thinking panel: convert XML tags to readable tool names instead of removing
function cleanThinkingContent(content: string): string {
  return content
    // Remove <think>...</think> blocks
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Convert tool XML tags to readable names
    .replace(/<search_web\s+query="([^"]+)"[^>]*\/?>/gi, '`search_web` with query "$1"')
    .replace(/<search_web\s+query='([^']+)'[^>]*\/?>/gi, "`search_web` with query '$1'")
    .replace(/<get_stock_quote\s+symbol="([^"]+)"[^>]*\/?>/gi, '`get_stock_quote` for $1')
    .replace(/<get_stock_quote\s+symbol='([^']+)'[^>]*\/?>/gi, '`get_stock_quote` for $1')
    .replace(/<get_market_movers[^>]*\/?>/gi, '`get_market_movers`')
    .replace(/<get_mlb_standings[^>]*\/?>/gi, '`get_mlb_standings`')
    .replace(/<fetch_url[^>]*\/?>/gi, '`fetch_url`')
    // Clean up backtick mentions
    .replace(/`<(\w+)[^`]*>`/gi, '`$1`')
    .trim();
}

function splitThinkingFromResponse(content: string): { thinking: string; response: string } {
  // Remove <think>...</think> blocks first
  const withoutThinkTags = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // Clean tool tags
  const cleaned = cleanWebOperationTags(withoutThinkTags);
  
  const firstLine = cleaned.trim().split('\n')[0] || '';
  
  // Check if content starts with clear THINKING patterns FIRST
  // These patterns indicate AI reasoning that should go to thinking panel
  const startsWithThinking = /^(?:The user (?:is asking|wants|asked|requested)|I need |I will |I must |I should |Let me |To provide |To answer |This is a (?:subjective|request|question)|\d+\.\s+\*\*)/i.test(firstLine);
  
  // Also check for "Here's a thinking process" or numbered steps anywhere in content
  const hasThinkingProcess = /Here's a thinking process|^\d+\.\s+\*\*(?:Acknowledge|Suggest|Format|Analyze|Determine)/im.test(cleaned);
  
  if (startsWithThinking || hasThinkingProcess) {
    // Find where the actual response starts - prioritize "Final Output" patterns
    const responseStartPatterns = [
      // "Final Output Generation" or similar
      /\n+(?:\d+\.\s*)?\*?\*?\(?(?:Final (?:Output|Response|Answer)|Execution)\)?:?\*?\*?\.?\s*\n/i,
      // Standard summary/conclusion markers  
      /\n\n(?:#{1,3}\s*(?:Summary|Conclusion|Answer|Result|Key Takeaway))/i,
      /\n\n(?:\*\*(?:Summary|Conclusion|Answer|Key Takeaway))/i,
      /\n\n(?:In (?:summary|conclusion),)/i,
      /\n\n(?:The (?:top|best|current|answer|result|summary))/i,
      /\n\n(?:Based on (?:the above|this analysis|these results))/i,
      // [ACTION:...] tag followed by actual response
      /\[ACTION:[^\]]+\]\s*\n+(?=\S)/i,
    ];
    
    for (const pattern of responseStartPatterns) {
      const match = cleaned.match(pattern);
      if (match && match.index !== undefined) {
        const thinking = cleaned.substring(0, match.index + (match[0].length || 0)).trim();
        // For ACTION tags, include everything after; for others, include the match
        const responseStart = pattern.source.includes('ACTION') 
          ? match.index + match[0].length
          : match.index;
        const response = cleaned.substring(responseStart).trim();
        return { thinking, response };
      }
    }
    
    // No clear response found - everything is thinking for now
    return { thinking: cleaned.trim(), response: '' };
  }
  
  // Check if content starts with clear RESPONSE indicators (not thinking)
  const startsWithResponse = /^(?:#|##|###|\*\*[A-Z]|[-*]\s|Good |Here (?:are|is)|The (?:search|top|best|current)|Based on|According to|As of |Currently)/i.test(firstLine);
  
  if (startsWithResponse) {
    return { thinking: '', response: cleaned.trim() };
  }
  
  // Check for "Thinking Process:" delimiter - everything before is thinking
  const thinkingProcessMatch = cleaned.match(/^([\s\S]*?(?:Thinking Process|Here's a thinking)[^\n]*[\s\S]*?)(\n\n(?:In summary|In conclusion|The (?:top|best|search|answer)|Based on|#{1,3}\s)[\s\S]*)$/i);
  if (thinkingProcessMatch) {
    const thinking = thinkingProcessMatch[1].trim();
    const response = thinkingProcessMatch[2].trim();
    return { thinking, response };
  }
  
  if (!startsWithThinking) {
    // No clear thinking, treat as response
    return { thinking: '', response: cleaned.trim() };
  }
  
  // Split into lines for pattern matching
  const lines = cleaned.split('\n');
  
  // Patterns that indicate a line is part of thinking/reasoning
  const thinkingPatterns = [
    /\.{3}\s*$/,  // Lines ending with "..."
    /^(?:The user |I need to |I will |I must |I should |Let me |This is a |This requires )/i,
    /^(?:To provide |To find |To get |To answer |Since |Looking at |Looking for )/i,
    /^(?:Here's a thinking|Here's my |Thinking Process|My approach|Self-Correction)/i,
    /^\d+\.\s+\*?\*?(?:Analyze|Determine|Review|Synthesize|Structure|Format|Draft|Final|Address|Formulate|Identify|Gather|Check)/i,
    /^[\s]*\*\s*\*?(?:Main Point|Key Takeaway|Tone|Format|Refining|Goal|Approach)/i,
    /\(This leads to|This leads to the final|Drafting the response/i,
    /^(?:First,? I|Next,? I|Then,? I|Finally,? I)/i,  // Sequential reasoning
    /^<get_\w+[^>]*\/?>\s*$/i,  // Tool XML tags on their own line
    /^Analyzing results/i,  // Status messages
  ];
  
  // Patterns that indicate actual response content has started
  const responsePatterns = [
    /^(?:The search results|Here is the|Here's the|Here are the|Based on|According to)/i,
    /^(?:As of |Currently,|The top |The best |The current )/i,  // Sports/rankings
    /^(?:Key takeaways|Summary|Sources:|##|\*\*[A-Z])/i,
    /^(?:I am unable|I cannot|Unfortunately|To get the most)/i,
    /^\d+\.\s+(?:\*\*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\*\*)?(?:\s*[-–—]|\s*:)/,  // Numbered lists with names (1. **Yankees** -)
  ];
  
  let lastThinkingLineIndex = -1;
  let firstResponseLineIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Check for thinking patterns
    for (const pattern of thinkingPatterns) {
      if (pattern.test(line)) {
        lastThinkingLineIndex = i;
        break;
      }
    }
    
    // Check for response patterns (only count if after some thinking)
    if (firstResponseLineIndex === -1 && i > 0) {
      for (const pattern of responsePatterns) {
        if (pattern.test(line)) {
          firstResponseLineIndex = i;
          break;
        }
      }
    }
  }
  
  // Determine split point - prefer response pattern if found after thinking
  let splitIndex = -1;
  if (firstResponseLineIndex > 0 && firstResponseLineIndex > lastThinkingLineIndex) {
    splitIndex = firstResponseLineIndex;
  } else if (lastThinkingLineIndex >= 0 && lastThinkingLineIndex < lines.length - 1) {
    splitIndex = lastThinkingLineIndex + 1;
  }
  
  if (splitIndex > 0) {
    const thinking = lines.slice(0, splitIndex).join('\n').trim();
    const response = stripVerboseReasoning(lines.slice(splitIndex).join('\n')).trim();
    if (response) {
      return { thinking, response };
    }
  }
  
  // If we found thinking patterns but no clear response yet
  if (lastThinkingLineIndex >= 0) {
    // Still in thinking phase - no response yet
    return { thinking: cleaned.trim(), response: '' };
  }
  
  // No thinking patterns - treat as pure response
  return { thinking: '', response: cleaned.trim() };
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

// Final aggressive cleanup - strip ALL reasoning/thinking patterns
function finalCleanupResponse(content: string): string {
  if (!content) return '';
  
  let cleaned = content;
  
  // MOST AGGRESSIVE: If content contains "Thinking Process:", strip everything up to the actual summary
  const thinkingProcessMatch = cleaned.match(/Thinking Process:[\s\S]*?\n\n((?:Based on|The (?:item|product|search|results)|#{1,3}\s*(?:Product|Summary|Key))[\s\S]*)/i);
  if (thinkingProcessMatch) {
    cleaned = thinkingProcessMatch[1];
  }
  
  // AGGRESSIVE: Strip everything from start if it begins with thinking patterns
  if (/^(?:The user (?:is asking|wants|asked|requested)|Thinking Process:|Here's a thinking|Action Plan:)/i.test(cleaned)) {
    // Find where actual answer starts
    const answerPatterns = [
      /\n\n#{1,3}\s*(?:Product|Summary|Key|Sources|Answer|Results)/i,
      /\n\n\*\*(?:Product|Summary|Key|Sources|Answer)/i,
      /\n\nIn (?:summary|conclusion)/i,
      /\n\nThe (?:search results|item|product|top|best|current|answer)/i,
      /\n\nBased on (?:the (?:search|above)|this|these|my)/i,
    ];
    
    for (const pattern of answerPatterns) {
      const match = cleaned.match(pattern);
      if (match && match.index !== undefined) {
        cleaned = cleaned.substring(match.index + 2); // +2 to skip the \n\n
        break;
      }
    }
  }
  
  // Remove "Here's a thinking process" or "Thinking Process:" sections entirely
  cleaned = cleaned.replace(/(?:Here's a thinking process|Thinking Process:?)[\s\S]*?(?=\n\n(?:#{1,3}|In summary|The (?:item|product|top|best|search|answer)|Based on|\*\*(?:Product|Summary)))/gi, '');
  
  // Remove numbered analysis steps (1. **Analyze the Request:**)
  cleaned = cleaned.replace(/^\s*\d+\.\s*\*?\*?(?:Analyze|Determine|Review|Synthesize|Draft|Final|Source|Data|Identify|Address|Structure|Self-Correction)[^*\n]*\*?\*?:?[^\n]*(?:\n(?!\n|\d+\.).*)*\n?/gim, '');
  
  // Remove bullet points that are source analysis (* **Source 1 (sportsdunia):**)
  cleaned = cleaned.replace(/^\s*\*\s+\*\*Source \d+[^*]*\*\*:?[^\n]*\n?/gim, '');
  
  // Remove remaining meta-commentary
  cleaned = cleaned
    .replace(/^The user (?:is asking|wants|asked)[^\n]*\n+/i, '')
    .replace(/^I can (?:search|fetch|get)[^\n]*\n+/i, '')
    .replace(/^\[ACTION:[^\]]+\]\s*\n*/gim, '')
    .replace(/^This is a (?:subjective|request)[^\n]*\n+/i, '')
    .replace(/^\s*\*\s+\*?(?:Goal|Challenge|Strategy|Main Point|Core Theme)[^\n]*\n/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}

async function formatSearchResults(results: WebSearchResult[], autoFetchTop: boolean = true): Promise<string> {
  if (results.length === 0) return 'No search results found.';
  
  let formatted = '**Web Search Results:**\n\n';
  results.forEach((result, i) => {
    formatted += `${i + 1}. **[${result.title}](${result.url})**\n`;
    formatted += `   ${result.snippet}\n\n`;
  });
  
  // Auto-fetch the top result to get actual content
  // Skip fetching for weather sites - snippets are more useful than scraped JS content
  const weatherSites = ['weather.com', 'accuweather.com', 'wunderground.com', 'weather.gov', 'theweathernetwork.com', 'foxweather.com'];
  const isWeatherQuery = results.some(r => weatherSites.some(site => r.url.includes(site)));
  
  if (autoFetchTop && results.length > 0 && !isWeatherQuery) {
    const topUrl = results[0].url;
    console.log(`[Notes] Auto-fetching top search result: ${topUrl}`);
    
    // Use headless browser for JS-heavy sites
    const jsHeavySites = ['espn.com', 'atptour.com', 'sofascore.com', 'flashscore.com'];
    const needsRendering = jsHeavySites.some(site => topUrl.includes(site));
    
    let content: WebContent | null = null;
    if (needsRendering) {
      console.log(`[Notes] Using headless browser for JS-heavy site: ${topUrl}`);
      content = await fetchUrlContentRendered(topUrl);
    } else {
      content = await fetchUrlContent(topUrl);
    }
    
    if (content && content.content) {
      formatted += '\n---\n**Content from top result:**\n\n';
      // Truncate to reasonable length for AI context
      const truncated = content.content.length > 4000 
        ? content.content.substring(0, 4000) + '\n\n[Content truncated...]'
        : content.content;
      formatted += truncated;
    }
  } else if (isWeatherQuery) {
    console.log('[Notes] Weather query detected - using snippets only (weather sites are JS-heavy)');
  }
  
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

function formatMLBStandings(data: MLBStandings): string {
  let result = `## ⚾ MLB Standings (${data.season} Season)\n\n`;
  
  // Group by league and division
  const grouped: Record<string, Record<string, MLBTeamStanding[]>> = {};
  
  for (const team of data.standings) {
    if (!grouped[team.league]) {
      grouped[team.league] = {};
    }
    if (!grouped[team.league][team.division]) {
      grouped[team.league][team.division] = [];
    }
    grouped[team.league][team.division].push(team);
  }
  
  // Sort leagues: American League first, then National League
  const leagues = Object.keys(grouped).sort((a, b) => {
    if (a.includes('American')) return -1;
    if (b.includes('American')) return 1;
    return a.localeCompare(b);
  });
  
  for (const league of leagues) {
    result += `### ${league}\n\n`;
    
    // Sort divisions: East, Central, West
    const divisions = Object.keys(grouped[league]).sort((a, b) => {
      const order = ['East', 'Central', 'West'];
      const aOrder = order.findIndex(o => a.includes(o));
      const bOrder = order.findIndex(o => b.includes(o));
      return aOrder - bOrder;
    });
    
    for (const division of divisions) {
      const teams = grouped[league][division];
      // Sort by wins descending
      teams.sort((a, b) => b.wins - a.wins);
      
      result += `#### ${division}\n`;
      result += '| Team | W | L | PCT | GB | L10 | STRK |\n';
      result += '|------|---|---|-----|----|----|------|\n';
      
      for (const team of teams) {
        result += `| ${team.team_name} | ${team.wins} | ${team.losses} | ${team.pct} | ${team.games_back} | ${team.last_ten} | ${team.streak} |\n`;
      }
      result += '\n';
    }
  }
  
  result += `\n*Data from MLB Stats API*`;
  return result;
}

function formatWeather(weather: WeatherData): string {
  const conditionEmoji = getWeatherEmoji(weather.condition);
  return `${conditionEmoji} **${weather.location} Weather**

- **Currently:** ${weather.current_temp}, ${weather.condition}
- **Feels Like:** ${weather.feels_like}
- **${weather.forecast}**
- **Humidity:** ${weather.humidity}
- **Wind:** ${weather.wind}`;
}

function getWeatherEmoji(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes('sun') || c.includes('clear')) return '☀️';
  if (c.includes('cloud') && c.includes('part')) return '⛅';
  if (c.includes('cloud') || c.includes('overcast')) return '☁️';
  if (c.includes('rain') || c.includes('drizzle')) return '🌧️';
  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('snow')) return '❄️';
  if (c.includes('fog') || c.includes('mist')) return '🌫️';
  return '🌤️';
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
  // Light cleanup - only remove clearly unhelpful words, keep meaningful terms like "top", "best"
  let simplifiedQuery = query
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/gi, '')
    // Only remove action verbs that don't add search value
    .replace(/\b(?:looking for|searching for|finding|getting|show me|tell me about|what are|who are)\b/gi, '')
    .replace(/\b(?:currently|right now|as of today|at the moment)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If query became too short, use original
  if (simplifiedQuery.length < 5) {
    simplifiedQuery = query.replace(/\s+/g, ' ').trim();
  }

  console.log(`[Notes] Falling back to built-in web search with query:`, simplifiedQuery);

  // Try with simplified query
  let results = await invoke<WebSearchResult[]>('search_web', { query: simplifiedQuery, maxResults: 5 });

  // If no results, try even more minimal (just nouns)
  if (results.length === 0) {
    // Extract just the core subject (e.g., "MLB teams standings" → "MLB standings")
    const minimalQuery = simplifiedQuery
      .replace(/\b(?:teams|players|list|results)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (minimalQuery.length > 3 && minimalQuery !== simplifiedQuery) {
      console.log(`[Notes] Retrying with minimal query:`, minimalQuery);
      results = await invoke<WebSearchResult[]>('search_web', { query: minimalQuery, maxResults: 5 });
    }
  }
  
  return results;
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

async function fetchUrlContentRendered(url: string): Promise<WebContent | null> {
  try {
    const invoke = await getInvoke();
    console.log(`[Notes] Fetching URL with headless browser: ${url}`);
    const content = await invoke<WebContent>('fetch_url_rendered', { url });
    console.log(`[Notes] Fetched rendered ${content.title}, ${content.content.length} chars`);
    return content;
  } catch (error) {
    console.error(`[Notes] Failed to fetch rendered URL:`, error);
    // Fallback to regular fetch
    return fetchUrlContent(url);
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
        streamId: conversationId,
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
        streamId: conversationId,
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
        streamId: conversationId,
      });
    } else if (settings.aiProvider === 'copilot') {
      await invoke('chat_copilot', {
        model: settings.model || 'gpt-4o',
        messages: summaryMessages,
        temperature: 0.5,
        maxTokens: settings.maxTokens,
        conversationId,
        streamId: conversationId,
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
        streamId: conversationId,
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
    updateMessageId,
    setIsLoading,
    setIsStreaming,
    getActiveConversation,
  } = useNotesStore();

  const [input, setInput] = useState('');
  const [webStatus, setWebStatus] = useState<string | null>(null);
  const [streamingPhase, setStreamingPhase] = useState<'streaming' | 'executing' | 'done'>('streaming');
  const [rawThinkingContent, setRawThinkingContent] = useState('');
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDropUnlistenRef = useRef<(() => void) | null>(null);
  const handleFileSelectRef = useRef<((files: FileList, source: string, sourcePaths?: string[]) => void) | null>(null);
  const isProcessingFilesRef = useRef(false);
  const lastDropTimeRef = useRef(0);

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

  // Listen for token usage events and record them
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    
    const setupTokenUsageListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const invoke = await getInvoke();
        
        // Initialize usage database
        await invoke('init_usage_db');
        
        unlistenFn = await listen('token-usage', async (event: any) => {
          const { model, provider, prompt_tokens, completion_tokens } = event.payload;
          console.log(`[Notes] Token usage: ${model} (${provider}) - prompt: ${prompt_tokens}, completion: ${completion_tokens}`);
          
          try {
            await invoke('record_token_usage', {
              model,
              provider,
              promptTokens: prompt_tokens,
              completionTokens: completion_tokens,
            });
          } catch (error) {
            console.error('[Notes] Failed to record token usage:', error);
          }
        });
      } catch (error) {
        console.error('[Notes] Failed to set up token usage listener:', error);
      }
    };
    
    setupTokenUsageListener();
    
    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Debug: log when attachments change
  useEffect(() => {
    console.log('[Notes] Attachments state changed:', attachments.length, attachments.map(a => ({ id: a.id, type: a.type, preview: a.preview?.substring(0, 50) })));
  }, [attachments]);

  // Auto-resize textarea on window resize
  useEffect(() => {
    const resizeTextarea = () => {
      if (inputRef.current && input) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
      }
    };

    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [input]);

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
          return await formatSearchResults(searchResults);
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
        } else if (op.type === 'get_mlb_standings') {
          setWebStatus('Getting MLB standings...');
          console.log('[Notes] Executing MLB standings');
          const invoke = await getInvoke();
          const standings = await invoke<MLBStandings>('get_mlb_standings', {});
          console.log('[Notes] MLB standings:', standings);
          return formatMLBStandings(standings);
        } else if (op.type === 'get_weather' && op.location) {
          setWebStatus(`Getting weather for ${op.location}...`);
          console.log('[Notes] Executing weather for:', op.location);
          const invoke = await getInvoke();
          const weather = await invoke<WeatherData>('get_weather', { location: op.location });
          console.log('[Notes] Weather data:', weather);
          return formatWeather(weather);
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
    if ((!input.trim() && attachments.length === 0) || !activeConversationId || isLoading) return;

    const userMessage = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
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
      
      // Convert attachments to MessageAttachment format for AI
      const messageAttachments: MessageAttachment[] = currentAttachments.map(att => ({
        id: att.id,
        type: att.type,
        name: att.file.name,
        mimeType: att.mimeType,
        data: att.base64Data,
      }));
      
      // Add user message with attachments
      // Generate descriptive message for file-only submissions
      let displayContent = userMessage;
      if (!displayContent && currentAttachments.length > 0) {
        const fileNames = currentAttachments.map(a => a.file.name);
        const fileTypes = currentAttachments.map(a => a.type);
        const hasImages = fileTypes.includes('image');
        const hasPdfs = fileTypes.includes('pdf');
        const hasDocs = fileTypes.includes('document');
        
        if (currentAttachments.length === 1) {
          displayContent = `Analyze: ${fileNames[0]}`;
        } else if (hasImages && !hasPdfs && !hasDocs) {
          displayContent = `Analyze ${currentAttachments.length} images`;
        } else if (hasPdfs || hasDocs) {
          displayContent = `Analyze ${currentAttachments.length} document(s)`;
        } else {
          displayContent = `Analyze ${currentAttachments.length} file(s)`;
        }
      }
      
      const savedUserMessage = await invoke('add_message', {
        conversationId: activeConversationId,
        role: 'user',
        content: displayContent || '',
        attachments: messageAttachments.length > 0 ? JSON.stringify(messageAttachments) : null,
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
      let thinkingStart: number | null = null;
      
      // Reset thinking state for new message
      setStreamingPhase('streaming');
      setThinkingStartTime(null);
      setThinkingDuration(null);
      setRawThinkingContent('');
      
      // Function to extract ONLY the final answer (table or summary sentence + content)
      const extractFinalResponse = (text: string): string => {
        // Strategy 1: Find the LAST "As of" or "Based on" sentence and everything after
        // This is typically the intro to the final answer
        const lastIntroPatterns = [
          // "As of the data provided, the top 10 players..." followed by table
          /(?:^|\n)(As of [^\n]+(?:are|is):[^\n]*)([\s\S]*$)/i,
          // "Based on the search results, here are..."
          /(?:^|\n)(Based on [^\n]+(?:are|is):[^\n]*)([\s\S]*$)/i,
          // "Here are the current top 10..."
          /(?:^|\n)(Here (?:are|is) the [^\n]+:)([\s\S]*$)/i,
        ];
        
        for (const pattern of lastIntroPatterns) {
          const matches = [...text.matchAll(new RegExp(pattern.source, 'gi'))];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const intro = lastMatch[1].trim();
            const content = lastMatch[2].trim();
            if (content.includes('|')) {
              // Has a table
              return intro + '\n\n' + content;
            }
          }
        }
        
        // Strategy 2: Just find the table with its intro line
        const tableWithIntro = text.match(/([^\n]*(?:are|is):\s*)\n*(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/i);
        if (tableWithIntro) {
          return tableWithIntro[1].trim() + '\n\n' + tableWithIntro[2];
        }
        
        // Strategy 3: Just the table alone
        const tableOnly = text.match(/(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/);
        if (tableOnly) {
          return tableOnly[1];
        }
        
        return '';
      };
      
      const unlisten = await listenFn(`ai-stream-${conversationId}`, (event: any) => {
        const { content, done } = event.payload;
        if (content) {
          // Track when thinking starts
          if (!thinkingStart) {
            thinkingStart = Date.now();
            setThinkingStartTime(thinkingStart);
          }
          
          fullContent += content;
          const cleanedContent = cleanWebOperationTags(fullContent);
          
          // During streaming: ONLY show in thinking panel, NOT in response panel
          setRawThinkingContent(cleanedContent);
          // Response panel stays empty until streaming is complete
        }
        if (done) {
          // Calculate thinking duration
          if (thinkingStart) {
            const duration = Math.round((Date.now() - thinkingStart) / 1000);
            setThinkingDuration(duration);
          }
          
          // Update thinking panel only - don't update response yet
          // Response will be updated after web ops complete (or below if no web ops)
          const cleanedContent = cleanWebOperationTags(fullContent);
          setRawThinkingContent(cleanedContent);
          
          // DON'T set streamingPhase or update message here
          // That happens after web ops check below
        }
      });

      // Get AI settings
      const settings = getAISettings();
      
      // Build user content - include fetched URL content if any
      let userContent = fetchedContent 
        ? `${userMessage}\n${fetchedContent}`
        : userMessage;
      
      // Add document text content for PDFs/docs
      const documentTexts = currentAttachments
        .filter(att => att.extractedText)
        .map(att => `[Content from ${att.file.name}]:\n${att.extractedText}`)
        .join('\n\n');
      
      if (documentTexts) {
        userContent = userContent ? `${userContent}\n\n${documentTexts}` : documentTexts;
      }
      
      // Build messages with system prompt for web access
      const systemMessage = { role: 'system', content: getWebAccessSystemPrompt() };
      
      // Build messages with attachments for the current user message
      const currentUserMessage: { role: string; content: string; attachments?: MessageAttachment[] } = {
        role: 'user',
        content: userContent || 'Please analyze the attached file(s).',
      };
      
      // Only add image attachments to AI request (PDFs/docs are already in text content)
      const imageAttachments = messageAttachments.filter(att => att.type === 'image');
      if (imageAttachments.length > 0) {
        currentUserMessage.attachments = imageAttachments;
      }
      
      // Context window management with summarization
      const contextSummaryEnabled = settings.contextSummaryEnabled ?? true;
      const contextTokenLimit = settings.contextTokenLimit ?? 8000;
      
      let conversationMessages: Array<{ role: string; content: string }> = [];
      
      // Check if we need to use context summarization
      const allMessages = messages.map(m => ({ role: m.role, content: m.content }));
      const totalTokens = estimateMessagesTokens(allMessages);
      
      if (contextSummaryEnabled && totalTokens > contextTokenLimit) {
        // Get stored context summary
        const storedSummary = await invoke<string | null>('get_conversation_summary', { id: conversationId });
        
        if (storedSummary) {
          // Use summary + recent messages
          console.log(`[Notes] Using context summary (total tokens: ${totalTokens}, limit: ${contextTokenLimit})`);
          const summaryMessage = { role: 'system', content: `[Previous conversation summary]: ${storedSummary}` };
          
          // Take recent messages that fit within limit
          const MAX_RECENT_MESSAGES = 6;
          const recentMessages = messages.slice(-MAX_RECENT_MESSAGES);
          conversationMessages = [
            summaryMessage,
            ...recentMessages.map(m => ({ role: m.role, content: m.content })),
          ];
        } else {
          // Generate a new summary of old messages
          console.log(`[Notes] Generating context summary (total tokens: ${totalTokens}, limit: ${contextTokenLimit})`);
          setWebStatus('Summarizing conversation context...');
          
          // Keep last 6 messages separate, summarize the rest
          const messagesToSummarize = messages.slice(0, -6);
          const recentMessages = messages.slice(-6);
          
          if (messagesToSummarize.length > 2) {
            // Generate summary using AI
            const summaryPrompt = `Summarize the key points, decisions, and context from this conversation in a concise paragraph that can be used to continue the discussion:\n\n${messagesToSummarize.map(m => `${m.role}: ${m.content}`).join('\n\n')}`;
            
            const summaryConversationId = `summary-${Date.now()}`;
            let summaryContent = '';
            
            const { listen: listenFn } = await import('@tauri-apps/api/event');
            const summaryUnlisten = await listenFn(`ai-stream-${summaryConversationId}`, (event: any) => {
              if (event.payload.content) {
                summaryContent += event.payload.content;
              }
            });
            
            try {
              if (settings.aiProvider === 'ollama') {
                await invoke('chat_ollama', {
                  baseUrl: settings.ollamaUrl || 'http://localhost:11434',
                  model: settings.model || 'gemma4:latest',
                  messages: [{ role: 'user', content: summaryPrompt }],
                  temperature: 0.3,
                  maxTokens: 1000,
                  conversationId: summaryConversationId,
                  streamId: summaryConversationId,
                });
              } else if (settings.aiProvider === 'copilot') {
                await invoke('chat_copilot', {
                  model: settings.model || 'gpt-4o',
                  messages: [{ role: 'user', content: summaryPrompt }],
                  temperature: 0.3,
                  maxTokens: 1000,
                  conversationId: summaryConversationId,
                  streamId: summaryConversationId,
                });
              } else {
                // Default to openai-compatible
                const baseUrl = settings.aiProvider === 'openai' 
                  ? 'https://api.openai.com/v1'
                  : settings.aiProvider === 'anthropic'
                  ? 'https://api.anthropic.com/v1'
                  : settings.customBaseUrl;
                const apiKey = settings.aiProvider === 'openai'
                  ? settings.openaiKey
                  : settings.aiProvider === 'anthropic'
                  ? settings.anthropicKey
                  : settings.customApiKey;
                
                await invoke('chat_openai', {
                  baseUrl,
                  apiKey,
                  model: settings.model,
                  messages: [{ role: 'user', content: summaryPrompt }],
                  temperature: 0.3,
                  maxTokens: 1000,
                  conversationId: summaryConversationId,
                  streamId: summaryConversationId,
                });
              }
              
              summaryUnlisten();
              
              // Store the summary
              if (summaryContent) {
                await invoke('update_conversation_summary', {
                  id: conversationId,
                  contextSummary: summaryContent,
                });
                console.log(`[Notes] Stored context summary (${summaryContent.length} chars)`);
              }
              
              // Use summary + recent messages
              const summaryMessage = { role: 'system', content: `[Previous conversation summary]: ${summaryContent}` };
              conversationMessages = [
                summaryMessage,
                ...recentMessages.map(m => ({ role: m.role, content: m.content })),
              ];
            } catch (error) {
              console.error('[Notes] Failed to generate context summary:', error);
              // Fall back to using recent messages only
              const MAX_HISTORY_MESSAGES = 20;
              conversationMessages = messages.slice(-MAX_HISTORY_MESSAGES).map(m => ({ role: m.role, content: m.content }));
            }
          } else {
            // Not enough messages to summarize, use all
            conversationMessages = allMessages;
          }
          
          setWebStatus(null);
        }
      } else {
        // Within limit or summarization disabled, use recent messages
        const MAX_HISTORY_MESSAGES = 20;
        const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);
        conversationMessages = recentMessages.map(m => ({ role: m.role, content: m.content }));
      }
      
      const messagesForAI = [
        systemMessage,
        ...conversationMessages,
        currentUserMessage,
      ];
      
      console.log(`[Notes] Sending ${messagesForAI.length} messages (from ${messages.length + 1}, estimated ${estimateMessagesTokens(messagesForAI)} tokens)${imageAttachments.length > 0 ? ` with ${imageAttachments.length} image(s)` : ''}`);
      
      try {
        if (settings.aiProvider === 'ollama') {
          await invoke('chat_ollama', {
            baseUrl: settings.ollamaUrl || 'http://localhost:11434',
            model: settings.model || 'gemma4:latest',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
            streamId: conversationId,
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
            streamId: conversationId,
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
            streamId: conversationId,
          });
        } else if (settings.aiProvider === 'copilot') {
          await invoke('chat_copilot', {
            model: settings.model || 'gpt-4o',
            messages: messagesForAI,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            conversationId,
            streamId: conversationId,
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
            streamId: conversationId,
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
            
            // Update THINKING panel only (not response) while summarizing
            setRawThinkingContent(cleanedContent + '\n\n*Analyzing results...*');

            const hasStockOps = webOps.some(op => op.type === 'get_stock_quote' || op.type === 'get_market_movers');
            let summarizedContent = webResults;

            if (hasStockOps) {
              setWebStatus('Using verified stock data...');
            } else {
              // Send results back to AI for summarization
              setWebStatus('Summarizing results...');
              summarizedContent = await summarizeWithAI(
                invoke,
                settings,
                userMessage,
                webResults,
                conversationId + '-summary'
              );
            }
            
            // Update thinking with full content (for thinking panel)
            const fullThinkingContent = cleanedContent 
              ? `${cleanedContent}\n\n---\n\n**Summarized Results:**\n${summarizedContent}`
              : summarizedContent;
            setRawThinkingContent(fullThinkingContent);
            
            // Extract ONLY the final answer for response panel AND for saving
            // Apply finalCleanupResponse to strip any thinking patterns
            const cleanedSummary = finalCleanupResponse(summarizedContent);
            const finalResponse = extractFinalResponse(cleanedSummary);
            const responseToShow = finalResponse || cleanedSummary || summarizedContent;
            updateMessageContent(assistantPlaceholder.id, responseToShow);
            
            // Save ONLY the final response (not thinking)
            fullContent = responseToShow;
            
            // Mark as done - this triggers collapse
            setStreamingPhase('done');
            setWebStatus(null);
          } catch (webError) {
            console.error('[Notes] Web operation execution failed:', webError);
            const errorContent = '*Web search failed. Please try again.*';
            setRawThinkingContent(cleanedContent + '\n\n' + errorContent);
            updateMessageContent(assistantPlaceholder.id, errorContent);
            fullContent = errorContent;
            setStreamingPhase('done');
            setWebStatus(null);
          }
        } else {
          console.log('[Notes] No web operations found in response');
          // No web ops - extract final response and update
          const cleanedContent = cleanWebOperationTags(fullContent);
          
          // Check if there are action tags - if so, preserve them for later execution
          const actionTagMatch = cleanedContent.match(/\[ACTION:[^\]]+\]/g);
          if (actionTagMatch && actionTagMatch.length > 0) {
            // Has action tags - extract ONLY the intro + action tag, discard everything else
            console.log('[Notes] v2: Content has action tags, extracting clean intro + action');
            console.log('[Notes] v2: Raw content length:', cleanedContent.length);
            console.log('[Notes] v2: First 200 chars:', cleanedContent.substring(0, 200));
            
            // Strategy: Find the user-facing intro sentence right before the ACTION tag
            // Pattern: "I can/I'll/Let me..." followed by ACTION tag
            const introActionPattern = /((?:I can|I'll|I will|Let me|Sure,?|Here's|Looking)[^\n]*?\.?\s*\n*\[ACTION:[^\]]+\])/i;
            const introMatch = cleanedContent.match(introActionPattern);
            
            let contentWithAction: string;
            if (introMatch) {
              // Found clean intro + action
              console.log('[Notes] v2: Found intro match, length:', introMatch[1].length);
              contentWithAction = introMatch[1].trim();
            } else {
              console.log('[Notes] v2: No intro match, using fallback');
              // Fallback: just extract the ACTION tag with one line before it
              const actionOnly = cleanedContent.match(/([^\n]*\n?\[ACTION:[^\]]+\])/);
              if (actionOnly) {
                // Clean up any thinking prefixes from that line
                contentWithAction = actionOnly[1]
                  .replace(/^(?:Action Plan|Thinking Process|Here's a thinking|Goal|Strategy)[^\n]*\n*/gim, '')
                  .trim();
              } else {
                // Last resort: just the action tag
                const justAction = cleanedContent.match(/\[ACTION:[^\]]+\]/);
                contentWithAction = justAction ? justAction[0] : cleanedContent;
              }
            }
            
            console.log('[Notes] v2: Final content length:', contentWithAction.length);
            console.log('[Notes] v2: Final content:', contentWithAction.substring(0, 300));
            updateMessageContent(assistantPlaceholder.id, contentWithAction);
            fullContent = contentWithAction;
          } else {
            // No action tags - extract final response normally
            const finalResponse = extractFinalResponse(cleanedContent);
            const responseToShow = finalResponse || finalCleanupResponse(cleanedContent);
            updateMessageContent(assistantPlaceholder.id, responseToShow);
            fullContent = responseToShow;
          }
          setStreamingPhase('done');
        }
      } catch (aiError) {
        console.error('AI chat error:', aiError);
        const errorMsg = aiError instanceof Error ? aiError.message : String(aiError);
        const errorContent = `Error: ${errorMsg}\n\nPlease check your AI settings and make sure the provider is running.`;
        updateMessageContent(assistantPlaceholder.id, errorContent);
        fullContent = errorContent;
        setStreamingPhase('done');
      }

      // Save assistant message - only the final response, not thinking
      const finalContent = fullContent || 'Sorry, I could not generate a response.';
      const savedAssistantMessage = await invoke('add_message', {
        conversationId: activeConversationId,
        role: 'assistant',
        content: finalContent,
        attachments: null,
      }) as Message;

      // Update the local message with the real database ID so future updates work
      updateMessageId(assistantPlaceholder.id, savedAssistantMessage.id);

      unlisten();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setWebStatus(null);
    }
  };

  const processFile = useCallback(async (file: File, sourcePath?: string): Promise<Attachment | null> => {
    const id = crypto.randomUUID();
    const mimeType = file.type || '';
    const fileName = file.name.toLowerCase();
    
    // Check by MIME type first, then fall back to extension
    const isImage = mimeType.startsWith('image/') || 
                    /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/.test(fileName);
    const isPdf = mimeType === 'application/pdf' || fileName.endsWith('.pdf');
    const isDocument = mimeType.includes('wordprocessingml') || 
                       mimeType === 'application/msword' ||
                       /\.(doc|docx)$/.test(fileName);
    
    // Text-based files: code, config, data files
    const textExtensions = /\.(txt|md|markdown|json|xml|html|htm|css|scss|sass|less|js|jsx|ts|tsx|py|rb|java|c|cpp|h|hpp|cs|go|rs|swift|kt|php|sh|bash|zsh|yml|yaml|toml|ini|env|conf|config|cfg|log|csv|sql|graphql|vue|svelte)$/;
    const textMimeTypes = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript'];
    const isText = textMimeTypes.some(t => mimeType.startsWith(t)) || textExtensions.test(fileName);
    
    console.log(`[Notes] Processing file: ${file.name}, type: ${mimeType}, isImage: ${isImage}, isPdf: ${isPdf}, isDoc: ${isDocument}, isText: ${isText}, sourcePath: ${sourcePath || 'none'}`);
    
    if (!isImage && !isPdf && !isDocument && !isText) {
      console.warn('[Notes] Unsupported file type:', mimeType, fileName);
      return null;
    }
    
    const attachment: Attachment = {
      id,
      file,
      type: isImage ? 'image' : isPdf ? 'pdf' : isDocument ? 'document' : 'text',
      mimeType: mimeType || 'application/octet-stream',
      isProcessing: false,
      sourcePath,
    };
    
    try {
      if (isImage) {
        // Create preview URL immediately
        attachment.preview = URL.createObjectURL(file);
        console.log(`[Notes] Created preview URL for image: ${file.name}`);
        
        // Read base64 for sending to AI
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        
        attachment.base64Data = base64;
        console.log(`[Notes] Read base64 for image: ${file.name}, length: ${base64.length}`);
      } else if (isText) {
        // Read text content directly
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
        
        attachment.extractedText = text;
        console.log(`[Notes] Read text file: ${file.name}, length: ${text.length}`);
      } else if (isPdf && sourcePath) {
        // Extract PDF text using Tauri command (only works with file path)
        try {
          const invoke = await getInvoke();
          const text = await invoke<string>('extract_pdf_text', { path: sourcePath });
          attachment.extractedText = text;
          console.log(`[Notes] Extracted PDF text: ${file.name}, length: ${text.length}`);
        } catch (pdfErr) {
          console.error(`[Notes] Failed to extract PDF text:`, pdfErr);
        }
      } else if (isDocument && sourcePath) {
        // Extract DOCX text using Tauri command (only works with file path)
        try {
          const invoke = await getInvoke();
          const text = await invoke<string>('extract_docx_text', { path: sourcePath });
          attachment.extractedText = text;
          console.log(`[Notes] Extracted DOCX text: ${file.name}, length: ${text.length}`);
        } catch (docxErr) {
          console.error(`[Notes] Failed to extract DOCX text:`, docxErr);
        }
      } else {
        // For PDFs/docs without sourcePath (from file picker), we can't extract text yet
        console.log(`[Notes] Added document attachment without text extraction: ${file.name}`);
      }
    } catch (err) {
      console.error('[Notes] Error processing file:', err);
      // Still return the attachment even if processing failed
    }
    
    return attachment;
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | null, source: string = 'unknown', sourcePaths?: string[]) => {
    if (!files || files.length === 0) {
      console.log(`[Notes] No files to process (source: ${source})`);
      return;
    }
    
    // Debounce: prevent duplicate processing within 500ms
    const now = Date.now();
    if (now - lastDropTimeRef.current < 500) {
      console.log(`[Notes] Skipping duplicate file processing (source: ${source}, time since last: ${now - lastDropTimeRef.current}ms)`);
      return;
    }
    
    // Prevent concurrent processing
    if (isProcessingFilesRef.current) {
      console.log(`[Notes] Already processing files, skipping (source: ${source})`);
      return;
    }
    
    lastDropTimeRef.current = now;
    isProcessingFilesRef.current = true;
    
    console.log(`[Notes] Processing ${files.length} file(s) (source: ${source})`);
    
    try {
      const newAttachments: Attachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const sourcePath = sourcePaths?.[i];
        console.log(`[Notes] Processing file ${i + 1}/${files.length}: ${file.name}, path: ${sourcePath || 'none'}`);
        const attachment = await processFile(file, sourcePath);
        if (attachment) {
          newAttachments.push(attachment);
          console.log(`[Notes] Added attachment: ${attachment.id}`);
        }
      }
      
      if (newAttachments.length > 0) {
        console.log(`[Notes] Setting ${newAttachments.length} new attachment(s)`);
        setAttachments(prev => [...prev, ...newAttachments]);
      }
    } finally {
      isProcessingFilesRef.current = false;
    }
  }, [processFile]);

  // Keep ref updated for use in Tauri drag-drop listener
  useEffect(() => {
    handleFileSelectRef.current = handleFileSelect;
  }, [handleFileSelect]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const attachment = prev.find(a => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Notes] Drag enter');
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't log here as it fires continuously
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Notes] Drag leave');
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    console.log(`[Notes] Browser drop event: ${e.dataTransfer.files.length} files`);
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files, 'browser-drop');
    }
  }, [handleFileSelect]);

  // Listen for Tauri file drop events (Tauri intercepts browser drag-drop when dragDropEnabled: true)
  useEffect(() => {
    let mounted = true;
    
    const setupDragDropListener = async () => {
      // Clean up any existing listener first
      if (dragDropUnlistenRef.current) {
        dragDropUnlistenRef.current();
        dragDropUnlistenRef.current = null;
      }
      
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const webview = getCurrentWebviewWindow();
        
        const unlisten = await webview.onDragDropEvent(async (event) => {
          if (!mounted) return;
          
          console.log('[Notes] Tauri drag-drop event:', event.payload.type);
          
          if (event.payload.type === 'over' || event.payload.type === 'enter') {
            setIsDragOver(true);
          } else if (event.payload.type === 'drop') {
            setIsDragOver(false);
            const paths = event.payload.paths;
            console.log('[Notes] Files dropped via Tauri:', paths);
            
            if (paths && paths.length > 0) {
              // Convert file paths to File objects, keeping track of source paths
              const files: File[] = [];
              const sourcePaths: string[] = [];
              const invoke = await getInvoke();
              
              for (const filePath of paths) {
                try {
                  // Get filename from path
                  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
                  
                  // Determine MIME type from extension
                  const ext = fileName.split('.').pop()?.toLowerCase() || '';
                  const mimeTypes: Record<string, string> = {
                    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
                    'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp', 'ico': 'image/x-icon',
                    'pdf': 'application/pdf', 'doc': 'application/msword',
                    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'txt': 'text/plain', 'md': 'text/markdown', 'json': 'application/json',
                    'xml': 'application/xml', 'html': 'text/html', 'htm': 'text/html',
                    'css': 'text/css', 'js': 'text/javascript', 'ts': 'text/typescript',
                    'jsx': 'text/javascript', 'tsx': 'text/typescript',
                    'py': 'text/x-python', 'java': 'text/x-java', 'c': 'text/x-c', 'cpp': 'text/x-c++',
                    'go': 'text/x-go', 'rs': 'text/x-rust', 'yml': 'text/yaml', 'yaml': 'text/yaml',
                    'toml': 'text/toml', 'csv': 'text/csv', 'sql': 'text/sql', 'sh': 'text/x-sh',
                  };
                  const mimeType = mimeTypes[ext] || 'application/octet-stream';
                  const isTextFile = mimeType.startsWith('text/') || ['application/json', 'application/xml'].includes(mimeType);
                  const isImage = mimeType.startsWith('image/');
                  
                  if (isTextFile) {
                    // Read text files using existing read_file command
                    const result = await invoke('read_file', { path: filePath }) as { content: string };
                    const file = new File([result.content], fileName, { type: mimeType });
                    files.push(file);
                    sourcePaths.push(filePath);
                    console.log(`[Notes] Read text file: ${fileName}`);
                  } else if (isImage) {
                    // For images, read binary via Tauri command and convert to File
                    try {
                      const base64Data = await invoke<string>('read_file_base64', { path: filePath });
                      console.log(`[Notes] Read image as base64: ${fileName}, length: ${base64Data.length}`);
                      
                      // Convert base64 to binary
                      const binaryString = atob(base64Data);
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      
                      const blob = new Blob([bytes], { type: mimeType });
                      const file = new File([blob], fileName, { type: mimeType });
                      files.push(file);
                      sourcePaths.push(filePath);
                      console.log(`[Notes] Created File from image: ${fileName}, size: ${file.size}`);
                    } catch (fetchErr) {
                      console.error(`[Notes] Failed to read image ${filePath}:`, fetchErr);
                      // Still add the file as a placeholder so user sees something
                      const file = new File([], fileName, { type: mimeType });
                      files.push(file);
                      sourcePaths.push(filePath);
                    }
                  } else {
                    // For PDFs/docs, create a placeholder File - text will be extracted in processFile
                    const file = new File([], fileName, { type: mimeType });
                    files.push(file);
                    sourcePaths.push(filePath);
                    console.log(`[Notes] Created placeholder for: ${fileName} (will extract text via path)`);
                  }
                } catch (err) {
                  console.error(`[Notes] Failed to read dropped file ${filePath}:`, err);
                }
              }
              
              if (files.length > 0 && handleFileSelectRef.current) {
                // Create a FileList-like object
                const dataTransfer = new DataTransfer();
                files.forEach(f => dataTransfer.items.add(f));
                handleFileSelectRef.current(dataTransfer.files, 'tauri-drop', sourcePaths);
              }
            }
          } else {
            // Any other event type (leave, cancel, etc.)
            setIsDragOver(false);
          }
        });
        
        if (mounted) {
          dragDropUnlistenRef.current = unlisten;
          console.log('[Notes] Tauri drag-drop listener set up');
        } else {
          unlisten();
        }
      } catch (err) {
        console.log('[Notes] Tauri drag-drop not available, using browser events:', err);
      }
    };
    
    setupDragDropListener();
    
    return () => {
      mounted = false;
      if (dragDropUnlistenRef.current) {
        dragDropUnlistenRef.current();
        dragDropUnlistenRef.current = null;
      }
    };
  }, []); // Empty deps - only run once on mount

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  // Handle execution of suggested actions when user clicks
  const handleExecuteAction = async (action: SuggestedAction, messageId: string) => {
    console.log('[Notes] Executing action:', action);
    setWebStatus(`Executing: ${action.label}...`);
    
    try {
      const invoke = await getInvoke();
      let result = '';
      
      switch (action.tool) {
        case 'get_mlb_standings': {
          const standings = await invoke<MLBStandings>('get_mlb_standings', {});
          result = formatMLBStandings(standings);
          break;
        }
        case 'get_stock_quote': {
          // Use param if available, otherwise try to extract ticker from label
          const symbol = action.param || action.label?.match(/\b([A-Z]{1,5})\b/)?.[1];
          if (symbol) {
            const quote = await getStockQuoteWithMCP(symbol);
            result = formatStockQuote(quote);
          }
          break;
        }
        case 'get_market_movers': {
          const movers = await getMarketMoversWithMCP();
          result = formatMarketMovers(movers);
          break;
        }
        case 'search_web': {
          // Use param if available, otherwise fall back to label as the search query
          const query = action.param || action.label;
          if (query) {
            setWebStatus(`Searching: ${query}`);
            const searchResults = await webSearchWithMCP(query);
            const formattedResults = await formatSearchResults(searchResults);
            
            // Summarize the results with AI for a clean response
            setWebStatus('Summarizing results...');
            const currentSettings = getAISettings();
            const summarized = await summarizeWithAI(
              invoke,
              currentSettings,
              query,
              formattedResults,
              activeConversationId || 'action-summary'
            );
            result = summarized || formattedResults;
          }
          break;
        }
        case 'get_weather': {
          const location = action.param || action.label;
          if (location) {
            setWebStatus(`Getting weather for ${location}...`);
            const weather = await invoke<WeatherData>('get_weather', { location });
            result = formatWeather(weather);
          }
          break;
        }
      }
      
      if (result) {
        // Update the message content to include the result
        const existingMessage = messages.find(m => m.id === messageId);
        if (existingMessage) {
          const newContent = result; // Just show the result, not the old content with action tags
          updateMessageContent(messageId, newContent);
          
          // Also save to database so it persists on revisit
          try {
            await invoke('update_message_content', {
              messageId: messageId,
              content: newContent,
            });
            console.log('[Notes] Saved action result to database');
          } catch (saveError) {
            console.error('[Notes] Failed to save action result:', saveError);
          }
        }
      }
    } catch (error) {
      console.error('[Notes] Action execution failed:', error);
    } finally {
      setWebStatus(null);
    }
  };

  return (
    <div 
      className={styles.container}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
          
          // Only apply thinking props to the last assistant message
          const isLastMessage = index === messages.length - 1;
          const isLastAssistant = isLastMessage && message.role === 'assistant';
          
          return (
            <React.Fragment key={message.id}>
              {showDateSeparator && message.created_at && (
                <div className={styles.dateSeparator}>
                  <span>{formatDateSeparator(message.created_at)}</span>
                </div>
              )}
              <MessageBubble
                message={message}
                thinking={isLastAssistant ? rawThinkingContent : undefined}
                hasResponse={!!message.content.trim()}
                thinkingDuration={isLastAssistant && streamingPhase === 'done' ? thinkingDuration : null}
                isThinking={isLastAssistant && streamingPhase !== 'done'}
                onExecuteAction={(action) => handleExecuteAction(action, message.id)}
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

      <div 
        className={`${styles.inputArea} ${isDragOver ? styles.dragOver : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Debug indicator */}
        {attachments.length > 0 && (
          <div style={{ padding: '4px 12px', fontSize: '11px', color: '#4caf50', background: 'rgba(76, 175, 80, 0.1)' }}>
            {attachments.length} file(s) attached
          </div>
        )}
        {attachments.length > 0 && (
          <div className={styles.attachmentPreviews}>
            {attachments.map(attachment => (
              <div key={attachment.id} className={styles.attachmentPreview}>
                {attachment.type === 'image' ? (
                  attachment.preview ? (
                    <img 
                      src={attachment.preview} 
                      alt={attachment.file.name} 
                      className={styles.attachmentThumb}
                      onError={(e) => console.error('[Notes] Image load error:', e)}
                      onLoad={() => console.log('[Notes] Image loaded:', attachment.file.name)}
                    />
                  ) : (
                    <div className={styles.filePreview}>
                      <Image size={24} />
                      <span className={styles.fileName}>{attachment.file.name}</span>
                    </div>
                  )
                ) : attachment.type === 'pdf' ? (
                  <div className={styles.filePreview}>
                    <FileText size={24} />
                    <span className={styles.fileName}>{attachment.file.name}</span>
                  </div>
                ) : attachment.type === 'text' ? (
                  <div className={styles.filePreview}>
                    <FileCode size={24} />
                    <span className={styles.fileName}>{attachment.file.name}</span>
                  </div>
                ) : (
                  <div className={styles.filePreview}>
                    <FileIcon size={24} />
                    <span className={styles.fileName}>{attachment.file.name}</span>
                  </div>
                )}
                <button 
                  className={styles.removeAttachment}
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  title="Remove attachment"
                >
                  <X size={14} />
                </button>
                {attachment.isProcessing && (
                  <div className={styles.processingOverlay}>
                    <Loader2 size={16} className={styles.spinner} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className={styles.inputWrapper}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.go,.rs,.yml,.yaml,.toml,.csv,.sql,.sh"
            multiple
            onChange={(e) => {
              console.log('[Notes] File input changed, files:', e.target.files?.length);
              handleFileSelect(e.target.files, 'file-input');
              // Reset input so same file can be selected again
              e.target.value = '';
            }}
            className={styles.hiddenFileInput}
          />
          <button
            onClick={() => {
              console.log('[Notes] Attach button clicked');
              fileInputRef.current?.click();
            }}
            className={styles.attachBtn}
            disabled={isLoading}
            title="Attach files (images, PDF, documents)"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize textarea
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder={isDragOver ? "Drop files here..." : "Ask anything... (supports images, PDFs, web search & stocks)"}
            className={styles.input}
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            className={styles.sendBtn}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
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
  thinkingDuration?: number | null;
  isThinking?: boolean;
  onExecuteAction?: (action: SuggestedAction) => void;
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

function MessageBubble({ message, showDate = true, thinking, hasResponse, thinkingDuration, isThinking, onExecuteAction }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const isUser = message.role === 'user';
  const isAssistant = !isUser;
  const messageContentRef = useRef<HTMLDivElement>(null);
  
  // Parse suggested actions from message content AND thinking content
  const suggestedActions = React.useMemo(() => {
    if (isUser) return [];
    // Check both message content and thinking content for action tags
    const fromMessage = parseSuggestedActions(message.content);
    const fromThinking = thinking ? parseSuggestedActions(thinking) : [];
    // Combine and dedupe by tool+param
    const all = [...fromMessage, ...fromThinking];
    const seen = new Set<string>();
    return all.filter(a => {
      const key = `${a.tool}:${a.param || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [message.content, thinking, isUser]);
  
  // Get content without action tags and any remaining thinking patterns
  const displayContent = React.useMemo(() => {
    let content = stripActionTags(message.content);
    // Safety net: strip any remaining thinking patterns that might have leaked through
    content = content
      .replace(/^.*?(?:Thinking Process|Here's a thinking|Action Plan)[^\n]*[\s\S]*?(?=\n\n|$)/gim, '')
      .replace(/^\s*\d+\.\s*\*?\*?(?:Analyze|Determine|Review|Draft|Self-Correction)[^\n]*(?:\n(?!\n).*)*\n*/gim, '')
      .replace(/^The user (?:is asking|wants|asked)[^\n]*\n*/i, '')
      .trim();
    return content;
  }, [message.content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse attachments from JSON string
  const parsedAttachments: MessageAttachment[] = React.useMemo(() => {
    if (!message.attachments) return [];
    try {
      return JSON.parse(message.attachments);
    } catch {
      return [];
    }
  }, [message.attachments]);

  // Auto-expand thinking panel during streaming, collapse when response streaming is done
  useEffect(() => {
    if (isThinking && thinking) {
      // Expand while streaming
      setThinkingExpanded(true);
    }
  }, [isThinking, thinking]);

  // Collapse when streaming is done AND response is ready
  useEffect(() => {
    if (!isThinking && thinking && hasResponse) {
      // Streaming is done and response is ready - collapse the thinking panel
      setThinkingExpanded(false);
    }
  }, [isThinking, thinking, hasResponse]);

  // Auto-scroll message during streaming
  useEffect(() => {
    if (thinking && messageContentRef.current) {
      messageContentRef.current.scrollTop = messageContentRef.current.scrollHeight;
    }
  }, [thinking, message.content]);

  // Render thinking header with "Thinking..." or "Thought for Xs"
  const renderThinkingHeader = () => {
    // Use the isThinking prop to determine if currently streaming
    const showHeader = isThinking || (thinkingDuration && thinkingDuration > 0);
    
    if (!showHeader || isUser) return null;
    
    return (
      <div 
        className={styles.thinkingHeader} 
        onClick={() => setThinkingExpanded(!thinkingExpanded)}
      >
        <Brain size={14} className={isThinking ? styles.thinkingIconPulse : styles.thinkingIconStatic} />
        {isThinking ? (
          <span className={styles.thinkingLabel}>Thinking...</span>
        ) : (
          <span className={styles.thinkingLabel}>Thought for {thinkingDuration}s</span>
        )}
        <ChevronDown size={14} className={`${styles.thinkingChevron} ${thinkingExpanded ? styles.rotated : ''}`} />
      </div>
    );
  };

  // Render expanded thinking content (works during streaming and after)
  const renderThinkingContent = () => {
    if (!thinkingExpanded || !thinking || isUser) return null;
    
    return (
      <div className={styles.thinkingContent}>
        <MarkdownRenderer content={cleanThinkingContent(thinking)} />
      </div>
    );
  };

  // Render: response content (thinking is shown via header, not in body)
  const renderBody = () => {
    // User messages always show content
    if (isUser && message.content) {
      return message.content;
    }
    // Show response content if available (even during streaming)
    // Use displayContent which has action tags stripped
    if (displayContent.trim()) {
      return <MarkdownRenderer content={displayContent} />;
    }
    return null;
  };
  
  const handleActionClick = async (action: SuggestedAction) => {
    if (executingAction || !onExecuteAction) return;
    setExecutingAction(action.tool);
    try {
      await onExecuteAction(action);
    } finally {
      setExecutingAction(null);
    }
  };
  
  const renderActionButtons = () => {
    // Hide action buttons if: user message, no actions
    if (isUser || suggestedActions.length === 0) return null;
    
    // Check if content is a "real" response (not just intro text with action tags)
    const strippedContent = stripActionTags(message.content);
    const isJustIntroText = /^(I can|I'll|Let me|Sure|Okay|Here|Getting|Fetching|Looking up)/i.test(strippedContent.trim()) 
      && strippedContent.trim().length < 100;
    
    // Hide buttons if we have a real response (like actual stock data)
    if (hasResponse && !isJustIntroText) return null;
    
    const getActionIcon = (tool: string) => {
      switch (tool) {
        case 'get_mlb_standings': return '⚾';
        case 'get_stock_quote': return '📈';
        case 'get_market_movers': return '📊';
        case 'get_weather': return '🌤️';
        case 'search_web': return '🔍';
        default: return '▶️';
      }
    };
    
    return (
      <div className={styles.actionButtons}>
        {suggestedActions.map((action, idx) => (
          <button
            key={idx}
            className={styles.actionButton}
            onClick={() => handleActionClick(action)}
            disabled={!!executingAction}
          >
            {executingAction === action.tool ? (
              <span className={styles.actionLoading}>Loading...</span>
            ) : (
              <>
                <span className={styles.actionIcon}>{getActionIcon(action.tool)}</span>
                <span>{action.label}</span>
              </>
            )}
          </button>
        ))}
      </div>
    );
  };

  const renderAttachments = () => {
    if (parsedAttachments.length === 0) return null;
    
    return (
      <div className={styles.messageAttachments}>
        {parsedAttachments.map((att, idx) => {
          if (att.type === 'image' && att.data) {
            const imageUrl = `data:${att.mimeType};base64,${att.data}`;
            return (
              <div key={idx} className={styles.messageImageContainer}>
                <img 
                  src={imageUrl} 
                  alt={att.name || 'Attached image'}
                  className={styles.messageImage}
                  onClick={() => setExpandedImage(imageUrl)}
                />
              </div>
            );
          }
          if (att.type === 'pdf' || att.type === 'document') {
            return (
              <div key={idx} className={styles.messageFileAttachment}>
                <FileText size={18} />
                <span>{att.name || 'Document'}</span>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  const bodyContent = renderBody();
  
  return (
    <div className={`${styles.messageBubble} ${isUser ? styles.user : styles.assistant}`}>
      {renderAttachments()}
      {renderThinkingHeader()}
      {thinkingExpanded && renderThinkingContent()}
      {bodyContent && (
        <div className={styles.messageContent} ref={messageContentRef}>
          {bodyContent}
        </div>
      )}
      {renderActionButtons()}
      <div className={styles.messageFooter}>
        {showDate && message.created_at && (
          <span className={styles.messageTime}>{formatMessageTime(message.created_at)}</span>
        )}
        {!isUser && (hasResponse || message.content) && (
          <div className={styles.messageActions}>
            <button onClick={handleCopy} className={styles.actionBtn} title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>
      {expandedImage && (
        <div 
          className={styles.imageLightbox} 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setExpandedImage(null);
              setZoomLevel(1);
              setImagePosition({ x: 0, y: 0 });
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoomLevel(prev => Math.min(Math.max(0.5, prev + delta), 4));
          }}
        >
          <div className={styles.lightboxContent}>
            <img 
              src={expandedImage} 
              alt="Expanded view"
              style={{
                transform: `scale(${zoomLevel}) translate(${imagePosition.x}px, ${imagePosition.y}px)`,
                cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              }}
              draggable={false}
              onMouseDown={(e) => {
                if (zoomLevel > 1) {
                  setIsDragging(true);
                  setDragStart({ x: e.clientX - imagePosition.x * zoomLevel, y: e.clientY - imagePosition.y * zoomLevel });
                }
              }}
              onMouseMove={(e) => {
                if (isDragging && zoomLevel > 1) {
                  setImagePosition({
                    x: (e.clientX - dragStart.x) / zoomLevel,
                    y: (e.clientY - dragStart.y) / zoomLevel,
                  });
                }
              }}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
            />
          </div>
          <div className={styles.zoomControls}>
            <button 
              className={styles.zoomBtn} 
              onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.min(prev + 0.25, 4)); }}
              title="Zoom in"
            >
              +
            </button>
            <span className={styles.zoomLevel}>{Math.round(zoomLevel * 100)}%</span>
            <button 
              className={styles.zoomBtn} 
              onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.max(prev - 0.25, 0.5)); }}
              title="Zoom out"
            >
              −
            </button>
            <button 
              className={styles.zoomBtn} 
              onClick={(e) => { e.stopPropagation(); setZoomLevel(1); setImagePosition({ x: 0, y: 0 }); }}
              title="Reset zoom"
            >
              ⟲
            </button>
          </div>
          <button 
            className={styles.closeLightbox} 
            onClick={() => { setExpandedImage(null); setZoomLevel(1); setImagePosition({ x: 0, y: 0 }); }}
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    const renderDiagram = async () => {
      if (!containerRef.current || rendered) return;
      
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#3b82f6',
            primaryTextColor: '#fff',
            primaryBorderColor: '#60a5fa',
            lineColor: '#94a3b8',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
            background: '#1e293b',
            mainBkg: '#1e293b',
            secondBkg: '#334155',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: '16px',
          },
          sequence: {
            actorMargin: 80,
            boxMargin: 15,
            boxTextMargin: 8,
            noteMargin: 15,
            messageMargin: 50,
            mirrorActors: true,
            useMaxWidth: false,
            width: 180,
            height: 60,
            actorFontSize: 16,
            messageFontSize: 14,
            noteFontSize: 14,
          },
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
          },
        });

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setSvgContent(svg);
          setRendered(true);
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    };

    renderDiagram();
  }, [code, rendered]);

  if (error) {
    return (
      <div className={styles.mermaidError}>
        <div className={styles.mermaidErrorTitle}>Diagram Error</div>
        <pre>{error}</pre>
        <details>
          <summary>View source</summary>
          <pre>{code}</pre>
        </details>
      </div>
    );
  }

  return (
    <>
      <div className={styles.mermaidContainer} onClick={() => rendered && setExpanded(true)} title="Click to enlarge">
        <div ref={containerRef} className={styles.mermaidDiagram}>
          <span className={styles.mermaidLoading}>Rendering diagram...</span>
        </div>
        {rendered && <div className={styles.mermaidExpandHint}>Click to enlarge</div>}
      </div>
      
      {expanded && (
        <div className={styles.mermaidLightbox} onClick={() => setExpanded(false)}>
          <div className={styles.mermaidLightboxContent} onClick={(e) => e.stopPropagation()}>
            <div 
              className={styles.mermaidLightboxDiagram}
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            <button className={styles.mermaidLightboxClose} onClick={() => setExpanded(false)}>
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Render Mermaid diagrams
  if (language?.toLowerCase() === 'mermaid') {
    return <MermaidDiagram code={code} />;
  }

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language || 'text'}</span>
        <button onClick={handleCopy} className={styles.codeCopyBtn} title="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre className={styles.codeContent}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  // Pre-process content to convert LaTeX notation to Unicode
  const preprocessContent = (text: string): string => {
    return text
      // Arrows - with and without $...$ wrapper
      .replace(/\$\\rightarrow\$/g, '→')
      .replace(/\$\\leftarrow\$/g, '←')
      .replace(/\$\\leftrightarrow\$/g, '↔')
      .replace(/\$\\Rightarrow\$/g, '⇒')
      .replace(/\$\\Leftarrow\$/g, '⇐')
      .replace(/\$\\uparrow\$/g, '↑')
      .replace(/\$\\downarrow\$/g, '↓')
      .replace(/\$\\to\$/g, '→')
      // LaTeX arrows without $...$ wrapper
      .replace(/\\rightarrow/g, '→')
      .replace(/\\leftarrow/g, '←')
      .replace(/\\leftrightarrow/g, '↔')
      .replace(/\\Rightarrow/g, '⇒')
      .replace(/\\Leftarrow/g, '⇐')
      .replace(/\\to(?![a-zA-Z])/g, '→')
      .replace(/\\uparrow/g, '↑')
      .replace(/\\downarrow/g, '↓')
      // Math symbols
      .replace(/\$\\times\$/g, '×')
      .replace(/\$\\div\$/g, '÷')
      .replace(/\$\\neq\$/g, '≠')
      .replace(/\$\\leq\$/g, '≤')
      .replace(/\$\\geq\$/g, '≥')
      .replace(/\$\\pm\$/g, '±')
      .replace(/\$\\infty\$/g, '∞')
      .replace(/\$\\approx\$/g, '≈')
      .replace(/\$\\sum\$/g, '∑')
      .replace(/\$\\prod\$/g, '∏')
      .replace(/\$\\sqrt\$/g, '√')
      // Greek letters (common ones)
      .replace(/\$\\alpha\$/g, 'α')
      .replace(/\$\\beta\$/g, 'β')
      .replace(/\$\\gamma\$/g, 'γ')
      .replace(/\$\\delta\$/g, 'δ')
      .replace(/\$\\pi\$/g, 'π')
      .replace(/\$\\theta\$/g, 'θ')
      .replace(/\$\\lambda\$/g, 'λ')
      .replace(/\$\\mu\$/g, 'μ')
      .replace(/\$\\sigma\$/g, 'σ')
      // Clean up any remaining simple $...$ that just contain text
      .replace(/\$([^$]+)\$/g, '$1')
      // Convert <mermaid>...</mermaid> XML tags to markdown code fences
      // Ensure there's a newline before the opening tag
      .replace(/([^\n])<mermaid>/gi, '$1\n```mermaid\n')
      .replace(/^<mermaid>/gim, '```mermaid\n')
      .replace(/<mermaid>\s*/gi, '```mermaid\n')
      .replace(/\s*<\/mermaid>/gi, '\n```\n');
  };

  // Remove planning/thinking text and raw mermaid syntax before mermaid code blocks
  const cleanMermaidOutput = (text: string): string => {
    // If text contains a mermaid code block, clean up everything before it
    if (text.includes('```mermaid')) {
      const mermaidIndex = text.indexOf('```mermaid');
      const beforeMermaid = text.substring(0, mermaidIndex);
      const afterStart = text.substring(mermaidIndex);
      
      const lines = beforeMermaid.split('\n');
      
      // Patterns to remove - planning, intro, and raw mermaid syntax
      const removePatterns = [
        /^Plan:/i,
        /^\d+\.\s+(Identify|Map|Use|Ensure|Create|Define|First|Next|Then)/i,
        /^(I'll|I will|Let me|Here's|To create|Response|Sure|Okay|OK|Certainly)/i,
        /^(Based on|According to|The following|Below is)/i,
        // Raw mermaid syntax
        /^sequenceDiagram$/i,
        /^\s*participant\s+/i,
        /^\s*\w+\s*->>?\s*\w+/i, // Mermaid arrows
        /^\s*Note\s+(left|right|over)/i,
        /^\s*(loop|alt|else|end|opt|par|rect)\s*/i,
      ];
      
      // Filter out unwanted lines
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Skip very short intro words
        if (trimmed.length < 25 && /^(Response|Sure|Here|OK|Okay|Here is|Here's):?$/i.test(trimmed)) return false;
        return !removePatterns.some(p => p.test(trimmed));
      });
      
      // If we removed most content, just return the mermaid block
      const originalNonEmpty = lines.filter(l => l.trim()).length;
      if (filteredLines.length < originalNonEmpty / 2 || filteredLines.length === 0) {
        return afterStart.trim();
      }
      
      return filteredLines.join('\n').trim() + '\n\n' + afterStart.trim();
    }
    return text;
  };

  // Detect and convert text-based sequence diagrams to Mermaid
  const convertSequenceDiagramToMermaid = (text: string): string => {
    const lines = text.split('\n');
    
    // Track participants and build diagram elements
    const participants = new Set<string>();
    type DiagramElement = 
      | { type: 'interaction'; from: string; to: string; message: string; isReturn?: boolean }
      | { type: 'alt'; label: string }
      | { type: 'else'; label: string }
      | { type: 'end' }
      | { type: 'note'; text: string };
    
    const elements: DiagramElement[] = [];
    const diagramLineIndices: number[] = [];
    let inAltBlock = false;
    
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmedLine = line.trim();
      
      // Detect alt/else blocks: "**alt (Success Path)**" or "1. **alt (Success Path)**"
      const altMatch = trimmedLine.match(/^\*?\*?\s*`?alt`?\s*\(?([^)*]+)?\)?/i);
      if (altMatch) {
        const label = altMatch[1]?.trim() || 'Alternative';
        elements.push({ type: 'alt', label });
        diagramLineIndices.push(idx);
        inAltBlock = true;
        continue;
      }
      
      // Detect else blocks: "**else (Failure Path)**"
      const elseMatch = trimmedLine.match(/^\*?\*?\s*`?else`?\s*\(?([^)*]+)?\)?/i);
      if (elseMatch) {
        const label = elseMatch[1]?.trim() || 'Otherwise';
        elements.push({ type: 'else', label });
        diagramLineIndices.push(idx);
        continue;
      }
      
      // Match interaction patterns: **Source → Destination**: message
      const interactionMatch = line.match(/(?:^\s*\d+\.\s*)?(?:\*\s*)?\*?\*?\s*([^*→←\n:]+?)\s*(→|←|->|<-)\s*([^*:\n]+?)\s*\*?\*?\s*:\s*(.+)/);
      if (interactionMatch) {
        const [, from, arrow, to, message] = interactionMatch;
        const cleanFrom = from.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const cleanTo = to.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        
        if (cleanFrom && cleanTo && cleanFrom !== cleanTo && cleanFrom.length > 1 && cleanTo.length > 1) {
          participants.add(cleanFrom);
          participants.add(cleanTo);
          
          const isReturn = arrow === '←' || arrow === '<-';
          if (isReturn) {
            elements.push({ type: 'interaction', from: cleanTo, to: cleanFrom, message: message.trim(), isReturn: true });
          } else {
            elements.push({ type: 'interaction', from: cleanFrom, to: cleanTo, message: message.trim() });
          }
          diagramLineIndices.push(idx);
        }
      }
    }
    
    // Close any open alt block
    if (inAltBlock) {
      elements.push({ type: 'end' });
    }
    
    // Count actual interactions
    const interactionCount = elements.filter(e => e.type === 'interaction').length;
    
    // If we found at least 3 interactions, convert to Mermaid
    if (interactionCount >= 3) {
      const participantsList = Array.from(participants);
      let mermaidCode = 'sequenceDiagram\n';
      
      // Add participants with display names
      for (const p of participantsList) {
        const displayName = p.replace(/_/g, ' ');
        mermaidCode += `    participant ${p} as ${displayName}\n`;
      }
      mermaidCode += '\n';
      
      // Add elements
      for (const element of elements) {
        if (element.type === 'interaction') {
          const arrow = element.isReturn ? '-->>' : '->>';
          // Clean up message - remove complex args, truncate
          let msg = element.message
            .replace(/\([^)]*\)/g, '()')
            .replace(/[`*_]/g, '')
            .trim();
          if (msg.length > 45) {
            msg = msg.substring(0, 42) + '...';
          }
          mermaidCode += `    ${element.from}${arrow}${element.to}: ${msg}\n`;
        } else if (element.type === 'alt') {
          mermaidCode += `    alt ${element.label}\n`;
        } else if (element.type === 'else') {
          mermaidCode += `    else ${element.label}\n`;
        } else if (element.type === 'end') {
          mermaidCode += `    end\n`;
        }
      }
      
      // Helper to check if a line is diagram-related
      const isDiagramLine = (l: string): boolean => {
        const t = l.trim();
        if (t.length === 0) return true; // Empty lines within diagram area
        if (t.match(/\[(START|END)\]/i)) return true;
        // (Message:...) lines - with or without leading bullets/asterisks
        if (t.includes('(Message:')) return true;
        // alt/else markers
        if (t.match(/^(\d+\.\s*)?[-*•]?\s*\*?\*?\s*`?(alt|else)`?\s*[\s(]/i)) return true;
        // Sequence interaction lines
        if (t.match(/\*?\*?\s*[^*→←]+\s*(→|←|->|<-)\s*[^*:]+\s*\*?\*?\s*:/)) return true;
        // Lines that are just asterisks or dashes
        if (t.match(/^[*•-]{1,3}$/)) return true;
        // Example error lines - any line containing "Example Error"
        if (t.toLowerCase().includes('example error')) return true;
        // Lines that look like wrapped notes: *(text)* or bullet + *(text)*
        if (t.match(/^[-*•]?\s*\*\([^)]+\)\*?$/)) return true;
        // Lines that are just parenthetical notes with bullets
        if (t.match(/^[-*•]\s+\(/)) return true;
        return false;
      };
      
      // Find first and last diagram lines
      const firstDiagramLine = Math.min(...diagramLineIndices);
      const lastDiagramLine = Math.max(...diagramLineIndices);
      
      // Extend lastDiagramLine to include any trailing diagram content
      let extendedLastLine = lastDiagramLine;
      for (let i = lastDiagramLine + 1; i < lines.length; i++) {
        if (isDiagramLine(lines[i])) {
          extendedLastLine = i;
        } else if (lines[i].trim().length > 0) {
          // Found non-diagram content, stop extending
          break;
        }
      }
      
      // Get lines before diagram
      const beforeLines = lines.slice(0, firstDiagramLine)
        .filter(l => !isDiagramLine(l) && l.trim());
      
      // Get lines after the extended diagram area
      const afterLines = lines.slice(extendedLastLine + 1)
        .filter(l => !isDiagramLine(l) && l.trim());
      
      // Build result: before + mermaid + after
      let result = '';
      if (beforeLines.length > 0) {
        result += beforeLines.join('\n') + '\n\n';
      }
      result += '```mermaid\n' + mermaidCode + '```';
      if (afterLines.length > 0) {
        result += '\n\n' + afterLines.join('\n');
      }
      
      return result;
    }
    
    return text;
  };

  const renderMarkdown = (text: string) => {
    let processedText = preprocessContent(text);
    processedText = cleanMermaidOutput(processedText);
    // Only auto-convert to mermaid if there's no existing mermaid code block
    if (!processedText.includes('```mermaid')) {
      processedText = convertSequenceDiagramToMermaid(processedText);
    }
    const lines = processedText.split('\n');
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
          <CodeBlock key={key++} code={codeLines.join('\n')} language={lang || undefined} />
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

    // Bold **text** - check if it looks like a label (ends with :)
    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((m = boldRegex.exec(text)) !== null) {
      if (noOverlap(m.index, m.index + m[0].length)) {
        const content = m[1];
        const isLabel = content.endsWith(':') || content.includes('(') && content.includes(')');
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          element: <strong key={key++} className={isLabel ? styles.mdStrong : styles.mdBold}>{content}</strong>,
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
          element: <em key={key++} className={styles.mdEmphasis}>{m[1]}</em>,
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
