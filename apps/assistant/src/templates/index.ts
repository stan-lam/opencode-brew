import { AgentTemplate, TemplateCategory } from '../types/AgentTemplate';
import { vacationTemplate } from './vacation';
import { trendingStocksTemplate } from './trending-stocks';
import { shoppingPriceTrackerTemplate } from './shopping-price-tracker';

export const templates: AgentTemplate[] = [
  vacationTemplate,
  trendingStocksTemplate,
  shoppingPriceTrackerTemplate,
];

export const templateCategories: { id: TemplateCategory; name: string; icon: string }[] = [
  { id: 'travel', name: 'Travel & Vacation', icon: '✈️' },
  { id: 'finance', name: 'Finance & Trading', icon: '📈' },
  { id: 'productivity', name: 'Productivity', icon: '⚡' },
  { id: 'monitoring', name: 'Monitoring', icon: '👁️' },
  { id: 'custom', name: 'Custom', icon: '🔧' },
];

export function getTemplateById(id: string): AgentTemplate | undefined {
  return templates.find(t => t.id === id);
}

export function getTemplatesByCategory(category: TemplateCategory): AgentTemplate[] {
  return templates.filter(t => t.category === category);
}

export { vacationTemplate, trendingStocksTemplate, shoppingPriceTrackerTemplate };
export type { AgentTemplate, TemplateCategory };
