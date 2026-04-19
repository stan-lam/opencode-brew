// Theme utilities
export const themes = {
  dark: 'dark',
  light: 'light',
} as const;

export type Theme = keyof typeof themes;
