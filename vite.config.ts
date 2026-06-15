import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/verkup/",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        signConfigurator: path.resolve(__dirname, "sign-configurator/index.html"),
      },
    },
  },
});
