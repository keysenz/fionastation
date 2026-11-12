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
      keyframes: {
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "sheet-up": "sheet-up 280ms cubic-bezier(0.32, 0.72, 0, 1)",
        "pop-in": "pop-in 160ms ease-out",
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [forms],
} satisfies Config;
