// Vite settings for the game frontend.
// The /api folder is NOT built by Vite. Vercel runs it as serverless functions.

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Phaser is a big library (about 1 MB). Raise the warning limit
    // so the build does not warn about it every time.
    chunkSizeWarningLimit: 2000,
  },
});
