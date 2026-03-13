import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        info: {
          DEFAULT: 'var(--info)',
          light: 'var(--info-light)',
          dark: 'var(--info-dark)',
        },
        success: {
          DEFAULT: 'var(--success)',
          light: 'var(--success-light)',
          dark: 'var(--success-dark)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          light: 'var(--warning-light)',
          dark: 'var(--warning-dark)',
        },
        error: {
          DEFAULT: 'var(--error)',
          light: 'var(--error-light)',
          dark: 'var(--error-dark)',
        },
      },
    },
  },
  plugins: [],
}

export default config
