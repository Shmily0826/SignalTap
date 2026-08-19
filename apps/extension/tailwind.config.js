/** @type {import('tailwindcss').Config} */
export default {
  content: ["./sidepanel.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: {
          bg: "#0b0f14",
          panel: "#11161d",
          border: "#232b36",
          text: "#e5e9ef",
          muted: "#8b96a5",
          accent: "#4f8cff",
          good: "#2ecc71",
          warn: "#e2b93b",
          bad: "#e05d5d",
        },
      },
    },
  },
  plugins: [],
};
