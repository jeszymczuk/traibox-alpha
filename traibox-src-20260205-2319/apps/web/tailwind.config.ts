import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0D0E',
        paper: '#F5F7F9',
        muted: '#A3ABB5',
        accent: '#4F8FF4',
        success: '#2FB06E',
        warn: '#E3A008',
        error: '#E12D39'
      }
    }
  },
  plugins: []
} satisfies Config;

