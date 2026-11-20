import { defineConfig } from 'vite';

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
    test: {
      environment: 'node',
      include: ['tests/**/*.test.js'],
    },
  };
});
