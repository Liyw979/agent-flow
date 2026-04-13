import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#D9D4C7",
        input: "#D9D4C7",
        ring: "#2C4A3F",
        background: "#F4EFE6",
        foreground: "#172019",
        primary: {
          DEFAULT: "#2C4A3F",
          foreground: "#F4EFE6",
        },
        secondary: {
          DEFAULT: "#C96F3B",
          foreground: "#FFF8F0",
        },
        muted: {
          DEFAULT: "#E9E1D2",
          foreground: "#5B5A54",
        },
        accent: {
          DEFAULT: "#9DAD7F",
          foreground: "#172019",
        },
        card: {
          DEFAULT: "#FFF8F0",
          foreground: "#172019",
        },
      },
      boxShadow: {
        PANEL: "0 20px 40px rgba(44, 74, 63, 0.10)",
      },
      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "'PingFang SC'", "sans-serif"],
        display: ["'Space Grotesk'", "'PingFang SC'", "sans-serif"],
      },
      backgroundImage: {
        "paper-grid":
          "linear-gradient(rgba(44,74,63,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(44,74,63,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
