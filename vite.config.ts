import path from "path"
import { execFileSync } from "node:child_process"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

function releaseVersion() {
  const supplied = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.WEHOUSE_BUILD_VERSION
  if (supplied) return supplied
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return `local-${Date.now()}`
  }
}

const buildVersion = releaseVersion()
const releaseManifest = `${JSON.stringify({ version: buildVersion, forceClear: true }, null, 2)}\n`
const updateWorker = `// WeHouse release ${buildVersion}
const RELEASE = ${JSON.stringify(buildVersion)};

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) { return caches.delete(name); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' || ['script', 'style', 'worker'].includes(event.request.destination)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
  }
});

self.addEventListener('message', function (event) {
  if (event.data === 'WEHOUSE_RELEASE') event.source?.postMessage({ type: 'WEHOUSE_RELEASE', version: RELEASE });
});
`

function releaseAssets() {
  return {
    name: "wehouse-release-assets",
    transformIndexHtml(html: string) {
      return html.replaceAll("__WH_VERSION__", buildVersion)
    },
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0]
        if (pathname !== "/version.json" && pathname !== "/sw.js") return next()
        response.statusCode = 200
        response.setHeader("Cache-Control", "no-store, max-age=0")
        response.setHeader("Content-Type", pathname === "/sw.js" ? "text/javascript; charset=utf-8" : "application/json; charset=utf-8")
        response.end(pathname === "/sw.js" ? updateWorker : releaseManifest)
      })
    },
    generateBundle(this: { emitFile: (asset: { type: "asset"; fileName: string; source: string }) => void }) {
      this.emitFile({ type: "asset", fileName: "version.json", source: releaseManifest })
      this.emitFile({ type: "asset", fileName: "sw.js", source: updateWorker })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    releaseAssets(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: [
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
