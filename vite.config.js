import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Single file output for easy deployment
    rollupOptions: {
      output: {
        // Inline all JS/CSS into the HTML for maximum portability
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3001,
    // CORS headers required for Remix iframe to load the plugin
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  },
  // Ensure the build works as a standalone page
  base: './',
});
