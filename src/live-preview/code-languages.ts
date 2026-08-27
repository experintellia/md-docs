import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { javascript, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { c, cpp, java } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { go } from '@codemirror/legacy-modes/mode/go';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';

// ponytail: CodeMirror 5 stream modes, not the Lezer `@codemirror/lang-*`
// grammars. Lezer parses more accurately but costs ~133 KB in the `.xdc` for
// twelve languages; these eleven add ~21 KB. Promote an individual language to
// its Lezer grammar if its highlighting turns out to be worth the bytes.
//
// `support` (not `load`) so the mode is there on the first parse: everything
// is bundled anyway, and a lazy load would leave the block unhighlighted until
// the promise resolves and the parse is retried.
function mode(
  name: string,
  alias: string[],
  parser: StreamParser<unknown>,
): LanguageDescription {
  return LanguageDescription.of({
    name,
    alias,
    support: new LanguageSupport(StreamLanguage.define(parser)),
  });
}

/**
 * Languages highlighted inside fenced code blocks, matched against the fence's
 * info string (```` ```py ````). An unlisted language stays plain text.
 */
export const codeLanguages: LanguageDescription[] = [
  mode('javascript', ['js', 'jsx', 'node', 'json'], javascript),
  mode('typescript', ['ts', 'tsx'], typescript),
  mode('python', ['py'], python),
  mode('c', ['h'], c),
  mode('cpp', ['c++', 'cc', 'hpp'], cpp),
  mode('java', [], java),
  mode('shell', ['bash', 'sh', 'zsh', 'console'], shell),
  mode('rust', ['rs'], rust),
  mode('go', ['golang'], go),
  mode('yaml', ['yml'], yaml),
  mode('toml', [], toml),
];
