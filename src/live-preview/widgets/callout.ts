import { WidgetType } from '@codemirror/view';
import {
  faBolt,
  faBug,
  faCircleCheck,
  faCircleInfo,
  faCircleQuestion,
  faCircleXmark,
  faClipboard,
  faFire,
  faList,
  faPen,
  faQuoteLeft,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faSvg } from '../../ui/icon.ts';

/**
 * An Obsidian callout's first line: `> [!info] Title`. Group 1 is the marker
 * (`[!info]`, with a fold sign `-`/`+` if any), group 2 the type. The rest of
 * the line is the title. Anchored at the quote's `>`.
 */
export const CALLOUT = /^>[ \t]*(\[!([\w-]+)\][+-]?)[ \t]*/;

// One icon and one colour per group. Obsidian's own names for them are in ALIASES.
const GROUPS = new Map<string, IconDefinition>([
  ['note', faPen],
  ['abstract', faClipboard],
  ['info', faCircleInfo],
  ['tip', faFire],
  ['success', faCircleCheck],
  ['question', faCircleQuestion],
  ['warning', faTriangleExclamation],
  ['failure', faCircleXmark],
  ['danger', faBolt],
  ['bug', faBug],
  ['example', faList],
  ['quote', faQuoteLeft],
]);

const ALIASES = new Map<string, string>([
  ['summary', 'abstract'], ['tldr', 'abstract'],
  ['todo', 'info'],
  ['hint', 'tip'], ['important', 'tip'],
  ['check', 'success'], ['done', 'success'],
  ['help', 'question'], ['faq', 'question'],
  ['caution', 'warning'], ['attention', 'warning'],
  ['fail', 'failure'], ['missing', 'failure'],
  ['error', 'danger'],
  ['cite', 'quote'],
]);

/** The group a callout type is drawn as. An unknown type is a note, as in Obsidian. */
export function calloutGroup(type: string): string {
  const name = type.toLowerCase();
  const group = ALIASES.get(name) ?? name;
  return GROUPS.has(group) ? group : 'note';
}

/**
 * Stands in for the `[!type]` marker: the type's icon, then its name when the
 * callout has no title of its own (Obsidian shows the type name as the title).
 */
export class CalloutLabelWidget extends WidgetType {
  readonly group: string;
  readonly label: string;

  constructor(group: string, label: string) {
    super();
    this.group = group;
    this.label = label;
  }

  override eq(other: CalloutLabelWidget): boolean {
    return other.group === this.group && other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'md-callout-label';
    span.appendChild(faSvg(GROUPS.get(this.group) ?? faPen));
    if (this.label) {
      span.append(this.label);
    } else {
      // A titled callout has no type name on screen, so a screen reader gets
      // it here: the icon alone would say nothing about the type.
      const type = document.createElement('span');
      type.className = 'md-sr-only';
      type.textContent = this.group.charAt(0).toUpperCase() + this.group.slice(1) + ': ';
      span.appendChild(type);
    }
    return span;
  }
}
