import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// KaTeX's stylesheet names every font three times over — woff2, woff, ttf — and
// Vite bundles whatever a stylesheet points at: 59 files, 1 MB, most of the
// `.xdc`. Every webview we target reads woff2, so the other two go. So do the
// sans-serif and typewriter faces (`\mathsf`, `\mathtt`): the system's own
// sans-serif and monospace keep what they mean, and save another 47 KB.
//
// ponytail: Fraktur, script and calligraphic (`\mathfrak`, `\mathscr`,
// `\mathcal`) stay, 45 KB together: no system font stands in for them, and
// `\mathfrak{g}` shown as a plain g says something else.
function katexFonts(): PluginOption {
  return {
    name: 'katex-fonts',
    // Before Vite's own CSS plugin resolves the url()s into bundled files.
    enforce: 'pre',
    transform(css, id) {
      if (!/\/katex\/dist\/katex\.css(\?|$)/.test(id)) return;
      const out = css
        .replace(/, url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '')
        .replace(/@font-face \{[^}]*KaTeX_(?:SansSerif|Typewriter)[^}]*\}\n?/g, '')
        .replace(/font-family: KaTeX_SansSerif;/g, 'font-family: sans-serif;')
        .replace(/font-family: KaTeX_Typewriter;/g, 'font-family: monospace;');
      // Fail the build, not the size budget, if a KaTeX upgrade reshapes this.
      if (/\.(?:woff|ttf)\)|KaTeX_(?:SansSerif|Typewriter)/.test(out) || !out.includes('.woff2)')) {
        this.error('katex-fonts: katex.css no longer matches; update the patterns');
      }
      return out;
    },
  };
}

export default defineConfig({
  build: {
    // Conservative targets matching the messengers' embedded webviews.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    // ~5 KB smaller gzipped than the default esbuild minifier, for a slower build.
    minify: 'terser',
  },
  resolve: {
    alias: {
      // See src/lang-javascript-lite.ts.
      '@codemirror/lang-javascript': fileURLToPath(new URL('./src/lang-javascript-lite.ts', import.meta.url)),
    },
  },
  plugins: [
    ...(process.env.ERUDA ? [eruda()] : []),
    katexFonts(),
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
