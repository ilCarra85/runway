import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Percorsi relativi: l'app funziona anche in una sottocartella (es. GitHub Pages)
  base: './',
  // usePolling: su questa macchina il watcher nativo a volte perde le modifiche e serve file vecchi
  server: { port: 5173, watch: { usePolling: true, interval: 300 } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Runway',
        short_name: 'Runway',
        description: 'Spese, entrate e risparmio sotto controllo',
        lang: 'it',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f6f4',
        theme_color: '#1c5cab',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png}'],
        // il worker di pdf.js (~1,4 MB) serve all'import anche offline
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html'
      }
    })
  ]
});
