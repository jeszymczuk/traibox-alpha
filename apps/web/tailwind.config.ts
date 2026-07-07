import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // — Legacy semantic triplets (kept working; re-pointed at v2.0 palette) —
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
        surface1: 'rgb(var(--surface-1) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',

        // — TRAIBOX Design System v2.0 named tokens —
        'bg-base': 'var(--bg-base)',
        glass1: 'var(--glass-1)',
        glass2: 'var(--glass-2)',
        glass3: 'var(--glass-3)',
        glasspop: 'var(--glass-pop)',
        hairline: 'var(--hairline)',
        'hairline-strong': 'var(--hairline-strong)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        'text-4': 'var(--text-4)',
        cyan: 'var(--cyan)',
        'cyan-2': 'var(--cyan-2)',
        'cyan-soft': 'var(--cyan-soft)',
        'cyan-text': 'var(--cyan-text)',
        good: 'var(--good)',
        'good-soft': 'var(--good-soft)',
        bad: 'var(--bad)',
        'bad-soft': 'var(--bad-soft)',
        warning: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        violet: 'var(--violet)',
        'violet-soft': 'var(--violet-soft)'
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)'
      },
      borderRadius: {
        sm: 'var(--radius-1)',
        md: 'var(--radius-2)',
        lg: 'var(--radius-3)',
        xl: 'var(--radius-3)',
        '2xl': 'var(--radius-4)',
        '3xl': 'var(--radius-5)'
      },
      boxShadow: {
        glass: 'var(--glass-shadow)',
        glasspop: 'var(--glass-shadow-pop)',
        soft: '0 10px 30px rgba(0,0,0,0.08)',
        softDark: '0 12px 40px rgba(0,0,0,0.55)'
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        emphasized: 'var(--ease-emphasized)'
      }
    }
  },
  plugins: []
} satisfies Config;
