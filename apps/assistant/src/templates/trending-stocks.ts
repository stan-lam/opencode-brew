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
    ? `Use Discord-friendly formatting (NO markdown tables):
- Use code blocks with fixed-width alignment for clean display
- Format each section in a code block like this:
\`\`\`
SYMBOL   PRICE      CHANGE
NVDA     $950.25    +5.32%
AAPL     $178.50    +2.15%
\`\`\`
- Keep columns aligned using spaces
- Put section headers OUTSIDE code blocks: **🔺 Top Gainers**`
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

  const sentimentPrompt = trackSentiment ? `Analyze social sentiment for trending stocks.

Fetch the StockTwits trending page:
<fetch_url url="https://stocktwits.com/rankings/trending" />

Extract:
1. Trending stock symbols
2. Sentiment indicators (bullish/bearish)
3. Message volume and activity

Filter to stocks with sentiment score >= ${sentimentThreshold}/100.

Cross-reference with the market movers from the previous stage. Highlight stocks that appear in both lists.

${useDiscordFormat 
    ? `Present sentiment in a Discord-friendly code block:
**📊 Sentiment Trending**
\`\`\`
SYMBOL   SENTIMENT   MESSAGES
NVDA     Bullish     12.5K
\`\`\``
    : `Present findings in a table:
| Symbol | Sentiment | Messages | Trend |
|--------|-----------|----------|-------|`}` : '';

  const watchlistPrompt = watchlist.length > 0 ? `## FETCH REAL QUOTES FOR WATCHLIST:

${watchlist.map((s: string) => `<get_stock_quote symbol="${s}" />`).join('\n')}

**WAIT FOR THESE TOOLS TO RETURN ACTUAL PRICES.**
**DO NOT WRITE ANY PRICES UNTIL YOU SEE THE TOOL RESULTS.**

Example of WRONG output (you made up prices):
"MU $89.20 (-0.7%)" ← FAKE - MU is actually ~$715!
"GOOGL $1,542.70" ← FAKE - GOOGL is actually ~$175!

Example of CORRECT behavior:
1. Output the <get_stock_quote> tags above
2. Wait for system to return: "MU: $715.26 (+6.5%)"
3. THEN write: "MU $715.26 (+6.5%)"

Include these in a separate "Watchlist" section.` : '';

  // Always fetch news - this is important for the summary
  const newsPrompt = `Search for recent news about trending stocks and the market:
<search_web query="stock market news today {{datetime}}" />

${watchlist.length > 0 ? `Also search for news on watchlist stocks:
<search_web query="${watchlist.slice(0, 5).join(' ')} stock news today" />` : ''}

Collect relevant headlines and brief summaries for the Market News section.`;

  const reportPrompt = `Compile a Trending Stocks Report using ONLY the data provided below.

## 🚨 DATA FROM PREVIOUS STAGES 🚨

### Market Movers Data:
{{fetch-movers_output}}

${trackSentiment ? `### Sentiment Data:
{{analyze-sentiment_output}}

` : ''}${watchlist.length > 0 ? `### Watchlist Data:
{{fetch-watchlist_output}}

` : ''}### News Data:
{{fetch-news_output}}

---

## 🚨 CRITICAL: COPY EXACT DATA FROM ABOVE 🚨

You MUST copy the EXACT prices and percentages from the data above.
DO NOT summarize or paraphrase - INCLUDE THE ACTUAL NUMBERS.

${useDiscordFormat ? `## DISCORD FORMAT - USE CODE BLOCKS

Your ENTIRE report must use this format for stock data:

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

**📋 Watchlist**
\`\`\`
SYMBOL   PRICE       CHANGE
MU       $804.00     +4.88%
GOOGL    $403.46     +4.16%
\`\`\`

CRITICAL RULES:
- Put ALL stock data inside \`\`\` code blocks
- Use fixed-width columns with spaces for alignment
- Section headers go OUTSIDE the code blocks
- NO markdown tables (|---|) - Discord doesn't render them
- NO asterisks inside code blocks
` : ''}

**Report Structure:**
1. **Market Summary** - 1-2 sentences max
2. **🔺 Top Gainers** - Copy EXACT prices from market movers data
3. **🔻 Top Losers** - Copy EXACT prices from market movers data  
4. **📊 Most Active** - Copy EXACT prices from market movers data
${trackSentiment ? '5. **💬 Sentiment** - Trending stocks from social data' : ''}
${watchlist.length > 0 ? `6. **📋 Watchlist** - MUST include: ${watchlist.join(', ')} with their EXACT prices from the Watchlist Data above` : ''}
7. **📰 News** - 3-5 headlines (brief)

**COPY THE ACTUAL DATA FROM ABOVE:**
- If Market Movers shows "SLS $6.41 +22.80%" → write "SLS $6.41 +22.80%"
- If Watchlist shows "MU $804.00 +4.88%" → write "MU $804.00 +4.88%"
- If data is missing or empty, write "Data unavailable"

**DO NOT:**
- Make up any prices or percentages
- Write narrative paragraphs instead of data
- Use markdown tables with |---| separators
- Skip the watchlist section`;

  return {
    marketMovers: marketMoversPrompt,
    sentiment: sentimentPrompt,
    watchlist: watchlistPrompt,
    news: newsPrompt,
    report: reportPrompt,
  };
}

function createAiAction(id: string, name: string, prompt: string, order: number): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
      system_prompt: `You are a professional stock market analyst.

## 🚨 YOUR PRICE KNOWLEDGE IS COMPLETELY WRONG 🚨

**PROOF THAT YOU DON'T KNOW PRICES:**
- You might think MU is ~$89. WRONG. It's actually $715.
- You might think GOOGL is ~$1,500. WRONG. It's actually ~$175.
- You might think HIMX is ~$35. WRONG. It's actually ~$8.
- EVERY price you "know" is outdated or fabricated.

**THE ONLY WAY TO GET REAL PRICES:**
1. Output: <get_market_movers /> or <get_stock_quote symbol="AAPL" />
2. STOP WRITING - wait for tool results
3. The system will return REAL prices like: "MU: $715.26 (+6.5%)"
4. ONLY THEN copy those exact numbers into your response

**DETECTION TEST:**
If you write a price and it didn't come from a tool result in this conversation → IT'S FAKE

**WRONG (fake prices you made up):**
MU $89.20 (-0.7%)
GOOGL $1,542.70 (+1.2%)

**CORRECT (wait for tool, then use exact numbers):**
<get_stock_quote symbol="MU" />
[Tool returns: MU $715.26 +6.50%]
Then write: MU $715.26 (+6.50%)

RULES:
1. NEVER write a price without tool data
2. If tool fails, write "Price unavailable" - NOT a made-up number
3. Every $ amount must match tool output exactly`,
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

    // Stage 4: Fetch News (always runs)
    stages.push({
      id: 'stage-news',
      name: 'Fetch Market News',
      actions: [
        createAiAction('fetch-news', 'Get Latest News', prompts.news, 0),
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

    // Stage 5: Save and Notify
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
          content: `# Stock Trends Report - {{datetime}}\n\n{{generate-report_output}}`,
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
          content: `📈 **Stock Trends Report** - {{datetime}}

{{generate-report_output}}

---
*Data from: Market Movers, StockTwits${watchlist.length > 0 ? ', Watchlist' : ''}*`,
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
          message: '📈 *Stock Trends Report* - {{datetime}}\n\n{{generate-report_output}}',
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
