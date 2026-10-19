import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: Number(process.env.STRETCH_PORT ?? 3105),
    strictPort: true,
    proxy: { '/api': process.env.STRETCH_API_URL ?? 'http://127.0.0.1:3005' },
  },
})
