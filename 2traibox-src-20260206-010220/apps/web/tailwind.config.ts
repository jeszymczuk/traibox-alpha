import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
        surface1: 'rgb(var(--surface-1) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)'
      },
      borderRadius: {
        xl: '12px',
        '2xl': '18px'
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.08)',
        softDark: '0 12px 40px rgba(0,0,0,0.55)'
      }
    }
  },
  plugins: []
} satisfies Config;
