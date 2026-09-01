import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import {
  c, cpp, csharp, dart, java, kotlin, objectiveC, scala,
} from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { go } from '@codemirror/legacy-modes/mode/go';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';

// ponytail: CodeMirror 5 stream modes, not the Lezer `@codemirror/lang-*`
// grammars. Lezer parses more accurately but costs ~133 KB in the `.xdc` for
// twelve languages; these seventeen add ~22 KB. Promote an individual language
// to its Lezer grammar if its highlighting turns out to be worth the bytes.
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
    // These modes tag an object key `property string`, which the legacy token
    // table only resolves one part at a time — without this the whole tag is
    // dropped (with a console warning) and JSON keys fall back to plain string.
    support: new LanguageSupport(
      StreamLanguage.define({ ...parser, tokenTable: { property: tags.propertyName } }),
    ),
  });
}

/**
 * Languages highlighted inside fenced code blocks, matched against the fence's
 * info string (```` ```py ````). An unlisted language stays plain text.
 */
export const codeLanguages: LanguageDescription[] = [
  mode('javascript', ['js', 'jsx', 'node'], javascript),
  mode('json', [], json),
  mode('typescript', ['ts', 'tsx'], typescript),
  mode('python', ['py'], python),
  mode('c', ['h'], c),
  mode('cpp', ['c++', 'cc', 'hpp'], cpp),
  mode('java', [], java),
  // The rest of the clike family costs nothing: `clike.js` is already in the
  // bundle for c/cpp/java, and these are further exports of that same module.
  mode('csharp', ['cs', 'c#'], csharp),
  mode('kotlin', ['kt', 'kts'], kotlin),
  mode('scala', ['sc'], scala),
  mode('dart', [], dart),
  mode('objective-c', ['objc'], objectiveC),
  mode('shell', ['bash', 'sh', 'zsh', 'console'], shell),
  mode('rust', ['rs'], rust),
  mode('go', ['golang'], go),
  mode('yaml', ['yml'], yaml),
  mode('toml', [], toml),
];
