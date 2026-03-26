import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // This UI is served from the API under /admin/
  base: "/admin/",
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
