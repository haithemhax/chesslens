/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
        arabic: ['Noto Sans Arabic', 'Inter', 'sans-serif'],
        chess: ['Noto Sans Symbols 2', 'Segoe UI Symbol', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          950: '#08090c',
          900: '#0b0d12',
          850: '#10131a',
          800: '#161a23',
          700: '#222834',
          600: '#333b4a',
        },
        brass: {
          100: '#fbf3df',
          200: '#f6e6c4',
          300: '#f0d9a8',
          400: '#e6c079',
          500: '#d4a84f',
        },
        board: {
          light: '#e9dcc1',
          dark: '#8f7350',
          rim: '#3a2d20',
        },
      },
      boxShadow: {
        board: '0 30px 80px -20px rgba(0,0,0,.85), 0 0 0 1px rgba(240,217,168,.14)',
        glow: '0 0 40px -8px rgba(230,192,121,.45)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 3s linear infinite',
      },
    },
  },
  plugins: [],
};
