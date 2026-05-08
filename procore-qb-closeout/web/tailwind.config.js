/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'clipper-black': '#1A1A1A',
        'clipper-gold': '#F5A623',
        'clipper-gold-light': '#FDF2DC',
        'clipper-gold-dark': '#D4891A',
        'procore-blue': '#0066CC',
        'qb-green': '#2CA01C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
