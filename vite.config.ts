import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production serves the console at kehila-app.com/console (Firebase Hosting
// site kehila-admin-386ab); `/` is the landing page, built from site/ and laid
// around the console by scripts/stage-site.mjs. So built asset URLs carry the
// /console/ prefix and the build lands in dist/console — `vite preview` serves
// it the same way. The dev server stays at root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/console/' : '/',
  build: { outDir: 'dist/console' },
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
