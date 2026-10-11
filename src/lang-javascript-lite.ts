import { LanguageSupport, type StreamParser } from '@codemirror/language';
import { javascript as js, typescript as ts } from '@codemirror/legacy-modes/mode/javascript';
import { streamLanguage } from './live-preview/code-languages';

// ponytail: stands in for `@codemirror/lang-javascript` in the bundle (aliased
// in vite.config.ts). Nothing of ours imports it: lang-markdown → lang-html
// does, to highlight raw `<script>` blocks and `on*=` attributes, and its Lezer
// grammar costs ~34 KB of the `.xdc`. The legacy mode fenced ```js blocks
// already bundle highlights them for free. Only what lang-html imports is
// exported — if it starts importing more, the build fails rather than the app.

function lang(parser: StreamParser<unknown>) {
  const l = streamLanguage(parser);
  // lang-html derives its `<script type="application/json">` parser with
  // `.configure({ top })`, a Lezer-only option — a stream parser has one top.
  Object.assign(l.parser, { configure: () => l.parser });
  return l;
}

export const javascriptLanguage = lang(js);
export const typescriptLanguage = lang(ts);
export const jsxLanguage = javascriptLanguage;
export const tsxLanguage = typescriptLanguage;
export const javascript = () => new LanguageSupport(javascriptLanguage);
