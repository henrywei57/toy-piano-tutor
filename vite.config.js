import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// `npm run dev:https` runs with --mode https: serves over HTTPS with a
// self-signed certificate so a phone on the same Wi-Fi can use the mic.
export default defineConfig(async ({ mode }) => {
  const plugins = [];
  if (mode === 'https') {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }
  return {
    // Relative base so the build works from any subpath (e.g. GitHub Pages).
    base: './',
    plugins,
    // TensorFlow.js (for converting audio) is one big chunk, loaded only when used.
    build: { chunkSizeWarningLimit: 800 },
    resolve: {
      // Basic Pitch imports all of TensorFlow.js; give it just the parts it uses.
      alias: [{ find: /^@tensorflow\/tfjs$/, replacement: fileURLToPath(new URL('./src/song/tf.js', import.meta.url)) }],
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.js'],
    },
  };
});
