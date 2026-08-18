import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    inspectAttr(),
    react(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: [
      {
        find: /^@\/pages\/Login$/,
        replacement: path.resolve(__dirname, './src/pages/LoginRecoveryEntry.tsx'),
      },
      {
        find: /^@\/pages\/AdminDashboard$/,
        replacement: path.resolve(__dirname, './src/pages/AdminDashboardUnified.tsx'),
      },
      {
        find: /^@\/pages\/Search$/,
        replacement: path.resolve(__dirname, './src/pages/SearchHousingModern.tsx'),
      },
      {
        find: /^@\/pages\/Chat$/,
        replacement: path.resolve(__dirname, './src/pages/ChatPhase10Modern.tsx'),
      },
      {
        find: /^@\/pages\/PrivacySettings$/,
        replacement: path.resolve(__dirname, './src/pages/PrivacySettingsPhase10.tsx'),
      },
      {
        find: /^@\/pages\/WorkerVerification$/,
        replacement: path.resolve(__dirname, './src/pages/WorkerVerificationPhase9.tsx'),
      },
      {
        find: /^@\/pages\/WorkerDashboard$/,
        replacement: path.resolve(__dirname, './src/pages/WorkerWorkspacePhase9.tsx'),
      },
      {
        find: /^@\/pages\/ListingDetail$/,
        replacement: path.resolve(__dirname, './src/pages/ListingDetailHousingStructural.tsx'),
      },
      {
        find: /^@\/components\/PropertyPipelineWorkspace$/,
        replacement: path.resolve(__dirname, './src/components/PropertyPipelineWorkspaceHousingStructural.tsx'),
      },
      {
        find: /^@\/components\/HousingOperationsWorkspace$/,
        replacement: path.resolve(__dirname, './src/components/HousingOperationsWorkspaceHousingStructural.tsx'),
      },
      {
        find: /^@\/components\/WorkerIdentityCheck$/,
        replacement: path.resolve(__dirname, './src/components/WorkerIdentityCheckPhase10Live.tsx'),
      },
      {
        find: /^@\/components\/BookingNegotiationChat$/,
        replacement: path.resolve(__dirname, './src/components/BookingNegotiationChatPhase10.tsx'),
      },
      {
        find: /^@\/components\/DiscoveryShell$/,
        replacement: path.resolve(__dirname, './src/components/DiscoveryShellModern.tsx'),
      },
      {
        find: /^\.\/CreatorSettingsTabV2$/,
        replacement: path.resolve(__dirname, './src/pages/CreatorSettingsHousingStructural.tsx'),
      },
      {
        find: /^@\/components\/DesktopLayout$/,
        replacement: path.resolve(__dirname, './src/components/DesktopLayoutPhase10.tsx'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
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
})
