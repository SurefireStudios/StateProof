import type { JsonValue } from '../json';
import { isJsonObject } from '../json';
import { type AnyCompiledContract, normalizeRequirements } from '../schema/compiled-contract';
import { toJsonValue } from '../serialize/canonical';

/**
 * A compiled contract may only name entities the task itself names.
 *
 * The whole point of compiling before the run is that the contract cannot
 * depend on ids the run happens to generate. `RFB-9203` is invented at
 * execution time; a contract that hardcodes it would verify one recording
 * rather than the task. Ids the task *does* state — the target order, an
 * explicitly named prior refund, a support case — are fair game.
 *
 * Anything ID-shaped and absent from the task text is rejected here rather
 * than quietly producing a contract that only works once.
 */

/** `ORD-1042`, `RF-8801`, `SUP-2077`, `MSG-7203`, `NOTE-8203`, `RFB-9203`. */
const ID_LIKE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

export interface LiteralViolation {
  readonly requirementId: string;
  readonly literal: string;
  readonly path: string;
}

/** Field names, collection names and requirement ids are not entity ids. */
function isSchemaIdentifier(value: string, allowedIdentifiers: ReadonlySet<string>): boolean {
  return allowedIdentifiers.has(value);
}

function collectStrings(value: JsonValue, path: string, into: Array<[string, string]>): void {
  if (typeof value === 'string') {
    into.push([value, path]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, into));
    return;
  }
  if (isJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      collectStrings(child, path === '' ? key : `${path}.${key}`, into);
    }
  }
}

/**
 * Returns every ID-like literal in the contract's assertions that does not
 * appear in the task text.
 */
export function findUngroundedLiterals(
  contract: AnyCompiledContract,
  taskText: string,
  options: { readonly allowedIdentifiers?: ReadonlySet<string> } = {},
): LiteralViolation[] {
  const allowed = options.allowedIdentifiers ?? new Set<string>();
  const violations: LiteralViolation[] = [];

  for (const requirement of normalizeRequirements(contract)) {
    // The requirement's own id is an internal identifier, not an entity id.
    const requirementAllowed = new Set([...allowed, requirement.id, requirement.requirementKey]);

    const found: Array<[string, string]> = [];
    collectStrings(toJsonValue(requirement.assertions), 'assertions', found);

    for (const [literal, path] of found) {
      if (!ID_LIKE.test(literal)) continue;
      if (isSchemaIdentifier(literal, requirementAllowed)) continue;
      if (taskText.includes(literal)) continue;
      violations.push({ requirementId: requirement.id, literal, path });
    }
  }
  return violations;
}

export function isIdLike(value: string): boolean {
  return ID_LIKE.test(value);
}
