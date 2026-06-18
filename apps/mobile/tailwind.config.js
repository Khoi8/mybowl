/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan the app entry plus every screen/component source for class names.
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
