import { AgentTemplate, TemplateInputGroup, Action, WorkflowStage, CombineStrategy } from '../types/AgentTemplate';

const TRIP_TYPES = [
  { value: 'single', label: 'Single Destination' },
  { value: 'multi', label: 'Multi-Destination Trip' },
  { value: 'cruise', label: 'Cruise' },
];

const TRAVEL_METHODS = [
  { value: 'flight', label: 'Flight', icon: '✈️' },
  { value: 'train', label: 'Train', icon: '🚄' },
  { value: 'car', label: 'Car/Road Trip', icon: '🚗' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'ferry', label: 'Ferry', icon: '⛴️' },
];

const LODGING_TYPES = [
  { value: 'hotel', label: 'Hotel', icon: '🏨' },
  { value: 'airbnb', label: 'Airbnb/Vacation Rental', icon: '🏠' },
  { value: 'hostel', label: 'Hostel', icon: '🛏️' },
  { value: 'resort', label: 'Resort', icon: '🏝️' },
  { value: 'camping', label: 'Camping', icon: '⛺' },
];

const CRUISE_LINES = [
  { value: 'royal_caribbean', label: 'Royal Caribbean' },
  { value: 'carnival', label: 'Carnival Cruise Line' },
  { value: 'norwegian', label: 'Norwegian Cruise Line' },
  { value: 'princess', label: 'Princess Cruises' },
  { value: 'msc', label: 'MSC Cruises' },
  { value: 'celebrity', label: 'Celebrity Cruises' },
  { value: 'disney', label: 'Disney Cruise Line' },
  { value: 'holland', label: 'Holland America Line' },
  { value: 'viking', label: 'Viking Cruises' },
  { value: 'any', label: 'Any / No Preference' },
];

const CABIN_TYPES = [
  { value: 'inside', label: 'Inside Cabin' },
  { value: 'oceanview', label: 'Ocean View' },
  { value: 'balcony', label: 'Balcony' },
  { value: 'suite', label: 'Suite' },
  { value: 'any', label: 'Any / Best Value' },
];

const INTERESTS = [
  { value: 'museums', label: 'Museums & Culture' },
  { value: 'nature', label: 'Nature & Outdoors' },
  { value: 'food', label: 'Food & Dining' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'adventure', label: 'Adventure Sports' },
  { value: 'relaxation', label: 'Relaxation & Spa' },
  { value: 'history', label: 'Historical Sites' },
  { value: 'art', label: 'Art & Architecture' },
  { value: 'beach', label: 'Beach & Water' },
  { value: 'family', label: 'Family Activities' },
  { value: 'photography', label: 'Photography Spots' },
];

const SHORE_EXCURSION_INTERESTS = [
  { value: 'beach', label: 'Beach & Snorkeling' },
  { value: 'culture', label: 'Cultural Tours' },
  { value: 'adventure', label: 'Adventure Activities' },
  { value: 'food', label: 'Food & Wine Tours' },
  { value: 'nature', label: 'Nature & Wildlife' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'relaxation', label: 'Relaxation' },
  { value: 'history', label: 'Historical Sites' },
];

const ACTIVITY_LEVELS = [
  { value: 'relaxed', label: 'Relaxed - Plenty of downtime' },
  { value: 'moderate', label: 'Moderate - Balanced schedule' },
  { value: 'active', label: 'Active - Packed itinerary' },
];

const CHECK_FREQUENCIES = [
  { value: '0 9 * * *', label: 'Daily at 9 AM' },
  { value: '0 9,18 * * *', label: 'Twice daily (9 AM & 6 PM)' },
  { value: '0 9 * * 1,4', label: 'Twice weekly (Mon & Thu)' },
  { value: '0 9 * * 1', label: 'Weekly (Monday)' },
];

const inputGroups: TemplateInputGroup[] = [
  {
    id: 'tripType',
    title: 'Trip Type',
    description: 'What kind of trip are you planning?',
    icon: '🗺️',
    inputs: [
      {
        id: 'tripType',
        label: 'Trip Type',
        type: 'select',
        required: true,
        options: TRIP_TYPES,
        defaultValue: 'single',
        helpText: 'Choose single destination, multi-city trip, or cruise',
      },
    ],
  },
  {
    id: 'destination',
    title: 'Destination',
    description: 'Where are you going?',
    icon: '📍',
    inputs: [
      {
        id: 'origin',
        label: 'Departure City',
        type: 'text',
        required: true,
        placeholder: 'e.g., New York, NY',
        helpText: 'Where you will be traveling from',
      },
      {
        id: 'destination',
        label: 'Destination',
        type: 'text',
        required: false,
        placeholder: 'e.g., Paris, France',
        helpText: 'City, region, or country you want to visit',
        dependsOn: { field: 'tripType', value: 'single' },
      },
      {
        id: 'destinations',
        label: 'Destinations (in order)',
        type: 'textarea',
        required: false,
        placeholder: 'Paris, France - 4 days\nAmsterdam, Netherlands - 3 days\nBrussels, Belgium - 2 days',
        helpText: 'Enter each destination on a new line with duration: "City, Country - X days"',
        dependsOn: { field: 'tripType', value: 'multi' },
      },
      {
        id: 'transportBetween',
        label: 'Transportation Between Cities',
        type: 'textarea',
        required: false,
        placeholder: 'Paris to Amsterdam: Train\nAmsterdam to Brussels: Flight',
        helpText: 'Specify transport for each leg, or leave blank for AI recommendations',
        dependsOn: { field: 'tripType', value: 'multi' },
      },
      {
        id: 'cruiseRegion',
        label: 'Cruise Region',
        type: 'select',
        required: false,
        options: [
          { value: 'caribbean', label: 'Caribbean' },
          { value: 'mediterranean', label: 'Mediterranean' },
          { value: 'alaska', label: 'Alaska' },
          { value: 'bahamas', label: 'Bahamas' },
          { value: 'mexico', label: 'Mexican Riviera' },
          { value: 'hawaii', label: 'Hawaii' },
          { value: 'europe', label: 'Northern Europe' },
          { value: 'asia', label: 'Asia' },
          { value: 'australia', label: 'Australia/New Zealand' },
          { value: 'other', label: 'Other' },
        ],
        defaultValue: 'caribbean',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'departurePort',
        label: 'Preferred Departure Port',
        type: 'text',
        required: false,
        placeholder: 'e.g., Miami, FL or Any',
        helpText: 'Leave blank for any port near your origin',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
    ],
  },
  {
    id: 'dates',
    title: 'Travel Dates',
    description: 'When do you want to travel?',
    icon: '📅',
    inputs: [
      {
        id: 'startDate',
        label: 'Preferred Start Date',
        type: 'date',
        required: true,
      },
      {
        id: 'endDate',
        label: 'Preferred End Date',
        type: 'date',
        required: false,
        helpText: 'For multi-destination trips, this is your return date',
        dependsOn: { field: 'tripType', value: 'single' },
      },
      {
        id: 'endDateMulti',
        label: 'Return Date',
        type: 'date',
        required: false,
        helpText: 'When you want to return home (calculated from destinations if blank)',
        dependsOn: { field: 'tripType', value: 'multi' },
      },
      {
        id: 'cruiseDuration',
        label: 'Cruise Duration',
        type: 'select',
        required: false,
        options: [
          { value: '3-4', label: '3-4 nights' },
          { value: '5-6', label: '5-6 nights' },
          { value: '7', label: '7 nights' },
          { value: '8-9', label: '8-9 nights' },
          { value: '10-14', label: '10-14 nights' },
          { value: '15+', label: '15+ nights' },
        ],
        defaultValue: '7',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'flexibility',
        label: 'Date Flexibility (days)',
        type: 'number',
        required: false,
        defaultValue: 3,
        min: 0,
        max: 14,
        helpText: 'How many days can your dates shift for better prices?',
      },
    ],
  },
  {
    id: 'travel',
    title: 'Travel Method',
    description: 'How do you want to get there?',
    icon: '🚀',
    inputs: [
      {
        id: 'travelMethod',
        label: 'Transportation to First Destination',
        type: 'select',
        required: true,
        options: TRAVEL_METHODS,
        defaultValue: 'flight',
        dependsOn: { field: 'tripType', value: 'single' },
      },
      {
        id: 'travelMethodMulti',
        label: 'Transportation to First City',
        type: 'select',
        required: false,
        options: TRAVEL_METHODS,
        defaultValue: 'flight',
        dependsOn: { field: 'tripType', value: 'multi' },
      },
      {
        id: 'travelMethodCruise',
        label: 'Transportation to Departure Port',
        type: 'select',
        required: false,
        options: TRAVEL_METHODS,
        defaultValue: 'flight',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'classPreference',
        label: 'Flight Class Preference',
        type: 'select',
        required: false,
        options: [
          { value: 'economy', label: 'Economy' },
          { value: 'premium_economy', label: 'Premium Economy' },
          { value: 'business', label: 'Business' },
          { value: 'first', label: 'First Class' },
        ],
        defaultValue: 'economy',
        dependsOn: { field: 'travelMethod', value: 'flight' },
      },
      {
        id: 'directOnly',
        label: 'Direct flights only',
        type: 'checkbox',
        required: false,
        defaultValue: false,
        dependsOn: { field: 'travelMethod', value: 'flight' },
      },
      {
        id: 'carType',
        label: 'Car Type',
        type: 'select',
        required: false,
        options: [
          { value: 'own', label: '🚙 Own Car' },
          { value: 'rental', label: '🚗 Rental Car' },
        ],
        defaultValue: 'rental',
        helpText: 'Choose whether to use your own car or rent one',
        dependsOn: { field: 'travelMethod', value: 'car' },
      },
      {
        id: 'carMpg',
        label: 'Car Fuel Efficiency (MPG)',
        type: 'number',
        required: false,
        defaultValue: 30,
        min: 10,
        max: 100,
        helpText: 'Miles per gallon for gas cost estimation',
        dependsOn: { field: 'travelMethod', value: 'car' },
      },
    ],
  },
  {
    id: 'cruise',
    title: 'Cruise Preferences',
    description: 'Customize your cruise experience',
    icon: '🚢',
    inputs: [
      {
        id: 'cruiseLine',
        label: 'Preferred Cruise Line',
        type: 'multiselect',
        required: false,
        options: CRUISE_LINES,
        defaultValue: ['any'],
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'cabinType',
        label: 'Cabin Type',
        type: 'select',
        required: false,
        options: CABIN_TYPES,
        defaultValue: 'balcony',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'shoreExcursions',
        label: 'Shore Excursion Interests',
        type: 'multiselect',
        required: false,
        options: SHORE_EXCURSION_INTERESTS,
        defaultValue: ['culture', 'food'],
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
      {
        id: 'cruiseAmenities',
        label: 'Important Amenities',
        type: 'textarea',
        required: false,
        placeholder: 'e.g., Kids club, specialty dining, casino, spa',
        dependsOn: { field: 'tripType', value: 'cruise' },
      },
    ],
  },
  {
    id: 'lodging',
    title: 'Lodging',
    description: 'Where do you want to stay?',
    icon: '🏨',
    inputs: [
      {
        id: 'lodgingType',
        label: 'Accommodation Type',
        type: 'multiselect',
        required: false,
        options: LODGING_TYPES,
        defaultValue: ['hotel'],
        dependsOn: { field: 'tripType', value: 'single' },
      },
      {
        id: 'lodgingTypeMulti',
        label: 'Accommodation Type (all cities)',
        type: 'multiselect',
        required: false,
        options: LODGING_TYPES,
        defaultValue: ['hotel'],
        dependsOn: { field: 'tripType', value: 'multi' },
      },
      {
        id: 'starRating',
        label: 'Minimum Star Rating',
        type: 'select',
        required: false,
        options: [
          { value: '2', label: '2+ Stars' },
          { value: '3', label: '3+ Stars' },
          { value: '4', label: '4+ Stars' },
          { value: '5', label: '5 Stars Only' },
        ],
        defaultValue: '3',
        dependsOn: [
          { field: 'tripType', value: 'single' },
          { field: 'tripType', value: 'multi' },
        ],
      },
      {
        id: 'lodgingBudget',
        label: 'Nightly Budget (USD)',
        type: 'number',
        required: false,
        placeholder: 'e.g., 150',
        helpText: 'Maximum per night',
        dependsOn: [
          { field: 'tripType', value: 'single' },
          { field: 'tripType', value: 'multi' },
        ],
      },
    ],
  },
  {
    id: 'travelers',
    title: 'Travelers',
    description: 'Who is traveling?',
    icon: '👥',
    inputs: [
      {
        id: 'adults',
        label: 'Adults',
        type: 'number',
        required: true,
        defaultValue: 2,
        min: 1,
        max: 10,
      },
      {
        id: 'children',
        label: 'Children (0-17)',
        type: 'number',
        required: false,
        defaultValue: 0,
        min: 0,
        max: 10,
      },
      {
        id: 'childrenAges',
        label: 'Children Ages',
        type: 'text',
        required: false,
        placeholder: 'e.g., 5, 8, 12',
        helpText: 'Comma-separated ages',
        dependsOn: { field: 'children', value: 1 },
      },
      {
        id: 'specialNeeds',
        label: 'Special Requirements',
        type: 'textarea',
        required: false,
        placeholder: 'e.g., wheelchair access, dietary restrictions',
      },
    ],
  },
  {
    id: 'interests',
    title: 'Interests & Activities',
    description: 'What do you want to do?',
    icon: '🎯',
    inputs: [
      {
        id: 'interests',
        label: 'Select Your Interests',
        type: 'multiselect',
        required: true,
        options: INTERESTS,
        defaultValue: ['museums', 'food', 'nature'],
      },
      {
        id: 'activityLevel',
        label: 'Activity Level',
        type: 'select',
        required: true,
        options: ACTIVITY_LEVELS,
        defaultValue: 'moderate',
      },
      {
        id: 'mustSee',
        label: 'Must-See Attractions',
        type: 'textarea',
        required: false,
        placeholder: 'e.g., Eiffel Tower, Louvre Museum',
        helpText: 'Specific places you definitely want to visit',
      },
    ],
  },
  {
    id: 'tracking',
    title: 'Price Tracking',
    description: 'How should we monitor prices?',
    icon: '📊',
    inputs: [
      {
        id: 'checkFrequency',
        label: 'Check Frequency',
        type: 'select',
        required: true,
        options: CHECK_FREQUENCIES,
        defaultValue: '0 9 * * *',
      },
      {
        id: 'budgetAlert',
        label: 'Alert when total trip under (USD)',
        type: 'number',
        required: false,
        placeholder: 'e.g., 2000',
        helpText: 'Get notified when prices drop below this amount',
      },
      {
        id: 'enableNotifications',
        label: 'Enable price drop notifications',
        type: 'checkbox',
        required: false,
        defaultValue: true,
      },
    ],
  },
];

interface DestinationLeg {
  city: string;
  days: number;
  transportTo?: string;
}

function parseDestinations(destinationsText: string, transportText: string): DestinationLeg[] {
  if (!destinationsText) return [];
  
  const destinations = destinationsText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const match = line.match(/^(.+?)\s*[-–]\s*(\d+)\s*days?$/i);
      if (match) {
        return { city: match[1].trim(), days: parseInt(match[2]) };
      }
      return { city: line, days: 2 };
    });

  const transports = transportText?.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .reduce((acc, line) => {
      const match = line.match(/^(.+?)\s+to\s+(.+?):\s*(.+)$/i);
      if (match) {
        acc[`${match[1].trim().toLowerCase()}-${match[2].trim().toLowerCase()}`] = match[3].trim();
      }
      return acc;
    }, {} as Record<string, string>) || {};

  return destinations.map((dest, i) => {
    if (i === 0) return { ...dest };
    const prevCity = destinations[i - 1].city.toLowerCase();
    const currCity = dest.city.toLowerCase();
    const key = `${prevCity.split(',')[0]}-${currCity.split(',')[0]}`;
    return { ...dest, transportTo: transports[key] };
  });
}

function generateSingleDestinationPrompts(config: Record<string, any>) {
  const {
    destination,
    origin,
    startDate,
    endDate,
    flexibility,
    travelMethod,
    classPreference,
    directOnly,
    carType,
    carMpg,
    lodgingType,
    starRating,
    lodgingBudget,
    adults,
    children,
    childrenAges,
    specialNeeds,
    interests,
    activityLevel,
    mustSee,
  } = config;

  const travelerDesc = children > 0
    ? `${adults} adults and ${children} children (ages: ${childrenAges || 'not specified'})`
    : `${adults} adults`;

  const duration = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
  const interestsList = Array.isArray(interests) ? interests.join(', ') : interests;
  const lodgingList = Array.isArray(lodgingType) ? lodgingType.join(', ') : lodgingType;

  const destinationResearchPrompt = `Research comprehensive travel information for ${destination}:

1. **Weather & Best Time to Visit**
   - Current weather conditions and forecast for ${startDate} to ${endDate}
   - What to pack for this time of year

2. **Entry Requirements**
   - Visa requirements for travelers from ${origin}
   - COVID-19 or health requirements (if any)
   - Required documents

3. **Local Tips**
   - Local customs and etiquette
   - Common scams to avoid
   - Safety considerations
   - Best neighborhoods to stay

4. **Practical Information**
   - Currency and payment methods
   - Tipping culture
   - Language tips
   - Transportation within ${destination}

5. **Top Attractions for ${interestsList}**
   - Must-visit places matching these interests
   ${mustSee ? `- Specifically include: ${mustSee}` : ''}
   - Opening hours and best times to visit
   - Ticket prices and booking requirements

${specialNeeds ? `6. **Special Requirements**\n   - Information for: ${specialNeeds}` : ''}

<search_web query="${destination} travel guide tips ${new Date().getFullYear()}" />

After searching, provide a well-organized summary with practical, actionable information.`;

  const travelSearchPrompt = travelMethod === 'car' 
    ? `Plan driving route from ${origin} to ${destination}:

**Road Trip Details:**
- Departure: ${startDate}
- Return: ${endDate}
- Travelers: ${travelerDesc}
- Car: ${carType === 'own' ? 'Using own vehicle' : 'Rental car needed'}
- Fuel efficiency: ${carMpg || 30} MPG

<search_web query="driving distance ${origin} to ${destination} route" />
<search_web query="average gas price ${origin.split(',')[0]} today" />

Provide:
1. **Driving Distance & Time**
   - Total miles one-way
   - Estimated driving time
   - Recommended route
   - Round-trip total miles

2. **Current Gas Prices**
   - Average gas price found for the area
   - Use this for fuel cost calculation

3. **Fuel Cost Estimate**
   - Calculate: (Total round-trip miles / ${carMpg || 30} MPG) × [current gas price from search]
   - Show the math and final estimated gas cost

4. **Route Highlights**
   - Scenic stops worth making
   - Good rest/food stops
   - Road conditions or construction alerts

${carType === 'rental' ? `5. **Rental Car Options**
   <search_web query="car rental ${origin} ${startDate} prices" />
   - Best rental deals from ${origin}
   - Recommended car type for the trip
   - Estimated rental cost for the duration` : `5. **Vehicle Prep**
   - Pre-trip checklist for your own car
   - Suggested maintenance before long drive`}

6. **Total Transportation Cost**
   - Gas: $[calculated amount using searched price]
   ${carType === 'rental' ? '- Rental: $[found price]' : '- Vehicle wear estimate: ~$0.10/mile'}
   - Tolls (if applicable)
   - **Total estimated cost**`
    : `Search for ${TRAVEL_METHODS.find(t => t.value === travelMethod)?.label || travelMethod} options from ${origin} to ${destination}:

**Travel Details:**
- Departure: ${startDate} (flexible ±${flexibility || 0} days)
- Return: ${endDate} (flexible ±${flexibility || 0} days)
- Travelers: ${travelerDesc}
${travelMethod === 'flight' ? `- Class: ${classPreference || 'economy'}
- Direct flights only: ${directOnly ? 'Yes' : 'No'}` : ''}

<search_web query="${travelMethod} ${origin} to ${destination} ${startDate} prices deals" />

Provide:
1. Best price options found
2. Recommended booking times
3. Alternative dates if significantly cheaper
4. Tips for getting better prices`;

  const lodgingSearchPrompt = `Search for accommodation in ${destination}:

**Requirements:**
- Check-in: ${startDate}
- Check-out: ${endDate}
- Guests: ${travelerDesc}
- Type: ${lodgingList}
${starRating ? `- Minimum ${starRating} stars` : ''}
${lodgingBudget ? `- Budget: up to $${lodgingBudget}/night` : ''}
${specialNeeds ? `- Special needs: ${specialNeeds}` : ''}

<search_web query="${lodgingList} ${destination} ${startDate} booking deals" />

Provide:
1. Top recommended options with prices
2. Best areas to stay for ${interestsList}
3. Price comparison across platforms
4. Booking tips and potential discounts`;

  const priceTrackingPrompt = travelMethod === 'car'
    ? `Check current costs for road trip to ${destination}:

**Trip Summary:**
- From: ${origin}
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelerDesc}
- Travel: Road trip (${carType === 'own' ? 'own car' : 'rental'})
- Car MPG: ${carMpg || 30}
- Lodging: ${lodgingList}

<search_web query="driving distance ${origin} to ${destination}" />
<search_web query="average gas price ${origin.split(',')[0]} today" />
${carType === 'rental' ? `<search_web query="car rental ${origin} ${startDate} deals" />` : ''}
<search_web query="${lodgingList} ${destination} ${startDate} deals" />

Report:
1. **Driving Costs**
   - Total round-trip distance (miles)
   - Current average gas price (from search)
   - Estimated fuel cost: (miles / ${carMpg || 30}) × [searched gas price]
   ${carType === 'rental' ? '- Current rental car prices' : '- Vehicle wear: ~$0.10/mile'}
   - Toll estimates if applicable

2. **Accommodation Costs**
   - Current best prices
   - Total lodging estimate

3. **Total Trip Cost Estimate**
   - Transportation: $[gas ${carType === 'rental' ? '+ rental' : '+ wear'}]
   - Lodging: $[amount]
   - **TOTAL: $[sum]**

4. Price changes since last check
5. Recommended action`
    : `Check current prices for trip to ${destination}:

**Trip Summary:**
- From: ${origin}
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelerDesc}
- Travel: ${travelMethod}
- Lodging: ${lodgingList}

<search_web query="${travelMethod} ${origin} ${destination} ${startDate} current price" />
<search_web query="${lodgingList} ${destination} ${startDate} deals" />

Compare with previous prices and report:
1. Current best prices for transportation
2. Current best prices for accommodation
3. Total estimated trip cost
4. Price changes since last check
5. Recommended action (book now or wait)`;

  const itineraryPrompt = `Create a detailed ${duration}-day itinerary for ${destination}:

**Trip Details:**
- Dates: ${startDate} to ${endDate}
- Travelers: ${travelerDesc}
- Interests: ${interestsList}
- Activity Level: ${ACTIVITY_LEVELS.find(a => a.value === activityLevel)?.label || activityLevel}
${mustSee ? `- Must Include: ${mustSee}` : ''}
${specialNeeds ? `- Special Considerations: ${specialNeeds}` : ''}

For each day, provide:
1. **Morning Activity** (with opening hours and location)
2. **Lunch Recommendation** (restaurant name, cuisine, price range)
3. **Afternoon Activity** (with practical details)
4. **Dinner Recommendation** (local favorites recommended)
5. **Evening Options** (optional activities)
6. **Transportation Notes** (how to get between locations)

Consider:
- Logical grouping of nearby attractions
- Rest time, especially with children
- Reservation requirements
- Weather-appropriate activities
- Mix of planned and free time based on activity level`;

  return {
    destinationResearch: destinationResearchPrompt,
    travelSearch: travelSearchPrompt,
    lodgingSearch: lodgingSearchPrompt,
    priceTracking: priceTrackingPrompt,
    itinerary: itineraryPrompt,
  };
}

function generateMultiDestinationPrompts(config: Record<string, any>) {
  const {
    origin,
    destinations: destinationsText,
    transportBetween,
    startDate,
    endDateMulti,
    flexibility,
    travelMethodMulti,
    classPreference,
    directOnly,
    lodgingTypeMulti,
    starRating,
    lodgingBudget,
    adults,
    children,
    childrenAges,
    specialNeeds,
    interests,
    activityLevel,
    mustSee,
  } = config;

  const legs = parseDestinations(destinationsText, transportBetween);
  const allCities = legs.map(l => l.city).join(', ');
  const totalDays = legs.reduce((sum, l) => sum + l.days, 0);
  
  const travelerDesc = children > 0
    ? `${adults} adults and ${children} children (ages: ${childrenAges || 'not specified'})`
    : `${adults} adults`;

  const interestsList = Array.isArray(interests) ? interests.join(', ') : interests;
  const lodgingList = Array.isArray(lodgingTypeMulti) ? lodgingTypeMulti.join(', ') : lodgingTypeMulti;

  const destinationResearchPrompt = `Research comprehensive travel information for a multi-city trip: ${allCities}

For EACH destination, provide:

${legs.map((leg, i) => `
### ${i + 1}. ${leg.city} (${leg.days} days)

1. **Weather & Conditions**
   - Expected weather during visit
   - What to pack

2. **Entry Requirements**
   - Visa requirements for travelers from ${origin}
   - Any border crossing notes${leg.transportTo ? ` (arriving by ${leg.transportTo})` : ''}

3. **Local Tips**
   - Local customs and etiquette
   - Safety considerations
   - Best areas to stay

4. **Top Attractions for ${interestsList}**
   - Must-visit places (given ${leg.days} days available)
   ${mustSee ? `- Check if any must-see items apply: ${mustSee}` : ''}

5. **Practical Info**
   - Currency
   - Local transportation
   - Language tips
`).join('\n')}

${specialNeeds ? `**Special Requirements across all cities:**\n- ${specialNeeds}` : ''}

<search_web query="${allCities} multi-city trip guide ${new Date().getFullYear()}" />

Provide a consolidated summary organized by city with practical, actionable information.`;

  const travelSearchPrompt = `Search for transportation for multi-city trip:

**Trip Overview:**
- Origin: ${origin}
- Route: ${origin} → ${legs.map(l => l.city).join(' → ')} → ${origin}
- Travelers: ${travelerDesc}
- Flight class preference: ${classPreference || 'economy'}
- Direct flights only: ${directOnly ? 'Yes' : 'No'}

**Legs to search:**

1. **${origin} to ${legs[0]?.city}** (${travelMethodMulti || 'flight'})
   - Date: ${startDate} (flexible ±${flexibility || 0} days)
   <search_web query="${travelMethodMulti || 'flight'} ${origin} to ${legs[0]?.city} ${startDate} prices" />

${legs.slice(1).map((leg, i) => {
  const prevLeg = legs[i];
  const transport = leg.transportTo || 'best option';
  return `
${i + 2}. **${prevLeg.city} to ${leg.city}** (${transport})
   <search_web query="${transport} ${prevLeg.city} to ${leg.city} prices" />`;
}).join('\n')}

${legs.length > 0 ? `
${legs.length + 1}. **${legs[legs.length - 1].city} to ${origin}** (return flight)
   - Date: ${endDateMulti || 'calculate based on itinerary'}
   <search_web query="flight ${legs[legs.length - 1].city} to ${origin} prices" />` : ''}

Provide:
1. Best prices for each leg
2. Total transportation cost
3. Recommended booking strategy
4. Alternative routes if significantly cheaper`;

  const lodgingSearchPrompt = `Search for accommodation across multi-city trip:

**Trip Overview:**
- Cities: ${allCities}
- Travelers: ${travelerDesc}
- Accommodation type: ${lodgingList}
${starRating ? `- Minimum ${starRating} stars` : ''}
${lodgingBudget ? `- Budget: up to $${lodgingBudget}/night` : ''}

**Search each city:**

${legs.map((leg, i) => {
  const prevDays = legs.slice(0, i).reduce((sum, l) => sum + l.days, 0);
  const checkIn = `Day ${prevDays + 1}`;
  const checkOut = `Day ${prevDays + leg.days + 1}`;
  return `
### ${leg.city} (${leg.days} nights)
- Approximate dates: ${checkIn} to ${checkOut}
<search_web query="${lodgingList} ${leg.city} booking deals" />`;
}).join('\n')}

Provide for each city:
1. Top 2-3 recommended hotels/accommodations
2. Best neighborhood to stay
3. Estimated cost per night
4. Total accommodation cost for entire trip`;

  const priceTrackingPrompt = `Check current prices for multi-city trip:

**Trip Summary:**
- Route: ${origin} → ${allCities} → ${origin}
- Total duration: ${totalDays} days
- Travelers: ${travelerDesc}

**Check prices for:**

1. Transportation (all legs):
${legs.map((leg, i) => {
  if (i === 0) return `   - ${origin} to ${leg.city}`;
  return `   - ${legs[i-1].city} to ${leg.city}`;
}).join('\n')}
   - ${legs[legs.length - 1]?.city} to ${origin} (return)

2. Accommodation (all cities):
${legs.map(leg => `   - ${leg.city}: ${leg.days} nights`).join('\n')}

<search_web query="multi-city flights ${origin} ${legs[0]?.city} prices ${startDate}" />
<search_web query="${lodgingList} ${legs[0]?.city} deals" />

Report:
1. Current best prices per leg
2. Current lodging prices per city
3. Total estimated trip cost
4. Comparison with previous check
5. Best booking timing recommendations`;

  const itineraryPrompt = `Create a detailed ${totalDays}-day itinerary for multi-city trip:

**Route:** ${origin} → ${legs.map(l => `${l.city} (${l.days} days)`).join(' → ')} → ${origin}

**Travelers:** ${travelerDesc}
**Interests:** ${interestsList}
**Activity Level:** ${ACTIVITY_LEVELS.find(a => a.value === activityLevel)?.label || activityLevel}
${mustSee ? `**Must Include:** ${mustSee}` : ''}
${specialNeeds ? `**Special Considerations:** ${specialNeeds}` : ''}

**Create itinerary by city:**

${legs.map((leg, i) => {
  const startDay = legs.slice(0, i).reduce((sum, l) => sum + l.days, 0) + 1;
  const endDay = startDay + leg.days - 1;
  return `
### ${leg.city} (Days ${startDay}-${endDay})
${leg.transportTo ? `*Arriving by ${leg.transportTo}*` : i === 0 ? `*Arriving by ${travelMethodMulti || 'flight'} from ${origin}*` : ''}

For each of the ${leg.days} days, include:
- Morning activity
- Lunch recommendation
- Afternoon activity
- Dinner recommendation
- Evening options
- Internal transportation notes`;
}).join('\n')}

**Consider:**
- Jet lag and travel fatigue on arrival days
- Practical time for inter-city travel
- Logical attraction grouping
- Rest days if needed
- Local transportation between attractions`;

  return {
    destinationResearch: destinationResearchPrompt,
    travelSearch: travelSearchPrompt,
    lodgingSearch: lodgingSearchPrompt,
    priceTracking: priceTrackingPrompt,
    itinerary: itineraryPrompt,
  };
}

function generateCruisePrompts(config: Record<string, any>) {
  const {
    origin,
    cruiseRegion,
    departurePort,
    startDate,
    cruiseDuration,
    flexibility,
    classPreference,
    cruiseLine,
    cabinType,
    shoreExcursions,
    cruiseAmenities,
    adults,
    children,
    childrenAges,
    specialNeeds,
    interests,
    activityLevel,
  } = config;

  const travelerDesc = children > 0
    ? `${adults} adults and ${children} children (ages: ${childrenAges || 'not specified'})`
    : `${adults} adults`;

  const cruiseLineList = Array.isArray(cruiseLine) ? cruiseLine.filter(c => c !== 'any').join(', ') : cruiseLine;
  const preferredLines = cruiseLineList || 'any cruise line';
  const shoreInterests = Array.isArray(shoreExcursions) ? shoreExcursions.join(', ') : shoreExcursions;
  const generalInterests = Array.isArray(interests) ? interests.join(', ') : interests;
  const cabinPref = CABIN_TYPES.find(c => c.value === cabinType)?.label || cabinType;

  const cruiseResearchPrompt = `Research ${cruiseRegion} cruises for planning:

**Cruise Requirements:**
- Region: ${cruiseRegion}
- Duration: ${cruiseDuration} nights
- Departure port preference: ${departurePort || 'flexible'}
- Cruise lines: ${preferredLines}
- Cabin type: ${cabinPref}
- Travelers: ${travelerDesc}

<search_web query="${cruiseRegion} cruise ${cruiseDuration} nights ${preferredLines !== 'any cruise line' ? preferredLines : ''} ${new Date().getFullYear()}" />

Research and provide:

1. **Best Cruise Options**
   - Top 3-5 matching itineraries
   - Ports of call for each
   - Ship names and features
   - Departure dates near ${startDate}

2. **Port Highlights**
   - Brief overview of each port typically visited
   - Best activities matching interests: ${generalInterests}
   - Shore excursion recommendations for: ${shoreInterests}

3. **Cruise Line Comparison**
   - Pros/cons of matching cruise lines
   - Best for: ${children > 0 ? 'families with children' : 'adults'}
   ${cruiseAmenities ? `- Amenities check: ${cruiseAmenities}` : ''}

4. **Practical Information**
   - What's included vs extra cost
   - Gratuity policies
   - Drink packages and dining options
   - Embarkation tips

5. **Getting to the Port**
   - Best way from ${origin} to ${departurePort || 'the departure port'}
   - Nearby hotels if arriving day before

${specialNeeds ? `6. **Special Requirements**\n   - Accessibility and accommodations for: ${specialNeeds}` : ''}`;

  const cruiseSearchPrompt = `Search for current ${cruiseRegion} cruise deals:

**Search Criteria:**
- Region: ${cruiseRegion}
- Duration: ${cruiseDuration} nights
- Dates: Around ${startDate} (flexible ±${flexibility || 0} days)
- Departure port: ${departurePort || 'any'}
- Cruise lines: ${preferredLines}
- Cabin: ${cabinPref}
- Travelers: ${travelerDesc}

<search_web query="${cruiseRegion} cruise deals ${cruiseDuration} nights ${startDate} ${preferredLines !== 'any cruise line' ? preferredLines : ''}" />
<search_web query="${cruiseRegion} cruise ${cabinType} cabin prices ${new Date().getFullYear()}" />

Provide:
1. **Best Value Options** (top 3-5 cruises with prices)
   - Cruise line and ship
   - Departure date and port
   - Itinerary highlights
   - Cabin price for ${cabinPref}
   - What's included

2. **Flight Options to Port**
   ${departurePort ? `<search_web query="flights ${origin} to ${departurePort} ${startDate}" />` : ''}
   - Best flight deals to reach departure port

3. **Total Trip Estimate**
   - Cruise fare
   - Flights
   - Pre/post cruise hotel if needed
   - Estimated extras (gratuities, excursions)

4. **Booking Recommendations**
   - Best time to book
   - Current promotions or offers
   - Price trend (rising/falling)`;

  const shoreExcursionPrompt = `Plan shore excursions for ${cruiseRegion} cruise:

**Traveler Profile:**
- Group: ${travelerDesc}
- Interests: ${generalInterests}
- Shore excursion preferences: ${shoreInterests}
- Activity level: ${ACTIVITY_LEVELS.find(a => a.value === activityLevel)?.label || activityLevel}
${specialNeeds ? `- Special needs: ${specialNeeds}` : ''}

**For each typical ${cruiseRegion} cruise port, recommend:**

<search_web query="${cruiseRegion} cruise port shore excursions ${shoreInterests} ${new Date().getFullYear()}" />

1. **Top Excursion Options**
   - Ship-sponsored vs independent tours
   - Prices and duration
   - Physical requirements

2. **DIY Alternatives**
   - Self-guided options
   - Local transportation
   - Must-see spots within walking distance

3. **Port-Specific Tips**
   - Time in port (typical)
   - Best way to spend limited time
   - What to skip if short on time
   - Local food to try
   - Shopping opportunities

4. **Booking Strategy**
   - Book through cruise line vs third party
   - When to book in advance
   - Cancellation policies`;

  const priceTrackingPrompt = `Check current cruise prices:

**Tracking:**
- Region: ${cruiseRegion}
- Duration: ${cruiseDuration} nights
- Target date: Around ${startDate}
- Cruise lines: ${preferredLines}
- Cabin: ${cabinPref}
- Travelers: ${travelerDesc}

<search_web query="${cruiseRegion} cruise ${cruiseDuration} nights deals ${cabinType} ${startDate}" />
<search_web query="${preferredLines !== 'any cruise line' ? preferredLines : 'cruise'} ${cruiseRegion} promotions" />

Report:
1. **Current Best Prices**
   - Top 3 deals found
   - Price per person
   - What's included

2. **Price Trends**
   - Comparison with previous check
   - Price direction (up/down)
   - Cabin availability status

3. **Current Promotions**
   - Onboard credit offers
   - Drink package deals
   - Reduced deposits
   - Kids sail free promotions

4. **Recommendation**
   - Book now or wait?
   - Best value option
   - Alternative dates if significantly cheaper`;

  return {
    destinationResearch: cruiseResearchPrompt,
    travelSearch: cruiseSearchPrompt,
    lodgingSearch: shoreExcursionPrompt,
    priceTracking: priceTrackingPrompt,
    itinerary: shoreExcursionPrompt,
  };
}

function generatePrompts(config: Record<string, any>) {
  const { tripType } = config;
  
  if (tripType === 'multi') {
    return generateMultiDestinationPrompts(config);
  } else if (tripType === 'cruise') {
    return generateCruisePrompts(config);
  } else {
    return generateSingleDestinationPrompts(config);
  }
}

function createAction(id: string, name: string, prompt: string, order: number): Action {
  return {
    id,
    name,
    action_type: {
      type: 'ai_prompt',
      prompt,
    },
    order,
    on_error: 'continue',
  };
}

function getTripSummary(config: Record<string, any>): { name: string; description: string; filePrefix: string } {
  const { tripType, destination, destinations, cruiseRegion, origin, startDate, endDate, endDateMulti, cruiseDuration, adults, children } = config;
  const travelers = children > 0 ? `${adults} adults, ${children} children` : `${adults} adults`;

  if (tripType === 'multi') {
    const legs = parseDestinations(destinations, '');
    const cities = legs.map(l => l.city.split(',')[0]).join(' → ');
    const totalDays = legs.reduce((sum, l) => sum + l.days, 0);
    return {
      name: `Multi-City Trip: ${cities}`,
      description: `${cities} • ${startDate} • ${totalDays} days • ${travelers}`,
      filePrefix: `multi-city-${legs[0]?.city.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'trip'}`,
    };
  } else if (tripType === 'cruise') {
    const region = cruiseRegion?.charAt(0).toUpperCase() + cruiseRegion?.slice(1);
    return {
      name: `${region} Cruise Planner`,
      description: `${region} Cruise • ${startDate} • ${cruiseDuration} nights • ${travelers}`,
      filePrefix: `cruise-${cruiseRegion || 'trip'}`,
    };
  } else {
    return {
      name: `${destination} Vacation Planner`,
      description: `Trip to ${destination} • ${startDate} to ${endDate} • ${travelers}`,
      filePrefix: `vacation-${destination?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'trip'}`,
    };
  }
}

export const vacationTemplate: AgentTemplate = {
  id: 'vacation-planner',
  name: 'Vacation Planner',
  description: 'Plan trips with AI-powered research, price tracking, and itineraries. Supports single destinations, multi-city trips, and cruises.',
  longDescription: `This template creates a comprehensive vacation planning agent that:
  
• **Single Destination:** Research, price tracking, and daily itinerary for one location
• **Multi-City Trips:** Plan routes with different transportation between cities
• **Cruises:** Find deals, compare ships, and plan shore excursions

The agent runs on your chosen schedule to keep prices updated and can notify you of significant price changes.`,
  icon: '🏖️',
  category: 'travel',
  tags: ['travel', 'vacation', 'cruise', 'multi-city', 'price tracking', 'itinerary'],
  inputGroups,
  
  previewDescription: (config) => {
    const { tripType } = config;
    const summary = getTripSummary(config);
    return summary.description;
  },
  
  generateAgent: (config) => {
    const { tripType, checkFrequency, startDate, endDate, cruiseDuration } = config;
    const prompts = generatePrompts(config);
    const summary = getTripSummary(config);
    
    const isCruise = tripType === 'cruise';
    
    const stages: WorkflowStage[] = [
      {
        id: 'stage-research',
        name: isCruise ? 'Research Cruise Options' : 'Gather Destination Info',
        actions: [
          createAction('research-dest', isCruise ? 'Research Cruises' : 'Research Destination(s)', prompts.destinationResearch, 0),
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: 0,
      },
      {
        id: 'stage-search',
        name: isCruise ? 'Search Cruise Deals' : 'Search Travel Options',
        actions: [
          createAction('search-travel', isCruise ? 'Search Cruise Prices' : 'Search Transportation', prompts.travelSearch, 0),
          createAction('search-lodging', isCruise ? 'Plan Shore Excursions' : 'Search Lodging', prompts.lodgingSearch, 1),
        ],
        combineStrategy: 'named' as CombineStrategy,
        order: 1,
      },
      {
        id: 'stage-track',
        name: 'Track Prices',
        actions: [
          createAction('track-prices', 'Check Current Prices', prompts.priceTracking, 0),
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: 2,
      },
      {
        id: 'stage-log',
        name: 'Save Price History',
        actions: [
          {
            id: 'log-prices',
            name: 'Log Price History',
            action_type: {
              type: 'save_file',
              path: `~/${summary.filePrefix}-prices.json`,
              content: JSON.stringify({
                timestamp: '{{datetime}}',
                tripType,
                dates: { start: startDate, end: endDate || cruiseDuration },
                results: '{{track-prices_output}}',
              }, null, 2),
              append: true,
            },
            order: 0,
            on_error: 'continue',
          },
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: 3,
      },
      {
        id: 'stage-itinerary',
        name: isCruise ? 'Shore Excursion Planning' : 'Build Itinerary',
        actions: [
          createAction('build-itinerary', isCruise ? 'Plan Port Activities' : 'Create Daily Schedule', prompts.itinerary, 0),
        ],
        combineStrategy: 'first_success' as CombineStrategy,
        order: 4,
      },
    ];
    
    return {
      name: summary.name,
      description: summary.description,
      trigger: {
        type: 'cron',
        expression: checkFrequency || '0 9 * * *',
      },
      stages,
      enabled: true,
    };
  },
};

export default vacationTemplate;
