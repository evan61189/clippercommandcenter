/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'procore-blue': '#0066CC',
        'qb-green': '#2CA01C',
      }
    },
  },
  plugins: [],
}
