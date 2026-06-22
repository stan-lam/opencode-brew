import { AgentTemplate, TemplateInputGroup, Action, WorkflowStage, CombineStrategy } from '../types/AgentTemplate';

const CATEGORIES = [
  { value: 'gainers', label: 'Top Gainers' },
  { value: 'losers', label: 'Top Losers' },
  { value: 'volume', label: 'Most Active (Volume)' },
  { value: 'sentiment', label: 'Sentiment Trending' },
];

const OUTPUT_FORMATS = [
  { value: 'summary', label: 'Summary (Quick Overview)' },
  { value: 'detailed', label: 'Detailed (Full Analysis)' },
  { value: 'json', label: 'JSON (Machine Readable)' },
];

const SCHEDULE_OPTIONS = [
  { value: '30 9 * * 1-5', label: 'Market Open (9:30 AM ET, Weekdays)' },
  { value: '0 16 * * 1-5', label: 'Market Close (4:00 PM ET, Weekdays)' },
  { value: '0 9,12,16 * * 1-5', label: '3x Daily (9 AM, 12 PM, 4 PM ET)' },
  { value: '0 * * * 1-5', label: 'Hourly (Market Hours)' },
  { value: 'custom', label: 'Custom Cron Expression' },
];

const inputGroups: TemplateInputGroup[] = [
  {
    id: 'categories',
    title: 'What to Track',
    description: 'Select the types of stock trends to monitor',
    icon: '📊',
    inputs: [
      {
        id: 'trackGainers',
        label: 'Top Gainers',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Stocks with the biggest price increases',
      },
      {
        id: 'trackLosers',
        label: 'Top Losers',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Stocks with the biggest price decreases',
      },
      {
        id: 'trackVolume',
        label: 'Most Active (Volume)',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Stocks with highest trading volume',
      },
      {
        id: 'trackSentiment',
        label: 'Sentiment Trending',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Stocks trending on StockTwits and social platforms',
      },
    ],
  },
  {
    id: 'watchlist',
    title: 'Watchlist',
    description: 'Specific stocks to always include in the report',
    icon: '👁️',
    inputs: [
      {
        id: 'watchlistEnabled',
        label: 'Include Personal Watchlist',
        type: 'checkbox',
        required: false,
        defaultValue: false,
      },
      {
        id: 'watchlistSymbols',
        label: 'Stock Symbols',
        type: 'textarea',
        required: false,
        placeholder: 'AAPL, MSFT, NVDA, TSLA\nAMZN, GOOGL, META',
        helpText: 'Enter stock symbols separated by commas or newlines',
        dependsOn: { field: 'watchlistEnabled', value: true },
      },
    ],
  },
  {
    id: 'thresholds',
    title: 'Alert Thresholds',
    description: 'Filter stocks based on these criteria',
    icon: '🎯',
    inputs: [
      {
        id: 'minPriceChange',
        label: 'Minimum Price Change %',
        type: 'number',
        required: false,
        defaultValue: 3,
        min: 0,
        max: 100,
        step: 0.5,
        helpText: 'Only include stocks moving at least this percentage',
      },
      {
        id: 'minPrice',
        label: 'Minimum Stock Price ($)',
        type: 'number',
        required: false,
        defaultValue: 5,
        min: 0,
        max: 10000,
        step: 1,
        helpText: 'Filter out penny stocks below this price',
      },
      {
        id: 'sentimentThreshold',
        label: 'Sentiment Score Threshold',
        type: 'range',
        required: false,
        defaultValue: 50,
        min: 0,
        max: 100,
        step: 5,
        helpText: 'Include stocks with sentiment score above this (0-100)',
      },
    ],
  },
  {
    id: 'report',
    title: 'Report Settings',
    description: 'How to format the output',
    icon: '📝',
    inputs: [
      {
        id: 'outputFormat',
        label: 'Output Format',
        type: 'select',
        required: true,
        options: OUTPUT_FORMATS,
        defaultValue: 'detailed',
      },
      {
        id: 'maxStocksPerCategory',
        label: 'Max Stocks Per Category',
        type: 'number',
        required: false,
        defaultValue: 10,
        min: 3,
        max: 25,
        step: 1,
      },
      {
        id: 'includeNews',
        label: 'Include Recent News',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Search for recent news about trending stocks',
      },
      {
        id: 'includeChartLinks',
        label: 'Include Chart Links',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Add links to TradingView/Yahoo Finance charts',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Where to send the reports',
    icon: '🔔',
    inputs: [
      {
        id: 'saveToFile',
        label: 'Save Report to File',
        type: 'checkbox',
        required: false,
        defaultValue: true,
      },
      {
        id: 'saveFilePath',
        label: 'File Path',
        type: 'filepath',
        required: false,
        defaultValue: '',
        placeholder: 'Click Browse to select location',
        dependsOn: { field: 'saveToFile', value: true },
        fileDialogTitle: 'Save Stock Trends Report',
        fileFilters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'Text', extensions: ['txt'] },
        ],
      },
      {
        id: 'discordEnabled',
        label: 'Send to Discord',
        type: 'checkbox',
        required: false,
        defaultValue: false,
      },
      {
        id: 'discordWebhook',
        label: 'Discord Webhook URL',
        type: 'text',
        required: false,
        placeholder: 'https://discord.com/api/webhooks/...',
        dependsOn: { field: 'discordEnabled', value: true },
      },
      {
        id: 'slackEnabled',
        label: 'Send to Slack',
        type: 'checkbox',
        required: false,
        defaultValue: false,
      },
      {
        id: 'slackWebhook',
        label: 'Slack Webhook URL',
        type: 'text',
        required: false,
        placeholder: 'https://hooks.slack.com/services/...',
        dependsOn: { field: 'slackEnabled', value: true },
      },
      {
        id: 'slackChannel',
        label: 'Slack Channel',
        type: 'text',
        required: false,
        placeholder: '#stock-alerts',
        dependsOn: { field: 'slackEnabled', value: true },
      },
    ],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    description: 'When to run the stock scanner',
    icon: '⏰',
    inputs: [
      {
        id: 'scheduleType',
        label: 'Run Frequency',
        type: 'select',
        required: true,
        options: SCHEDULE_OPTIONS,
        defaultValue: '0 16 * * 1-5',
      },
      {
        id: 'customCron',
        label: 'Custom Cron Expression',
        type: 'text',
        required: false,
        placeholder: '0 */2 9-16 * * 1-5',
        helpText: 'Format: minute hour day month weekday',
        dependsOn: { field: 'scheduleType', value: 'custom' },
      },
    ],
  },
];

function generatePrompts(config: Record<string, any>, discordEnabled: boolean = false) {
  const {
    trackGainers,
    trackLosers,
    trackVolume,
    trackSentiment,
    watchlistEnabled,
    watchlistSymbols,
    minPriceChange,
    minPrice,
    sentimentThreshold,
    outputFormat,
    maxStocksPerCategory,
    includeNews,
    includeChartLinks,
  } = config;

  const categories: string[] = [];
  if (trackGainers) categories.push('top gainers');
  if (trackLosers) categories.push('top losers');
  if (trackVolume) categories.push('most active by volume');
  if (trackSentiment) categories.push('sentiment trending');

  const watchlist = watchlistEnabled && watchlistSymbols
    ? watchlistSymbols.split(/[,\n]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean)
    : [];

  // Discord doesn't support markdown tables, so use plain text formatting
  const useDiscordFormat = discordEnabled && outputFormat !== 'json';
  
  const formatInstructions = outputFormat === 'json'
    ? 'Format output as valid JSON with arrays for each category.'
    : outputFormat === 'summary'
    ? 'Keep the report brief with just ticker, price, and change %.'
    : 'Provide detailed analysis including price, change, volume, and brief commentary.';
  
  const tableInstructions = useDiscordFormat
    ? `Use Discord-friendly formatting (NO markdown tables, NO bullet points):
- Use code blocks with fixed-width alignment for stock data
- NEVER use bullet points (• or -) outside code blocks - they render poorly
- Use line breaks and bold headers instead of bullets
- Format stock data like this:
\`\`\`
SYMBOL   PRICE       CHANGE
NVDA     $950.25     +5.32%
AAPL     $178.50     +2.15%
\`\`\`
- Section headers go OUTSIDE code blocks with emoji: **🔺 Top Gainers**`
    : 'Use markdown tables for stock data';

  const marketMoversPrompt = `You are a stock market analyst.

## STEP 1 - OUTPUT THIS TOOL TAG NOW:

<get_market_movers />

## STOP AND WAIT - DO NOT CONTINUE UNTIL YOU RECEIVE TOOL RESULTS

**CRITICAL PRICE WARNING:**
- YOU DO NOT KNOW ANY STOCK PRICES
- MU is NOT $89 - you made that up
- GOOGL is NOT $1,542 - you made that up  
- EVERY price you write without tool data is WRONG
- The ONLY valid prices are the ones returned by <get_market_movers /> above

**AFTER tool returns results, ONLY use those exact numbers.**

After the tool returns data, filter and organize the results:
- Categories to include: ${categories.join(', ')}
- Minimum price change: ${minPriceChange}%
- Minimum stock price: $${minPrice}
- Maximum stocks per category: ${maxStocksPerCategory}

## REQUIRED DATA BLOCK (OUTPUT THIS FIRST)
MARKET_MOVERS_DATA_START
TOP_GAINERS
SYMBOL | PRICE | CHANGE%
NVDA | $950.25 | +5.32%
TOP_LOSERS
SYMBOL | PRICE | CHANGE%
TSLA | $220.10 | -4.10%
MOST_ACTIVE
SYMBOL | PRICE | CHANGE% | VOLUME
AMD | $165.80 | +3.21% | 89.7M
MARKET_MOVERS_DATA_END

Rules:
- Use ONLY values from <get_market_movers /> results
- Include ONLY categories requested above
- If a category has no results, write "NO_DATA" on a single line under that header
- Keep price and % formatting exactly as returned

${formatInstructions}

${useDiscordFormat 
    ? `Present each category in a Discord-friendly code block:
**🔺 Top Gainers**
\`\`\`
SYMBOL   PRICE      CHANGE
NVDA     $950.25    +5.32%
\`\`\`
This keeps data aligned and readable on Discord/mobile.`
    : `Present the data in a clear markdown table format:
| Symbol | Price | Change | Change % | Volume |
|--------|-------|--------|----------|--------|`}

${includeChartLinks ? 'Include TradingView chart links: https://www.tradingview.com/chart/?symbol=SYMBOL' : ''}`;

  const sentimentPrompt = trackSentiment ? `Get trending stocks from StockTwits AND fetch their prices.

## STEP 1: Fetch StockTwits trending data
<fetch_url_rendered url="https://stocktwits.com/rankings/trending" />

If blocked: <search_web query="StockTwits trending stocks today" />

## STEP 2: NOW FETCH PRICES - Execute these tool calls:
<get_stock_quote symbol="ASTC" />
<get_stock_quote symbol="SPCE" />
<get_stock_quote symbol="DELL" />
<get_stock_quote symbol="ASTS" />
<get_stock_quote symbol="HOOD" />
<get_stock_quote symbol="RIVN" />
<get_stock_quote symbol="BBAI" />
<get_stock_quote symbol="MX" />
<get_stock_quote symbol="ORCL" />
<get_stock_quote symbol="ENVX" />
<get_stock_quote symbol="PATH" />
<get_stock_quote symbol="VIVO" />

## STEP 3: OUTPUT REQUIRED DATA BLOCK FIRST

SENTIMENT_DATA_START
SYMBOL | PRICE | CHANGE% | TREND%
ASTC | $56.00 | +90.28% | 90.08%
SPCE | $6.12 | +35.01% | 35.10%
SENTIMENT_DATA_END

Rules:
- PRICE and CHANGE% come from get_stock_quote tool results (use change_percent)
- TREND% comes from StockTwits data
- If any quote is missing, write "Data unavailable" for PRICE and CHANGE%

## STEP 4: Output format - INCLUDE ALL 4 COLUMNS

${useDiscordFormat 
    ? `**💬 Sentiment Trending**
\`\`\`
SYMBOL   PRICE       CHANGE%    TREND%
ASTC     $56.00      +90.28%    90.08%
SPCE     $6.12       +35.01%    35.10%
DELL     $409.97     +29.31%    29.40%
MX       $12.34      +30.63%    30.63%
\`\`\`

PRICE and CHANGE% = from get_stock_quote tool results (change_percent)
TREND% = from StockTwits data`
    : `| Symbol | Price | Change % | Trend % |
|--------|-------|--------|---------|`}

Filter to trend >= ${sentimentThreshold}%. Include ALL 4 columns.` : '';

  const watchlistPrompt = watchlist.length > 0 ? `## FETCH REAL QUOTES FOR WATCHLIST:

${watchlist.map((s: string) => `<get_stock_quote symbol="${s}" />`).join('\n')}

**WAIT FOR THESE TOOLS TO RETURN ACTUAL PRICES.**
**DO NOT WRITE ANY PRICES UNTIL YOU SEE THE TOOL RESULTS.**

Output ONLY the block below and nothing else (no summary, no commentary, no links).
Replace PRICE and CHANGE with the exact values from the tool results.

WATCHLIST_DATA_START
SYMBOL | PRICE | CHANGE
${watchlist.map((s: string) => `${s} | PRICE | CHANGE`).join('\n')}
WATCHLIST_DATA_END

Rules:
- Use the symbols in the exact order above
- If a quote is missing, write "Data unavailable" for PRICE and CHANGE
- Do not add extra symbols or text outside the block` : '';

  // Always fetch news - this is important for the summary
  const newsPrompt = `Search for market news:
<search_web query="stock market news today {{datetime}}" />

## OUTPUT EXACTLY THIS FORMAT:

**📰 Latest News**

1. **[Headline Here]** — Brief one-sentence summary.
2. **[Another Headline]** — Brief one-sentence summary.
3. **[Third Headline]** — Brief one-sentence summary.
4. **[Fourth Headline]** — Brief one-sentence summary.
5. **[Fifth Headline]** — Brief one-sentence summary.

## CRITICAL FORMATTING RULES:

1. Use NUMBERED LIST (1. 2. 3.) — NEVER bullet points (• or -)
2. Bold each headline with **double asterisks**
3. Use em-dash (—) between headline and summary
4. NO URLs (they clutter Discord)
5. NO stock prices or dollar amounts
6. NO tables or code blocks
7. NO extra sections after the 5 headlines

## ⛔ STOP AFTER 5 HEADLINES ⛔

Do not add commentary, analysis, or any other sections.`;

  const validateReportPrompt = `Validate and finalize the stock report.

## REQUIRED DATA (authoritative - use only these values):
### Market Movers Data:
{{fetch-movers_output}}

${trackSentiment ? `### Sentiment Data:
{{analyze-sentiment_output}}

` : ''}${watchlist.length > 0 ? `### Watchlist Data:
{{fetch-watchlist_output}}

` : ''}### News Data (HEADLINES ONLY):
{{fetch-news_output}}

### Report Draft:
{{generate-report_output}}

## TASK
1. Extract required data blocks:
- MARKET_MOVERS_DATA_START ... MARKET_MOVERS_DATA_END
- ${trackSentiment ? 'SENTIMENT_DATA_START ... SENTIMENT_DATA_END' : 'Sentiment disabled'}
- ${watchlist.length > 0 ? 'WATCHLIST_DATA_START ... WATCHLIST_DATA_END' : 'Watchlist disabled'}
2. Verify every price, percent, and volume in the report draft appears in those blocks.
3. If any mismatch, missing block, or placeholder appears, rewrite the report using ONLY the block values.
4. Keep the same section order and formatting rules used in the draft.
5. Append the required REPORT_DATA block at the end.

${useDiscordFormat ? `## DISCORD RULES
1. NEVER use bullet points (• or -) outside code blocks
2. Stock data MUST be in code blocks
3. News uses numbered list (1. 2. 3.)
4. Market Summary is plain paragraph text
5. Use ━━━━━━━━ dividers between sections` : `## MARKDOWN RULES
1. Use markdown tables for stock data
2. News uses numbered list (1. 2. 3.)
3. Market Summary is plain paragraph text`}

## REQUIRED REPORT_DATA BLOCK (append after the report)
REPORT_DATA_START
SECTION | SYMBOL | PRICE | CHANGE | VOLUME | TREND%
TOP_GAINERS | NVDA | $950.25 | +5.32% | - | -
TOP_LOSERS | TSLA | $220.10 | -4.10% | - | -
MOST_ACTIVE | AMD | $165.80 | +3.21% | 89.7M | -
${trackSentiment ? 'SENTIMENT | ASTC | $56.00 | +90.28% | - | 90.08%' : ''}
${watchlist.length > 0 ? 'WATCHLIST | AAPL | $178.50 | +2.15% | - | -' : ''}
REPORT_DATA_END

Rules:
- Section names must be: TOP_GAINERS, TOP_LOSERS, MOST_ACTIVE${trackSentiment ? ', SENTIMENT' : ''}${watchlist.length > 0 ? ', WATCHLIST' : ''}
- Use "-" for fields that do not apply
- If a section is NO_DATA or missing, output "SECTION | NO_DATA" (only two columns)
- Do not invent values; copy exact text from the data blocks`;

  const reportPrompt = `Compile a Trending Stocks Report.

${watchlist.length > 0 ? `## STEP 1: FETCH WATCHLIST PRICES

Fetch current prices for watchlist stocks:

${watchlist.map((s: string) => `<get_stock_quote symbol="${s}" />`).join('\n')}

WAIT FOR TOOL RESULTS before continuing.

---

` : ''}## ${watchlist.length > 0 ? 'STEP 2' : 'STEP 1'}: USE DATA FROM PREVIOUS STAGES

**IMPORTANT:** All stock prices and market data are already available below from earlier stages.
DO NOT fetch URLs or make additional API calls - use ONLY the data provided here.

### Market Movers Data:
{{fetch-movers_output}}

${trackSentiment ? `### Sentiment Data:
{{analyze-sentiment_output}}

` : ''}${watchlist.length > 0 ? `### Watchlist Data:
{{fetch-watchlist_output}}

` : ''}### News Data (HEADLINES ONLY):
{{fetch-news_output}}

### REQUIRED DATA BLOCKS (USE ONLY THESE FOR PRICES)
- MARKET_MOVERS_DATA_START ... MARKET_MOVERS_DATA_END
- ${trackSentiment ? 'SENTIMENT_DATA_START ... SENTIMENT_DATA_END' : 'Sentiment disabled'}
- ${watchlist.length > 0 ? 'WATCHLIST_DATA_START ... WATCHLIST_DATA_END' : 'Watchlist disabled'}

---

## ${watchlist.length > 0 ? 'STEP 3' : 'STEP 2'}: WRITE REPORT USING DATA ABOVE

Use prices and data from:
1. Market Movers data above (gainers, losers, most active with prices)
2. ${watchlist.length > 0 ? 'Watchlist quotes from tool results above\n3. ' : ''}${trackSentiment ? 'Sentiment data above\n' + (watchlist.length > 0 ? '4. ' : '3. ') : ''}News headlines above

**IMPORTANT:** Do NOT try to fetch additional URLs or data. Use ONLY what is provided above.
**Never invent placeholders. Only use "Data unavailable" if it appears in the data blocks.**
**Every price and % in the report MUST match a value in the required data blocks.**
**If a required block is missing or a section has NO_DATA, write "No data available" for that section.**

${useDiscordFormat ? `## DISCORD FORMAT - CLEAN & PROFESSIONAL

**CRITICAL DISCORD RULES:**
1. NEVER use bullet points (• or -) outside code blocks - they render as empty dots
2. Use numbered lists or plain text paragraphs instead
3. Put ALL stock data in code blocks
4. Keep sections separated with blank lines

**EXACT FORMAT TO USE:**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**📈 Market Summary**
[Write 2-3 sentences as a normal paragraph. NO bullet points.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**🔺 Top Gainers**
\`\`\`
SYMBOL   PRICE       CHANGE
SLS      $6.41       +22.80%
AAOI     $228.03     +21.11%
\`\`\`

**🔻 Top Losers**
\`\`\`
SYMBOL   PRICE       CHANGE
CELH     $28.14      -4.96%
F        $47.78      -4.13%
\`\`\`

**📊 Most Active**
\`\`\`
SYMBOL   PRICE       CHANGE     VOLUME
NVDA     $950.25     +5.32%     125.3M
AMD      $165.80     +3.21%     89.7M
\`\`\`

**📰 Latest News**
1. **Headline Here** — Brief summary sentence.
2. **Another Headline** — Brief summary sentence.
3. **Third Headline** — Brief summary sentence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**FORBIDDEN IN DISCORD:**
- NO bullet points (• or -)
- NO markdown tables (|---|)
- NO asterisks inside code blocks
- NO empty lines with just bullets
` : ''}

**Report Structure (use EXACTLY these sections in order):**

1. **📈 Market Summary** — Write 2-3 sentences as a paragraph (NO bullet points)
2. **🔺 Top Gainers** — Code block table
3. **🔻 Top Losers** — Code block table  
4. **📊 Most Active** — Code block table
${trackSentiment ? '5. **💬 Sentiment Trending** — Code block with SYMBOL, PRICE, CHANGE%, TREND% columns' : ''}
${watchlist.length > 0 ? `6. **📋 Watchlist** — Code block table` : ''}
7. **📰 Latest News** — Use numbered list (1. 2. 3.), NOT bullet points

**STRICT FORMATTING RULES:**
1. NEVER use bullet points (• or -) outside code blocks
2. Stock data MUST be in \`\`\` code blocks
3. News uses numbered list: "1. **Headline** — Summary"
4. Market Summary is plain paragraph text
5. Use ━━━━━━━━ dividers between sections
6. Prices from tool results only`;

  return {
    marketMovers: marketMoversPrompt,
    sentiment: sentimentPrompt,
    watchlist: watchlistPrompt,
    news: newsPrompt,
    validateReport: validateReportPrompt,
    report: reportPrompt,
  };
}

const STOCK_ANALYST_SYSTEM_PROMPT = `You are a professional stock market analyst writing for Discord.

## 🚨 PRICE RULES 🚨

You do NOT know current stock prices. You MUST use tools:
1. Call <get_market_movers /> or <get_stock_quote symbol="AAPL" />
2. Wait for tool results
3. Use ONLY the exact numbers returned by tools

If a tool fails, write "N/A" — never make up prices.

## 📱 DISCORD FORMATTING RULES

**CRITICAL: NEVER use bullet points (• or -) outside code blocks!**
Bullet points render as empty dots on Discord and look broken.

**CORRECT formatting:**
\`\`\`
SYMBOL   PRICE       CHANGE
NVDA     $950.25     +5.32%
\`\`\`

1. **News Headline** — Summary sentence here.
2. **Another Headline** — Summary sentence here.

**WRONG formatting (DO NOT USE):**
• Empty bullet that renders poorly
- Another bullet that looks bad

**RULES:**
1. Stock data goes in \`\`\` code blocks
2. News/lists use numbered format (1. 2. 3.)
3. Paragraphs are plain text with no bullets
4. Use ━━━ dividers between major sections
5. NEVER use • or - outside code blocks`;

const NEWS_ONLY_SYSTEM_PROMPT = `You are a news headline collector.

Your ONLY job is to output a numbered list of news headlines.

**OUTPUT FORMAT (use EXACTLY this):**

**📰 Latest News**

1. **[Headline]** — One sentence summary.
2. **[Headline]** — One sentence summary.
3. **[Headline]** — One sentence summary.
4. **[Headline]** — One sentence summary.
5. **[Headline]** — One sentence summary.

**RULES:**
1. Use numbered list (1. 2. 3.) — NEVER bullet points (• or -)
2. Bold the headline, use em-dash (—) before summary
3. NO stock prices or dollar amounts
4. NO tables or code blocks
5. NO extra sections or commentary
6. ONLY output the news section above`;

const REPORT_VALIDATOR_SYSTEM_PROMPT = `You are a report validation step.

## CORE RULES
1. Do NOT call tools or fetch new data.
2. Use ONLY values present in the provided data blocks.
3. If a value is missing, write "No data available" for that section.
4. Never invent prices, percentages, or volumes.
5. Output the final report plus the required REPORT_DATA block.`;

function createAiAction(
  id: string,
  name: string,
  prompt: string,
  order: number,
  systemPrompt: string = STOCK_ANALYST_SYSTEM_PROMPT,
): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
      system_prompt: systemPrompt,
    },
    order,
    on_error: 'continue',
  };
}

function createNewsAction(id: string, name: string, prompt: string, order: number): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
      system_prompt: NEWS_ONLY_SYSTEM_PROMPT,
    },
    order,
    on_error: 'continue',
  };
}

export const trendingStocksTemplate: AgentTemplate = {
  id: 'trending-stocks',
  name: 'Trending Stocks Scanner',
  description: 'Monitor stock trends based on price, volume, and social sentiment',
  longDescription: `Automatically track trending stocks across multiple dimensions:
• **Price Movers** - Top gainers and losers from the market
• **Volume Analysis** - Most actively traded stocks
• **Social Sentiment** - Trending stocks on StockTwits and social platforms
• **Custom Watchlist** - Always track your favorite stocks

Get scheduled reports delivered to Discord, Slack, or saved to a file.`,
  icon: '📈',
  category: 'finance',
  tags: ['stocks', 'trading', 'market', 'sentiment', 'finance'],
  inputGroups,

  generateAgent: (config: Record<string, any>) => {
    const {
      trackGainers,
      trackLosers,
      trackVolume,
      trackSentiment,
      watchlistEnabled,
      watchlistSymbols,
      saveToFile,
      saveFilePath,
      discordEnabled,
      discordWebhook,
      slackEnabled,
      slackWebhook,
      slackChannel,
      scheduleType,
      customCron,
      outputFormat,
    } = config;

    const prompts = generatePrompts(config, discordEnabled);
    const cronExpression = scheduleType === 'custom' ? customCron : scheduleType;

    const categories: string[] = [];
    if (trackGainers) categories.push('Gainers');
    if (trackLosers) categories.push('Losers');
    if (trackVolume) categories.push('Volume');
    if (trackSentiment) categories.push('Sentiment');

    const watchlist = watchlistEnabled && watchlistSymbols
      ? watchlistSymbols.split(/[,\n]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean)
      : [];

    const agentName = `Stock Trends: ${categories.join(', ')}`;
    const description = `Scans for ${categories.join(', ').toLowerCase()} trending stocks${watchlist.length > 0 ? ` + watchlist (${watchlist.slice(0, 3).join(', ')}${watchlist.length > 3 ? '...' : ''})` : ''}`;

    const stages: WorkflowStage[] = [];

    // Stage 1: Fetch Market Movers
    stages.push({
      id: 'stage-movers',
      name: 'Fetch Market Movers',
      actions: [
        createAiAction('fetch-movers', 'Get Market Movers', prompts.marketMovers, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 0,
    });

    // Stage 2: Sentiment Analysis (if enabled)
    if (trackSentiment && prompts.sentiment) {
      stages.push({
        id: 'stage-sentiment',
        name: 'Analyze Sentiment',
        actions: [
          createAiAction('analyze-sentiment', 'StockTwits Sentiment', prompts.sentiment, 0),
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: 1,
      });
    }

    // Stage 3: Watchlist Quotes (if enabled)
    if (watchlist.length > 0 && prompts.watchlist) {
      stages.push({
        id: 'stage-watchlist',
        name: 'Fetch Watchlist',
        actions: [
          createAiAction('fetch-watchlist', 'Watchlist Quotes', prompts.watchlist, 0),
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: stages.length,
      });
    }

    // Stage 4: Fetch News (always runs) - uses restricted news-only system prompt
    stages.push({
      id: 'stage-news',
      name: 'Fetch Market News',
      actions: [
        createNewsAction('fetch-news', 'Get Latest News', prompts.news, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: stages.length,
    });

    // Stage 5: Generate Report
    stages.push({
      id: 'stage-report',
      name: 'Generate Report',
      actions: [
        createAiAction('generate-report', 'Compile Report', prompts.report, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: stages.length,
    });

    // Stage 6: Validate Report
    stages.push({
      id: 'stage-validate',
      name: 'Validate Report',
      actions: [
        createAiAction(
          'validate-report',
          'Validate Report',
          prompts.validateReport,
          0,
          REPORT_VALIDATOR_SYSTEM_PROMPT,
        ),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: stages.length,
    });

    // Stage 7: Save and Notify
    const notifyActions: Action[] = [];

    if (saveToFile && saveFilePath) {
      const fileExtension = outputFormat === 'json' ? '.json' : '.md';
      const finalPath = saveFilePath.endsWith(fileExtension) 
        ? saveFilePath 
        : saveFilePath.replace(/\.[^.]+$/, fileExtension);
      
      notifyActions.push({
        id: 'save-report',
        name: 'Save Report',
        action_type: {
          type: 'save_file',
          path: finalPath,
          content: `# Stock Trends Report - {{datetime}}\n\n{{validate-report_output}}`,
          append: false,
        },
        order: 0,
        on_error: 'continue',
      });
    }

    if (discordEnabled && discordWebhook) {
      notifyActions.push({
        id: 'notify-discord',
        name: 'Send to Discord',
        action_type: {
          type: 'send_discord',
          webhook_url: discordWebhook,
          content: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 **Stock Trends Report**
📅 {{datetime}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{validate-report_output}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Data: Market Movers, StockTwits${watchlist.length > 0 ? ', Watchlist' : ''}*`,
          username: 'Stock Scanner',
        },
        order: 1,
        on_error: 'continue',
      });
    }

    if (slackEnabled && slackWebhook) {
      notifyActions.push({
        id: 'notify-slack',
        name: 'Send to Slack',
        action_type: {
          type: 'send_slack',
          webhook_url: slackWebhook,
          channel: slackChannel || '#stock-alerts',
          message: '📈 *Stock Trends Report* - {{datetime}}\n\n{{validate-report_output}}',
          username: 'Stock Scanner',
        },
        order: 2,
        on_error: 'continue',
      });
    }

    if (notifyActions.length > 0) {
      stages.push({
        id: 'stage-notify',
        name: 'Save & Notify',
        actions: notifyActions,
        combineStrategy: 'array' as CombineStrategy,
        order: stages.length,
      });
    }

    return {
      name: agentName,
      description,
      trigger: {
        type: 'cron',
        expression: cronExpression,
      },
      stages,
      actions: [],
      enabled: true,
    };
  },

  previewDescription: (config: Record<string, any>) => {
    const categories: string[] = [];
    if (config.trackGainers) categories.push('gainers');
    if (config.trackLosers) categories.push('losers');
    if (config.trackVolume) categories.push('volume');
    if (config.trackSentiment) categories.push('sentiment');

    const notifications: string[] = [];
    if (config.saveToFile) notifications.push('file');
    if (config.discordEnabled) notifications.push('Discord');
    if (config.slackEnabled) notifications.push('Slack');

    const scheduleLabel = SCHEDULE_OPTIONS.find(s => s.value === config.scheduleType)?.label || 'Custom';

    return `Track ${categories.join(', ')} • ${scheduleLabel} • Notify via ${notifications.join(', ') || 'none'}`;
  },
};
