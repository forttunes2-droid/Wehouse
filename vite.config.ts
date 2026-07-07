import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from 'vite-plugin-pwa'
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    inspectAttr(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 3000000,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        cacheId: 'wehouse-v6-' + Date.now(),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/btpqlxmqaqfttmtllegx\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-storage-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      manifestFilename: 'manifest-v3.json',
      manifest: {
        name: 'WeHouse',
        short_name: 'WeHouse',
        description: 'Find houses, connect with roommates, hire verified workers',
        theme_color: '#0A0A0F',
        background_color: '#0A0A0F',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        lang: 'en',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Capacitor needs relative paths
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy vendor libraries into separate chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-slot', '@radix-ui/react-separator', '@radix-ui/react-tabs', 'class-variance-authority', 'clsx', 'tailwind-merge', 'lucide-react'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-data': ['@supabase/supabase-js', 'openai'],
          'vendor-utils': ['date-fns', 'sonner', 'embla-carousel-react'],
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (info) => {
          if (info.name === 'manifest.json') return '[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
