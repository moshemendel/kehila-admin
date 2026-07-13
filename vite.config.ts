import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/expo-push': {
        target: 'https://exp.host',
        changeOrigin: true,
        rewrite: () => '/--/api/v2/push/send',
      },
    },
  },
})
