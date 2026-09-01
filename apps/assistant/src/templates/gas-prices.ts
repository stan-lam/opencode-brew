import { AgentTemplate, TemplateInputGroup, Action, WorkflowStage, CombineStrategy } from '../types/AgentTemplate';

const SCHEDULE_OPTIONS = [
  { value: 'manual', label: 'Manual (on demand)' },
  { value: '0 7 * * *', label: 'Daily at 7 AM' },
  { value: '0 7,17 * * *', label: 'Twice Daily (7 AM, 5 PM)' },
  { value: '0 7 * * 1', label: 'Weekly (Monday 7 AM)' },
  { value: 'custom', label: 'Custom Cron Expression' },
];

const RADIUS_OPTIONS = [
  { value: '5', label: '5 miles' },
  { value: '10', label: '10 miles' },
  { value: '15', label: '15 miles' },
  { value: '25', label: '25 miles' },
  { value: '50', label: '50 miles' },
];

const FUEL_TYPE_OPTIONS = [
  { value: 'regular', label: 'Regular (87)' },
  { value: 'midgrade', label: 'Mid-Grade (89)' },
  { value: 'premium', label: 'Premium (91/93)' },
  { value: 'diesel', label: 'Diesel' },
];

const STATION_OPTIONS = [
  { value: 'costco', label: 'Costco', icon: '🏪' },
  { value: 'sams_club', label: "Sam's Club", icon: '🏪' },
  { value: 'bjs', label: "BJ's Wholesale", icon: '🏪' },
  { value: 'arco', label: 'Arco', icon: '⛽' },
  { value: 'chevron', label: 'Chevron', icon: '⛽' },
  { value: 'shell', label: 'Shell', icon: '⛽' },
  { value: '76', label: '76', icon: '⛽' },
  { value: 'exxon', label: 'Exxon', icon: '⛽' },
  { value: 'mobil', label: 'Mobil', icon: '⛽' },
  { value: 'bp', label: 'BP', icon: '⛽' },
  { value: 'valero', label: 'Valero', icon: '⛽' },
  { value: 'speedway', label: 'Speedway', icon: '⛽' },
  { value: 'circle_k', label: 'Circle K', icon: '⛽' },
  { value: 'quiktrip', label: 'QuikTrip', icon: '⛽' },
  { value: 'wawa', label: 'Wawa', icon: '⛽' },
  { value: 'sheetz', label: 'Sheetz', icon: '⛽' },
];

const SORT_OPTIONS = [
  { value: 'price_asc', label: 'Price (lowest first)' },
  { value: 'price_desc', label: 'Price (highest first)' },
  { value: 'distance', label: 'Distance (nearest first)' },
  { value: 'station', label: 'Station name (A-Z)' },
];

const inputGroups: TemplateInputGroup[] = [
  {
    id: 'location',
    title: 'Location',
    description: 'Where to search for gas prices',
    icon: '📍',
    inputs: [
      {
        id: 'zipCode',
        label: 'ZIP Code',
        type: 'text',
        required: true,
        placeholder: '94025',
        helpText: 'Enter your 5-digit ZIP code',
      },
      {
        id: 'radius',
        label: 'Search Radius',
        type: 'select',
        required: true,
        options: RADIUS_OPTIONS,
        defaultValue: '10',
        helpText: 'How far to search from your ZIP code',
      },
    ],
  },
  {
    id: 'stations',
    title: 'Station Preferences',
    description: 'Filter and prioritize gas stations',
    icon: '⛽',
    inputs: [
      {
        id: 'preferredStations',
        label: 'Preferred Stations',
        type: 'multiselect',
        required: false,
        options: STATION_OPTIONS,
        helpText: 'Select stations to prioritize (leave empty to show all)',
      },
      {
        id: 'fuelType',
        label: 'Fuel Type',
        type: 'select',
        required: true,
        options: FUEL_TYPE_OPTIONS,
        defaultValue: 'regular',
      },
      {
        id: 'prioritizeMembership',
        label: 'Prioritize membership stations (Costco, Sam\'s Club, BJ\'s)',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Show warehouse club stations at the top of results',
      },
      {
        id: 'includeMembershipOnly',
        label: 'Include membership-only stations',
        type: 'checkbox',
        required: false,
        defaultValue: true,
        helpText: 'Include Costco, Sam\'s Club, and BJ\'s in results',
      },
    ],
  },
  {
    id: 'sorting',
    title: 'Results',
    description: 'How to display results',
    icon: '📊',
    inputs: [
      {
        id: 'sortBy',
        label: 'Sort Results By',
        type: 'select',
        required: true,
        options: SORT_OPTIONS,
        defaultValue: 'price_asc',
      },
      {
        id: 'maxResults',
        label: 'Maximum Results',
        type: 'number',
        required: false,
        defaultValue: 15,
        min: 5,
        max: 50,
        step: 5,
        helpText: 'Number of stations to show (5-50)',
      },
    ],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    description: 'When to check gas prices',
    icon: '⏰',
    inputs: [
      {
        id: 'scheduleType',
        label: 'Check Frequency',
        type: 'select',
        required: true,
        options: SCHEDULE_OPTIONS,
        defaultValue: 'manual',
      },
      {
        id: 'customCron',
        label: 'Custom Cron Expression',
        type: 'text',
        required: false,
        placeholder: '0 7 * * *',
        helpText: 'Format: minute hour day month weekday',
        dependsOn: { field: 'scheduleType', value: 'custom' },
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Where to send gas price reports',
    icon: '📬',
    inputs: [
      {
        id: 'saveToFile',
        label: 'Save Report to File',
        type: 'checkbox',
        required: false,
        defaultValue: false,
      },
      {
        id: 'saveFilePath',
        label: 'File Path',
        type: 'filepath',
        required: false,
        defaultValue: '',
        placeholder: 'Click Browse to select location',
        dependsOn: { field: 'saveToFile', value: true },
        fileDialogTitle: 'Save Gas Price Report',
        fileFilters: [
          { name: 'Markdown', extensions: ['md'] },
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
        placeholder: '#gas-prices',
        dependsOn: { field: 'slackEnabled', value: true },
      },
    ],
  },
];

function generatePrompts(config: Record<string, any>) {
  const {
    zipCode,
    radius,
    preferredStations,
    fuelType,
    prioritizeMembership,
    includeMembershipOnly,
    sortBy,
    maxResults,
  } = config;

  const fuelTypeLabel = FUEL_TYPE_OPTIONS.find(f => f.value === fuelType)?.label || 'Regular';
  const preferredList = preferredStations && preferredStations.length > 0
    ? preferredStations.map((s: string) => STATION_OPTIONS.find(opt => opt.value === s)?.label || s).join(', ')
    : 'All stations';
  
  const membershipStations = ['costco', 'sams_club', 'bjs'];
  const hasMembershipPreferred = preferredStations?.some((s: string) => membershipStations.includes(s));
  const hasCostcoPreferred = preferredStations?.includes('costco');
  const hasSamsClubPreferred = preferredStations?.includes('sams_club');

  // Determine state abbreviation from ZIP code (simplified - assumes WA for 98xxx)
  const stateAbbr = zipCode.startsWith('98') ? 'wa' : 'ca';
  const stateName = stateAbbr === 'wa' ? 'washington' : 'california';
  
  const searchGasPricesPrompt = `Find at least 10 gas stations within ${radius} miles of ${zipCode}.

**SEARCH 1: Preferred stations (search multiple times for comprehensive results)**
${hasCostcoPreferred ? `<search_web query="Costco gas stations near ${zipCode}" />
<search_web query="all Costco gas prices ${stateName} ${zipCode}" />` : ''}
${hasSamsClubPreferred ? `<search_web query="Sam's Club gas stations near ${zipCode}" />` : ''}

**SEARCH 2: Top stations in area (for more results)**
<search_web query="top 10 cheapest gas stations ${zipCode}" />

**EXTRACT ALL stations from search results:**
- Look for "Nearby Costco gas stations" lists
- Look for station rankings with prices
- Include ALL locations within ${radius} miles (e.g., Kirkland, Redmond, Tukwila, Issaquah, Seattle, etc.)

**OUTPUT: List 10+ stations with prices**
Format: Station - $X.XX - City

Prioritize preferred stations (${preferredList}), then fill remaining slots with other stations.
Only use prices from actual search results.`;

  const sortInstructions: Record<string, string> = {
    'price_asc': 'Sort by price from lowest to highest',
    'price_desc': 'Sort by price from highest to lowest', 
    'distance': 'Sort by distance from nearest to farthest',
    'station': 'Sort alphabetically by station name',
  };

  const formatReportPrompt = `{{search-gas-prices_output}}

⛽ **Gas Prices** - ${zipCode}

| Station | Price | City |
|---------|-------|------|

Sort by price. Mark Costco with ⭐.`;

  return {
    searchGasPrices: searchGasPricesPrompt,
    formatReport: formatReportPrompt,
  };
}

const SEARCH_SYSTEM_PROMPT = `Extract 10+ gas stations with prices from search results. Format: Station - $X.XX - City. Prioritize preferred stations first, then add other stations.`;

const FORMAT_REPORT_SYSTEM_PROMPT = `Format gas data into a table. Only use provided data.`;

function createAiAction(id: string, name: string, prompt: string, order: number, systemPrompt: string): Action {
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

export const gasPriceTrackerTemplate: AgentTemplate = {
  id: 'gas-price-tracker',
  name: 'Gas Price Tracker',
  description: 'Find the cheapest gas prices near you by ZIP code',
  longDescription: `Never overpay for gas! Find the best prices near your location:

- **Location-Based Search** - Enter your ZIP code and search radius
- **Station Preferences** - Prioritize Costco, Sam's Club, or your favorite brands
- **Multiple Fuel Types** - Track Regular, Mid-Grade, Premium, or Diesel
- **Smart Sorting** - Sort by price, distance, or station name

Perfect for:
- Daily commuters looking to save on fuel
- Road trip planning
- Finding the cheapest Costco gas nearby
- Tracking price trends in your area`,
  icon: '⛽',
  category: 'monitoring',
  tags: ['gas', 'fuel', 'prices', 'savings', 'costco', 'commute', 'automotive'],
  inputGroups,

  generateAgent: (config: Record<string, any>) => {
    const {
      zipCode,
      radius,
      preferredStations,
      fuelType,
      saveToFile,
      saveFilePath,
      discordEnabled,
      discordWebhook,
      slackEnabled,
      slackWebhook,
      slackChannel,
      scheduleType,
      customCron,
    } = config;

    const prompts = generatePrompts(config);
    
    const triggerType = scheduleType === 'manual' ? 'manual' : 'cron';
    const cronExpression = scheduleType === 'custom' ? customCron : scheduleType;

    const fuelTypeLabel = FUEL_TYPE_OPTIONS.find(f => f.value === fuelType)?.label || 'Regular';
    const stationCount = preferredStations?.length || 0;
    
    const agentName = stationCount > 0
      ? `Gas Prices: ${zipCode} (${stationCount} preferred)`
      : `Gas Prices: ${zipCode}`;
    const description = `Finds ${fuelTypeLabel} gas prices within ${radius} miles of ${zipCode}`;

    const stages: WorkflowStage[] = [];

    stages.push({
      id: 'stage-search',
      name: 'Search Gas Prices',
      actions: [
        createAiAction('search-gas-prices', 'Search Gas Prices', prompts.searchGasPrices, 0, SEARCH_SYSTEM_PROMPT),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 0,
    });

    stages.push({
      id: 'stage-format',
      name: 'Format Report',
      actions: [
        createAiAction('format-report', 'Create Price Report', prompts.formatReport, 0, FORMAT_REPORT_SYSTEM_PROMPT),
      ],
      combineStrategy: 'first_success' as CombineStrategy,
      order: 1,
    });

    const notifyActions: Action[] = [];

    if (saveToFile && saveFilePath) {
      const finalPath = saveFilePath.endsWith('.md') || saveFilePath.endsWith('.txt')
        ? saveFilePath
        : `${saveFilePath}.md`;

      notifyActions.push({
        id: 'save-report',
        name: 'Save Report',
        action_type: {
          type: 'save_file',
          path: finalPath,
          content: `# Gas Price Report - {{datetime}}\n\n{{format-report_output}}`,
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
          content: `{{format-report_output}}`,
          username: 'Gas Price Tracker',
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
          channel: slackChannel || '#gas-prices',
          message: '⛽ *Gas Price Report* - {{datetime}}\n\n{{format-report_output}}',
          username: 'Gas Price Tracker',
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
        order: 2,
      });
    }

    const trigger = triggerType === 'manual'
      ? { type: 'manual' as const }
      : { type: 'cron' as const, expression: cronExpression };

    return {
      name: agentName,
      description,
      trigger,
      stages,
      actions: [],
      enabled: true,
    };
  },

  previewDescription: (config: Record<string, any>) => {
    const fuelTypeLabel = FUEL_TYPE_OPTIONS.find(f => f.value === config.fuelType)?.label || 'Regular';
    const stationCount = config.preferredStations?.length || 0;
    const scheduleLabel = SCHEDULE_OPTIONS.find(s => s.value === config.scheduleType)?.label || 'Manual';

    const notifications: string[] = [];
    if (config.saveToFile) notifications.push('file');
    if (config.discordEnabled) notifications.push('Discord');
    if (config.slackEnabled) notifications.push('Slack');

    const parts = [
      `${config.zipCode || 'ZIP'}`,
      `${config.radius || '10'} mi`,
      fuelTypeLabel,
    ];

    if (stationCount > 0) {
      parts.push(`${stationCount} preferred`);
    }

    parts.push(scheduleLabel);

    if (notifications.length > 0) {
      parts.push(notifications.join(', '));
    }

    return parts.join(' • ');
  },
};
