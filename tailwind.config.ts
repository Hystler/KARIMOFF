import type { Config } from "tailwindcss";

const config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        karimoff: {
          orange: "#FB670A",
          white: "#FFFFFF",
          black: "#121214",
          ink: "#2A2927",
          card: "#FFFFFF",
          line: "rgba(18,18,20,0.12)",
          muted: "#6D6B66",
          cream: "#F8F4EE",
          soft: "#F3EEE7"
        }
      },
      boxShadow: {
        glow: "0 18px 42px rgba(251, 103, 10, 0.2)",
        card: "0 18px 45px rgba(18, 18, 20, 0.08)"
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
