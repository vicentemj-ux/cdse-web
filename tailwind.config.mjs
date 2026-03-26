/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'electric-blue': '#007BFF',
        'tech-teal': '#17A2B8',
        'dark-navy': '#0A1628',
        'light-gray': '#F8FAFC',
        'medium-gray': '#E2E8F0',
        'text-primary': '#1E293B',
        'text-secondary': '#64748B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
