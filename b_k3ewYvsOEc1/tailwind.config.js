/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'deep-void': '#050810',
        'neon-cyan': '#00f3ff',
        'neon-green': '#00ff88',
        'cyber-yellow': '#fcee0a',
        'panel-bg': 'rgba(8,18,28,0.85)',
        'border-glow': 'rgba(0,243,255,0.2)',
      },
      fontFamily: {
        mono: ['Fira Code', 'JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'scan-line': 'scanLine 4s linear infinite',
        'flicker': 'flicker 3s ease-in-out infinite',
        'data-stream': 'dataStream 1s linear infinite',
      },
      keyframes: {
        scanLine: {
          '0%': { top: '-10px' },
          '100%': { top: '100vh' },
        },
      },
    },
  },
  plugins: [],
}
