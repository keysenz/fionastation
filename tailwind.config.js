/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors:{
        'fiona': '#dfbd69'
        // 'fiona' : '#446e92'
      }},
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
