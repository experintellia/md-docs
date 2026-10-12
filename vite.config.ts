import { existsSync, readFileSync } from 'node:fs';
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
// sans-serif and monospace keep what they mean, and save another 47 KB. And
// two bold faces KaTeX never lays out with (14 KB): bold calligraphic has no
// command at all, and bold Fraktur — only reached by pasting 𝕬-style
// characters — is measured with the regular face's metrics anyway, so the
// browser's synthetic bold of it fits.
//
// ponytail: Fraktur, script and calligraphic (`\mathfrak`, `\mathscr`,
// `\mathcal`) stay, 45 KB together: no system font stands in for them, and
// `\mathfrak{g}` shown as a plain g says something else.
//
// The fonts that remain come from fonts/katex-<version>/: KaTeX's own, minus
// their TrueType hinting (only Windows runs it) and glyph names (no browser
// reads them), 36 KB together. See scripts/strip-katex-fonts.py, which also
// checks that nothing else changed.
function katexFonts(): PluginOption {
  const { version } = JSON.parse(readFileSync('./node_modules/katex/package.json', 'utf-8'));
  const dir = `/fonts/katex-${version}`;
  return {
    name: 'katex-fonts',
    // Before Vite's own CSS plugin resolves the url()s into bundled files.
    enforce: 'pre',
    transform(css, id) {
      // Any of KaTeX's stylesheets (katex.min.css, katex-swap.css), so that
      // switching to one fails the check below instead of silently bundling
      // every font again.
      if (!/\/katex\/dist\/katex[^/]*\.css(\?|$)/.test(id)) return;
      const out = css
        .replace(/, url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '')
        .replace(/@font-face \{[^}]*KaTeX_(?:SansSerif|Typewriter|Caligraphic-Bold|Fraktur-Bold)[^}]*\}\n?/g, '')
        .replace(/font-family: KaTeX_SansSerif;/g, 'font-family: sans-serif;')
        // The app's code font, not a bare `monospace`: alone, that keyword
        // also shrinks the text to the browser's 13/16 monospace size.
        .replace(/font-family: KaTeX_Typewriter;/g, 'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;')
        .replace(/url\(fonts\/(KaTeX_[\w-]+\.woff2)\)/g, `url(${dir}/$1)`);
      // Fail the build, not the size budget, if a KaTeX upgrade reshapes this.
      if (/\.(?:woff|ttf)\)|KaTeX_(?:SansSerif|Typewriter|Caligraphic-Bold|Fraktur-Bold)|url\(fonts\//.test(out) || !out.includes('.woff2)')) {
        this.error('katex-fonts: katex.css no longer matches; update the patterns');
      }
      // Fonts stripped from an older KaTeX would not match its glyph metrics.
      for (const [, path] of out.matchAll(/url\((\/fonts\/[^)]+)\)/g)) {
        if (!existsSync(`.${path}`)) {
          this.error(`katex-fonts: no ${path}; run scripts/strip-katex-fonts.py for KaTeX ${version}`);
        }
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
    // KaTeX's smallest fonts would otherwise be inlined into the app's own
    // stylesheet as base64, and parsed on every start, math or not.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
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
