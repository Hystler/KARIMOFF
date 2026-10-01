import type { Config } from "tailwindcss";

const config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        karimoff: {
          orange: "rgb(var(--karimoff-orange-rgb) / <alpha-value>)",
          "orange-contrast": "rgb(var(--karimoff-orange-contrast-rgb) / <alpha-value>)",
          white: "rgb(var(--karimoff-white-rgb) / <alpha-value>)",
          black: "rgb(var(--karimoff-black-rgb) / <alpha-value>)",
          ink: "rgb(var(--karimoff-ink-rgb) / <alpha-value>)",
          card: "rgb(var(--karimoff-white-rgb) / <alpha-value>)",
          line: "rgba(18,18,20,0.12)",
          muted: "rgb(var(--karimoff-muted-rgb) / <alpha-value>)",
          cream: "rgb(var(--karimoff-cream-rgb) / <alpha-value>)",
          soft: "rgb(var(--karimoff-soft-rgb) / <alpha-value>)"
        }
      },
      spacing: {
        "space-1": "var(--space-1)",
        "space-2": "var(--space-2)",
        "space-3": "var(--space-3)",
        "space-4": "var(--space-4)",
        "space-5": "var(--space-5)",
        "space-6": "var(--space-6)",
        "space-7": "var(--space-7)",
        "space-8": "var(--space-8)",
        "space-9": "var(--space-9)",
        "space-10": "var(--space-10)",
        "page-mobile": "var(--page-gutter-mobile)",
        "page-tablet": "var(--page-gutter-tablet)",
        "page-desktop": "var(--page-gutter-desktop)"
      },
      maxWidth: {
        customer: "1280px"
      },
      borderRadius: {
        control: "var(--radius-control)",
        customer: "var(--radius-customer)",
        panel: "var(--radius-panel)"
      },
      boxShadow: {
        card: "var(--shadow-surface-1)",
        surface: "var(--shadow-surface-1)",
        overlay: "var(--shadow-overlay-2)"
      },
      fontFamily: {
        heading: ["var(--font-rubik)", "sans-serif"],
        sans: [
          "var(--font-manrope)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
} satisfies Config;

export default config;
