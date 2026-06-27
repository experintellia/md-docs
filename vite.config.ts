import { readFileSync } from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';
import zipPack from 'vite-plugin-zip-pack';

// Inject the Eruda mobile console into the bundle when ERUDA=1 is set, so the
// `.xdc` can be debugged on a real device. See README.
function eruda(): PluginOption {
  const erudaSrc = readFileSync('./node_modules/eruda/eruda.js', 'utf-8');
  return {
    name: 'vite-plugin-eruda',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          { tag: 'script', children: erudaSrc, injectTo: 'head' },
          { tag: 'script', children: 'eruda.init();', injectTo: 'head' },
        ],
      };
    },
  };
}

export default defineConfig({
  build: {
    // Conservative targets matching the messengers' embedded webviews.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
  },
  plugins: [
    ...(process.env.ERUDA ? [eruda()] : []),
    zipPack({
      outDir: 'dist-release',
      outFileName: 'md-docs.xdc',
    }),
  ],
});
