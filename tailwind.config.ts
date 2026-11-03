import forms from "@tailwindcss/forms";
import type { Config } from "tailwindcss";

export default {
  content: ['./index.html', './src/**/*.ts'],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        fiona: "#dfbd69",
      },
    },
  },
  plugins: [forms],
} satisfies Config;
