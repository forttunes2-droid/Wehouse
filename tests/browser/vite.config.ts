import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root = path.resolve(__dirname, '../..');
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: [
    { find: '@/hooks/useAuth', replacement: path.resolve(__dirname, 'authFixture.tsx') },
    { find: '@/lib/supabase/client', replacement: path.resolve(__dirname, 'environmentPresentationFixture.ts') },
    { find: '@', replacement: path.resolve(root, 'src') },
  ] },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_fixture'),
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
