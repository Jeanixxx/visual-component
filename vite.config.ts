import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En GitHub Pages el sitio vive en /<repo>/; en desarrollo local, en /.
// El workflow define VITE_BASE; por defecto se usa la raíz.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
