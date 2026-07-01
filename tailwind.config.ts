import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Microsoft YaHei",
          "PingFang SC",
          "Noto Sans CJK SC",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
