import forms from "@tailwindcss/forms";
import type { Config } from "tailwindcss";

export default {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      colors: {
        fiona: "#dfbd69",
      },
    },
  },
  plugins: [forms],
} satisfies Config;
