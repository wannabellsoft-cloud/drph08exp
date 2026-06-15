import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        thai: ['"Sarabun"', '"Noto Sans Thai"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
