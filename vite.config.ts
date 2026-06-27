import { readFileSync } from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';
import zipPack from 'vite-plugin-zip-pack';
import { mockWebxdc } from '@webxdc/vite-plugins';

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
    // Serve a single-peer mock webxdc.js during `vite` dev (serve:app), so the
    // app runs standalone in a browser without webxdc-dev. No-op for `build` —
    // the real webxdc.js comes from the messenger. See @webxdc/vite-plugins.
    mockWebxdc(),
    zipPack({
      outDir: 'dist-release',
      outFileName: 'md-docs.xdc',
    }),
  ],
});
