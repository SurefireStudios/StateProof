/**
 * Tiny DOM helpers.
 *
 * Every value that reaches the page goes through `textContent`, never
 * `innerHTML`. Imported runs carry attacker-controlled strings — a task
 * instruction, an agent's final response, a tool name — and the safe default
 * has to be structural, not a sanitiser someone remembers to call.
 */

type Attributes = Record<string, string | boolean | undefined>;
export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function verdictClass(verdict: string): string {
  if (verdict === 'PASS') return 'v-pass';
  if (verdict === 'FAIL') return 'v-fail';
  return 'v-review';
}

export function verdictGlyph(verdict: string): string {
  if (verdict === 'PASS') return '✓';
  if (verdict === 'FAIL') return '✕';
  return '?';
}

export function verdictLabel(verdict: string): string {
  return verdict === 'NEEDS_REVIEW' ? 'NEEDS REVIEW' : verdict;
}

export function pill(verdict: string, options: { solid?: boolean } = {}): HTMLElement {
  return el(
    'span',
    {
      class: `pill ${verdictClass(verdict)}${options.solid === true ? ' solid' : ''}`,
      'data-glyph': verdictGlyph(verdict),
    },
    verdictLabel(verdict),
  );
}

export function ms(value: number): string {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}

/** Scrolls to an evidence target and flashes it, so a citation is followable. */
export function highlight(ids: readonly string[]): boolean {
  for (const id of ids) {
    const target = document.getElementById(id);
    if (target === null) continue;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
    return true;
  }
  return false;
}
