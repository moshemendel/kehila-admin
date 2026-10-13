import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production is served at kehilink.com/app/admin (proxied by the kehilink
// Vercel project to this one), so built asset URLs carry that prefix — and
// `vite preview` serves the build the same way. The dev server stays at root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/app/admin/' : '/',
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
}))
