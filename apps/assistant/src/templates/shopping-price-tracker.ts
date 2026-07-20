import { AgentTemplate, TemplateInputGroup, Action, WorkflowStage, CombineStrategy } from '../types/AgentTemplate';

const SCHEDULE_OPTIONS = [
  { value: '0 * * * *', label: 'Every Hour' },
  { value: '0 */6 * * *', label: 'Every 6 Hours' },
  { value: '0 9 * * *', label: 'Daily at 9 AM' },
  { value: '0 9,18 * * *', label: 'Twice Daily (9 AM, 6 PM)' },
  { value: '0 9 * * 1', label: 'Weekly (Monday 9 AM)' },
  { value: 'custom', label: 'Custom Cron Expression' },
];

const inputGroups: TemplateInputGroup[] = [
  {
    id: 'items',
    title: 'Shopping Items',
    description: 'Add items to track by URL or search term',
    icon: '🛒',
    inputs: [
      {
        id: 'itemsMode',
        label: 'How to specify items',
        type: 'select',
        required: true,
        options: [
          { value: 'urls', label: 'Product URLs (Amazon, Walmart, etc.)' },
          { value: 'search', label: 'Search Terms (product names)' },
          { value: 'both', label: 'Both URLs and Search Terms' },
        ],
        defaultValue: 'both',
        helpText: 'URLs provide more accurate prices, search terms are more flexible',
      },
      {
        id: 'productUrls',
        label: 'Product URLs',
        type: 'textarea',
        required: false,
        placeholder: 'https://www.amazon.com/dp/B0...\nhttps://www.walmart.com/ip/...',
        helpText: 'Enter one URL per line. Supports Amazon, Walmart, Target, Best Buy, etc.',
        dependsOn: [
          { field: 'itemsMode', value: 'urls' },
          { field: 'itemsMode', value: 'both' },
        ],
      },
      {
        id: 'searchTerms',
        label: 'Search Terms',
        type: 'textarea',
        required: false,
        placeholder: 'Sony WH-1000XM5 headphones\nApple AirPods Pro 2nd gen\nSamsung 65" OLED TV',
        helpText: 'Enter one product name per line. Be specific for better results.',
        dependsOn: [
          { field: 'itemsMode', value: 'search' },
          { field: 'itemsMode', value: 'both' },
        ],
      },
    ],
  },
  {
    id: 'alerts',
    title: 'Alert Settings',
    description: 'When should you be notified of a price drop?',
    icon: '🔔',
    inputs: [
      {
        id: 'alertOnAnyDrop',
        label: 'Alert on any price decrease',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Notify when any item drops in price, even by $0.01',
      },
      {
        id: 'usePercentageThreshold',
        label: 'Alert on percentage drop',
        type: 'checkbox',
        required: false,
        defaultValue: false,
        helpText: 'Only notify when price drops by a certain percentage',
      },
      {
        id: 'percentageThreshold',
        label: 'Minimum drop percentage',
        type: 'number',
        required: false,
        defaultValue: 10,
        min: 1,
        max: 90,
        step: 1,
        helpText: 'Alert only when price drops by at least this percentage',
        dependsOn: { field: 'usePercentageThreshold', value: true },
      },
      {
        id: 'useTargetPrices',
        label: 'Alert when below target price',
        type: 'checkbox',
        required: false,
        defaultValue: false,
        helpText: 'Set target prices for specific items',
      },
      {
        id: 'targetPrices',
        label: 'Target Prices',
        type: 'textarea',
        required: false,
        placeholder: 'Sony WH-1000XM5: $250\nAirPods Pro: $180\nhttps://amazon.com/dp/B0...: $500',
        helpText: 'Format: "item name or URL: target price" (one per line)',
        dependsOn: { field: 'useTargetPrices', value: true },
      },
    ],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    description: 'How often to check prices',
    icon: '⏰',
    inputs: [
      {
        id: 'scheduleType',
        label: 'Check Frequency',
        type: 'select',
        required: true,
        options: SCHEDULE_OPTIONS,
        defaultValue: '0 */6 * * *',
      },
      {
        id: 'customCron',
        label: 'Custom Cron Expression',
        type: 'text',
        required: false,
        placeholder: '0 */4 * * *',
        helpText: 'Format: minute hour day month weekday',
        dependsOn: { field: 'scheduleType', value: 'custom' },
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Where to send price drop alerts',
    icon: '📬',
    inputs: [
      {
        id: 'saveToFile',
        label: 'Save Price History to File',
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
        fileDialogTitle: 'Save Price Tracking Report',
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
        placeholder: '#deals',
        dependsOn: { field: 'slackEnabled', value: true },
      },
      {
        id: 'notifyOnlyOnDrops',
        label: 'Only notify when prices drop',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'If unchecked, sends a report even when no prices dropped',
      },
    ],
  },
];

function generatePrompts(config: Record<string, any>) {
  const {
    itemsMode,
    productUrls,
    searchTerms,
    alertOnAnyDrop,
    usePercentageThreshold,
    percentageThreshold,
    useTargetPrices,
    targetPrices,
  } = config;

  const urls = productUrls ? productUrls.split('\n').map((u: string) => u.trim()).filter(Boolean) : [];
  const searches = searchTerms ? searchTerms.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
  const targets = targetPrices ? parseTargetPrices(targetPrices) : {};

  const itemsList = buildItemsList(itemsMode, urls, searches);

  const fetchPricesPrompt = `You are a shopping price tracker assistant.

## YOUR TASK
Find the current price for each item in the shopping list below.

## SHOPPING LIST
${itemsList}

## IMPORTANT
Search snippets rarely include prices. You MUST fetch product pages to get actual prices.

## STEP 1: OUTPUT TOOL CALLS ONLY

Output ONLY tool tags and nothing else. Do not add commentary.

${urls.length > 0 ? `
### For Product URLs
Output these fetch calls:
${urls.map((url: string) => `<fetch_url url="${url}" />`).join('\n')}
` : ''}
${searches.length > 0 ? `
### For Search Terms
Output search calls to find product page URLs:
${searches.map((term: string) => `<search_web query="${term} site:apple.com OR site:amazon.com OR site:walmart.com OR site:bestbuy.com OR site:target.com" />`).join('\n')}
` : ''}

After outputting tool tags, STOP.

## STEP 2: AFTER SEARCH RESULTS (ONLY IF SEARCH TERMS WERE USED)

When a TOOL RESULTS section appears and contains search results:
1. Extract the best product page URLs (one per item if possible).
2. Output ONLY <fetch_url url="..."/> tags for those URLs.
3. STOP after the tool tags.

If you did not find any URLs, run another <search_web> with a simpler query like:
"${searches[0] || 'item name'} price site:apple.com"

## STEP 3: AFTER FETCH RESULTS

Parse the fetched page content to extract actual prices.
Look for dollar amounts like "$249.00" or "USD 249.00".
If a site blocks access and no price is found, set currentPrice to null.

## OUTPUT FORMAT

\`\`\`json
{
  "items": [
    {
      "name": "Product Name",
      "identifier": "URL or search term used",
      "currentPrice": 299.99,
      "currency": "USD",
      "source": "Apple/Amazon/Best Buy/etc",
      "url": "product page URL",
      "inStock": true,
      "priceSource": "fetched"
    }
  ],
  "fetchedAt": "{{datetime}}"
}
\`\`\`

**OUTPUT RULES:**
- Do NOT include feature descriptions in the output
- Use the EXACT price from the fetched page
- If no price found, set currentPrice to null
- Use priceSource = "fetched" when price comes from fetch_url`;

  const alertCriteria: string[] = [];
  if (alertOnAnyDrop) {
    alertCriteria.push('- ANY price decrease from previous check');
  }
  if (usePercentageThreshold) {
    alertCriteria.push(`- Price drops by ${percentageThreshold}% or more`);
  }
  if (useTargetPrices && Object.keys(targets).length > 0) {
    alertCriteria.push('- Price falls below target price');
  }

  const comparePricesPrompt = `You are a price comparison analyst.

## YOUR TASK
Compare current prices with previous prices and identify any price drops.

## CURRENT PRICES (just fetched)
{{fetch-prices_output}}

## PREVIOUS PRICE HISTORY (from database)
{{previous_runs}}

Note: If "previous_runs" is empty, this is the first run - establish baseline prices.

## ALERT CRITERIA
Notify the user when:
${alertCriteria.length > 0 ? alertCriteria.join('\n') : '- Any price decrease'}

${useTargetPrices && Object.keys(targets).length > 0 ? `
## TARGET PRICES
${Object.entries(targets).map(([item, price]) => `- ${item}: $${price}`).join('\n')}
` : ''}

## ANALYSIS INSTRUCTIONS

1. Check if previous_runs contains price data:
   - If empty or no price data found → this is the FIRST RUN
   - If prices found → compare with current prices
2. For returning runs, calculate for each item:
   - Price change (absolute): current - previous
   - Price change (percentage): ((current - previous) / previous) * 100
3. Identify items that meet the alert criteria
4. The scheduler stores this output in the database for future comparisons

## OUTPUT FORMAT

\`\`\`json
{
  "isFirstRun": false,
  "priceDrops": [
    {
      "name": "Product Name",
      "previousPrice": 349.99,
      "currentPrice": 299.99,
      "priceDrop": 50.00,
      "dropPercentage": 14.29,
      "belowTarget": true,
      "targetPrice": 300.00,
      "url": "product link",
      "source": "Amazon"
    }
  ],
  "allItems": [
    {
      "name": "Product Name",
      "currentPrice": 299.99,
      "previousPrice": 349.99,
      "change": -50.00,
      "changePercent": -14.29
    }
  ],
  "summary": {
    "totalItems": 5,
    "itemsWithDrops": 2,
    "biggestDrop": "Product Name (-$50.00, -14.29%)"
  }
}
\`\`\`

**IMPORTANT:**
- If this is the first run (no previous_output or empty), set isFirstRun to true and priceDrops to []
- Only include items in priceDrops if they meet the alert criteria
- Calculate percentages accurately`;

  const generateReportPrompt = `You are a deal alert reporter.

## YOUR TASK
Generate a user-friendly price drop report based on the comparison data.

## COMPARISON DATA
{{compare-prices_output}}

## REPORT FORMAT

Generate a clean, scannable report:

**If price drops were found:**

🔔 **Price Drop Alert!**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**💰 Deals Found:**

For each price drop:
\`\`\`
ITEM           PRICE       DROP        
Product Name   $299.99     -$50 (-14%)  
\`\`\`

Include:
- Product name
- Current price
- Amount saved (absolute and percentage)
- Link to buy (if available)
- If below target: "🎯 Below your target of $X!"

**📊 Full Price Summary:**
\`\`\`
ITEM           CURRENT     CHANGE
Product 1      $299.99     -$50.00 ⬇️
Product 2      $149.99     +$10.00 ⬆️
Product 3      $89.99      No change
\`\`\`

**If no price drops:**

📊 **Price Check Complete**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No price drops found this check.

**Current Prices:**
[List all items with current prices]

**If first run:**

🆕 **Price Tracking Started**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Initial prices recorded. You'll be notified when prices drop!

**Tracking:**
[List all items with baseline prices]

**FORMATTING RULES:**
1. Use code blocks for price tables
2. Use emoji sparingly but effectively
3. Keep it concise and scannable
4. Include direct purchase links when available

## PRICE HISTORY VISUALIZATION

If there is price history data (not first run, at least 2 data points for any item), include a price chart.

**1. For in-app display** - Include a Mermaid chart code block:

\`\`\`mermaid
xychart-beta
  title "Price History"
  x-axis ["Date1", "Date2", "Date3"]
  y-axis "Price ($)" 0 --> 500
  line [350, 320, 280]
\`\`\`

**2. For Discord/Slack** - Include this placeholder (will become an image URL):

{{mermaid_url:xychart-beta
  title "Price History"
  x-axis ["Date1", "Date2", "Date3"]
  y-axis "Price ($)" 0 --> 500
  line [350, 320, 280]}}

**Chart Guidelines:**
- Use actual dates from the price history
- Set y-axis range to include all prices with some padding
- Include multiple lines if tracking multiple items (use different colors)
- Keep chart simple and readable
- Only include items that have price history (skip items with only 1 data point)`;

  return {
    fetchPrices: fetchPricesPrompt,
    comparePrices: comparePricesPrompt,
    generateReport: generateReportPrompt,
  };
}

function parseTargetPrices(targetPricesStr: string): Record<string, number> {
  const targets: Record<string, number> = {};
  const lines = targetPricesStr.split('\n').filter(Boolean);
  
  for (const line of lines) {
    const match = line.match(/^(.+?):\s*\$?(\d+(?:\.\d{2})?)\s*$/);
    if (match) {
      targets[match[1].trim()] = parseFloat(match[2]);
    }
  }
  
  return targets;
}

function buildItemsList(mode: string, urls: string[], searches: string[]): string {
  const items: string[] = [];
  
  if (mode === 'urls' || mode === 'both') {
    urls.forEach((url, i) => {
      items.push(`${items.length + 1}. [URL] ${url}`);
    });
  }
  
  if (mode === 'search' || mode === 'both') {
    searches.forEach((term, i) => {
      items.push(`${items.length + 1}. [Search] ${term}`);
    });
  }
  
  return items.join('\n');
}

const PRICE_FETCH_SYSTEM_PROMPT = `You are a tool runner for price fetching.

## RESPONSE RULES
1. When asked to output tool tags, respond ONLY with tool tags.
2. Do NOT include explanations, summaries, or tables when tool tags are required.
3. After TOOL RESULTS are provided, follow the next step instructions in the user prompt.
4. Only output JSON when the prompt explicitly instructs you to output JSON.
5. Never fabricate prices. Use only prices found in fetched content.`;

const PRICE_TRACKER_SYSTEM_PROMPT = `You are a shopping price tracker assistant.

## CORE RESPONSIBILITIES
1. Fetch accurate, real-time prices from web sources
2. Compare prices over time to detect drops
3. Generate clear, actionable alerts

## PRICE ACCURACY RULES
- ONLY report prices you find in fetched data
- NEVER make up or estimate prices
- If a price cannot be found, report null
- Include the source for every price

## TOOL USAGE
- Use <fetch_url url="..." /> to get product pages
- Use <search_web query="..." /> to search for prices
- Wait for tool results before reporting prices

## OUTPUT QUALITY
- Be precise with currency and decimal places
- Distinguish between sale prices and regular prices
- Note if items are out of stock`;

function createAiAction(id: string, name: string, prompt: string, order: number): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
      system_prompt: PRICE_TRACKER_SYSTEM_PROMPT,
    },
    order,
    on_error: 'continue',
  };
}

function createFetchAction(id: string, name: string, prompt: string, order: number): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
      system_prompt: PRICE_FETCH_SYSTEM_PROMPT,
    },
    order,
    on_error: 'continue',
  };
}

export const shoppingPriceTrackerTemplate: AgentTemplate = {
  id: 'shopping-price-tracker',
  name: 'Shopping Price Tracker',
  description: 'Track prices for your shopping list and get notified when they drop',
  longDescription: `Never miss a deal again! Track prices for products you want to buy:

- **Multiple Sources** - Track items from Amazon, Walmart, Target, Best Buy, and more
- **Flexible Input** - Add items by URL for precision, or by search term for convenience  
- **Smart Alerts** - Get notified on any drop, percentage drops, or when below your target price
- **Price History** - Keep a log of price changes over time

Perfect for:
- Holiday shopping
- Big purchases you're researching
- Waiting for sales on specific items`,
  icon: '🛒',
  category: 'monitoring',
  tags: ['shopping', 'prices', 'deals', 'tracker', 'alerts', 'savings'],
  inputGroups,

  generateAgent: (config: Record<string, any>) => {
    const {
      itemsMode,
      productUrls,
      searchTerms,
      saveToFile,
      saveFilePath,
      discordEnabled,
      discordWebhook,
      slackEnabled,
      slackWebhook,
      slackChannel,
      scheduleType,
      customCron,
      notifyOnlyOnDrops,
    } = config;

    const prompts = generatePrompts(config);
    const cronExpression = scheduleType === 'custom' ? customCron : scheduleType;

    const urls = productUrls ? productUrls.split('\n').filter(Boolean) : [];
    const searches = searchTerms ? searchTerms.split('\n').filter(Boolean) : [];
    const totalItems = urls.length + searches.length;

    const agentName = `Price Tracker: ${totalItems} item${totalItems !== 1 ? 's' : ''}`;
    const description = `Tracks prices for ${totalItems} shopping item${totalItems !== 1 ? 's' : ''} and alerts on price drops`;

    const stages: WorkflowStage[] = [];

    stages.push({
      id: 'stage-fetch',
      name: 'Fetch Current Prices',
      actions: [
        createFetchAction('fetch-prices', 'Fetch Prices', prompts.fetchPrices, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 0,
    });

    stages.push({
      id: 'stage-compare',
      name: 'Compare Prices',
      actions: [
        createAiAction('compare-prices', 'Analyze Price Changes', prompts.comparePrices, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 1,
    });

    stages.push({
      id: 'stage-report',
      name: 'Generate Report',
      actions: [
        createAiAction('generate-report', 'Create Alert Report', prompts.generateReport, 0),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 2,
    });

    const notifyActions: Action[] = [];

    if (saveToFile && saveFilePath) {
      const finalPath = saveFilePath.endsWith('.md') || saveFilePath.endsWith('.json') || saveFilePath.endsWith('.txt')
        ? saveFilePath
        : `${saveFilePath}.md`;

      notifyActions.push({
        id: 'save-report',
        name: 'Save Report',
        action_type: {
          type: 'save_file',
          path: finalPath,
          content: `# Price Tracking Report - {{datetime}}\n\n{{generate-report_output}}\n\n---\n\n## Raw Data\n\n{{compare-prices_output}}`,
          append: false,
        },
        order: 0,
        on_error: 'continue',
      });
    }

    if (discordEnabled && discordWebhook) {
      const content = notifyOnlyOnDrops
        ? `{{generate-report_output}}`
        : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 **Price Tracker Report**
📅 {{datetime}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{generate-report_output}}`;

      notifyActions.push({
        id: 'notify-discord',
        name: 'Send to Discord',
        action_type: {
          type: 'send_discord',
          webhook_url: discordWebhook,
          content,
          username: 'Price Tracker',
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
          channel: slackChannel || '#deals',
          message: '🛒 *Price Tracker Report* - {{datetime}}\n\n{{generate-report_output}}',
          username: 'Price Tracker',
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
        order: 3,
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
    const urls = config.productUrls ? config.productUrls.split('\n').filter(Boolean) : [];
    const searches = config.searchTerms ? config.searchTerms.split('\n').filter(Boolean) : [];
    const totalItems = urls.length + searches.length;

    const alertTypes: string[] = [];
    if (config.alertOnAnyDrop) alertTypes.push('any drop');
    if (config.usePercentageThreshold) alertTypes.push(`${config.percentageThreshold}%+ drop`);
    if (config.useTargetPrices) alertTypes.push('target price');

    const notifications: string[] = [];
    if (config.saveToFile) notifications.push('file');
    if (config.discordEnabled) notifications.push('Discord');
    if (config.slackEnabled) notifications.push('Slack');

    const scheduleLabel = SCHEDULE_OPTIONS.find(s => s.value === config.scheduleType)?.label || 'Custom';

    return `${totalItems} item${totalItems !== 1 ? 's' : ''} • Alert on ${alertTypes.join(', ') || 'any drop'} • ${scheduleLabel} • ${notifications.join(', ') || 'no notifications'}`;
  },
};
