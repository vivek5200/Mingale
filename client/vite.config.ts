import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Tauri expects a fixed port in dev
  server: {
    port: 5173,
    strictPort: true,
  },

  // Tauri expects process.env to be available
  envPrefix: ['VITE_', 'TAURI_'],
})
