import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ZIP_LIMITS, readZip } from '../apps/product/src/server/zip';

/**
 * `pnpm scan:secrets [directory]`
 *
 * A final scan over tracked files, or over an extracted release package, for
 * credentials, private keys, environment files and absolute local paths.
 *
 * The user's real `.env` is never read: the tracked-file mode asks git for the
 * file list, and git already excludes it. The directory mode skips it by name
 * before ever opening it.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

interface Rule {
  readonly id: string;
  readonly description: string;
  readonly test: (text: string) => RegExpMatchArray | null;
}

const RULES: Rule[] = [
  {
    id: 'anthropic-key',
    description: 'an Anthropic API key',
    test: (text) => /sk-ant-[A-Za-z0-9_-]{8,}/.exec(text),
  },
  {
    id: 'stateproof-key-value',
    description: 'STATEPROOF_ANTHROPIC_API_KEY carrying a value',
    test: (text) => /STATEPROOF_ANTHROPIC_API_KEY\s*=\s*\S/.exec(text),
  },
  {
    id: 'anthropic-key-value',
    description: 'ANTHROPIC_API_KEY carrying a value',
    test: (text) => /(?<!STATEPROOF_)ANTHROPIC_API_KEY\s*=\s*\S/.exec(text),
  },
  {
    id: 'private-key-header',
    description: 'a private key block',
    test: (text) => /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/.exec(text),
  },
  {
    id: 'absolute-user-path',
    description: 'an absolute local user path',
    test: (text) => /(?:[A-Za-z]:\\Users\\[A-Za-z0-9._-]+|\/(?:home|Users)\/[A-Za-z0-9._-]+)/.exec(text),
  },
  {
    id: 'generic-secret-assignment',
    description: 'a generic secret or token carrying a value',
    test: (text) =>
      /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i.exec(
        text,
      ),
  },
  {
    id: 'bearer-token',
    description: 'a bearer token literal',
    test: (text) => /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/.exec(text),
  },
  {
    id: 'private-email',
    description: 'an email address outside the synthetic fixture domains',
    test: (text) => {
      for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        const address = match[0].toLowerCase();
        if (SYNTHETIC_EMAIL_DOMAINS.some((domain) => address.endsWith(domain))) continue;
        return match;
      }
      return null;
    },
  },
];

/**
 * Fixture and documentation addresses. The `example.*` domains are reserved by
 * RFC 2606 precisely so that nobody's real inbox ends up in a test fixture, and
 * the Anthropic address is the commit co-author trailer.
 */
const SYNTHETIC_EMAIL_DOMAINS = [
  '@example.com',
  '@example.org',
  '@example.net',
  '@stateproof.local',
  'noreply@anthropic.com',
];

/** Files whose whole purpose is to name these patterns without carrying one. */
const RULE_EXEMPT_FILES = new Set([
  'scripts/scan-secrets.ts',
  'docs/security-and-data.md',
  'packages/agents/test/gate4a.test.ts',
  'apps/dashboard/test/dashboard.test.ts',
  '.env.example',
  '.gitignore',
]);

const FORBIDDEN_PATHS = [
  '.env',
  '.env - Copy.example',
  'node_modules',
  '.claude/settings.local.json',
];

/**
 * Copies of an environment file, however they came to be named, plus key
 * material. `.env.example` is the one permitted member of the family, and it is
 * checked separately for carrying a value.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /^\.env(?!\.example$)(?:[.\s-].*)?$/i,
  /^.+\.env$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /\.(?:pem|pfx|p12|key)$/i,
];

const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.zip', '.pdf', '.woff', '.woff2']);

interface Finding {
  readonly file: string;
  readonly ruleId: string;
  readonly description: string;
  readonly excerpt: string;
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function walk(root: string, prefix = ''): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') return [relative];
      return walk(root, relative);
    }
    return [relative];
  });
}

function scan(root: string, files: readonly string[]): { findings: Finding[]; forbidden: string[] } {
  const findings: Finding[] = [];
  const forbidden: string[] = [];

  for (const relative of files) {
    const base = path.basename(relative);
    if (
      FORBIDDEN_PATHS.includes(relative) ||
      FORBIDDEN_PATHS.includes(base) ||
      FORBIDDEN_PATTERNS.some((pattern) => pattern.test(base))
    ) {
      // Never opened — its presence is the finding.
      forbidden.push(relative);
      continue;
    }
    if (relative.split('/').includes('node_modules')) {
      forbidden.push(relative);
      continue;
    }
    if (RULE_EXEMPT_FILES.has(relative)) continue;
    if (BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;

    const full = path.join(root, relative);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    if (statSync(full).size > 8 * 1024 * 1024) continue;

    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }

    for (const rule of RULES) {
      const match = rule.test(text);
      if (match === null) continue;
      findings.push({
        file: relative,
        ruleId: rule.id,
        description: rule.description,
        excerpt: match[0].slice(0, 60),
      });
    }
  }

  return { findings, forbidden };
}

/**
 * Archives hide their contents from a byte-level scan, so they are opened and
 * each entry is scanned as its own file. The reader is the product's own
 * defensive one, which refuses traversal names and oversized expansions.
 */
function scanArchives(root: string, files: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const relative of files) {
    if (path.extname(relative).toLowerCase() !== '.zip') continue;
    const full = path.join(root, relative);
    if (!existsSync(full) || !statSync(full).isFile()) continue;

    let entries: Array<{ name: string; contents: string }>;
    try {
      entries = readZip(readFileSync(full), { ...DEFAULT_ZIP_LIMITS, maxEntries: 4096 }).map(
        (entry) => ({ name: entry.name, contents: entry.contents.toString('utf8') }),
      );
    } catch (error) {
      findings.push({
        file: relative,
        ruleId: 'unreadable-archive',
        description: 'an archive that could not be opened for scanning',
        excerpt: error instanceof Error ? error.message.slice(0, 60) : 'unknown',
      });
      continue;
    }

    for (const entry of entries) {
      const base = path.basename(entry.name);
      if (
        FORBIDDEN_PATHS.includes(entry.name) ||
        FORBIDDEN_PATHS.includes(base) ||
        FORBIDDEN_PATTERNS.some((pattern) => pattern.test(base))
      ) {
        findings.push({
          file: `${relative}!${entry.name}`,
          ruleId: 'forbidden-archive-entry',
          description: 'a forbidden file inside an archive',
          excerpt: entry.name.slice(0, 60),
        });
        continue;
      }
      for (const rule of RULES) {
        const match = rule.test(entry.contents);
        if (match === null) continue;
        findings.push({
          file: `${relative}!${entry.name}`,
          ruleId: rule.id,
          description: `${rule.description}, inside an archive`,
          excerpt: match[0].slice(0, 60),
        });
      }
    }
  }
  return findings;
}

/** Built output is untracked but shipped, so it is scanned when it exists. */
function builtOutput(root: string): string[] {
  const dists = [
    path.join('apps', 'product', 'dist'),
    path.join('apps', 'dashboard', 'dist'),
  ];
  return dists.flatMap((relative) => {
    const full = path.join(root, relative);
    if (!existsSync(full)) return [];
    return walk(full).map((entry) => path.join(relative, entry).split(path.sep).join('/'));
  });
}

function main(): void {
  const target = process.argv[2];
  const scanningPackage = target !== undefined;
  const root = scanningPackage ? path.resolve(target) : REPO_ROOT;
  const tracked = scanningPackage ? walk(root) : trackedFiles();
  // Built HTML/JS ships to reviewers; scan it whether or not git tracks it.
  const files = [...new Set([...tracked, ...builtOutput(root)])];

  process.stdout.write(
    `secret scan: ${scanningPackage ? `package at ${root}` : 'tracked files and built output'} (${files.length} entries)\n\n`,
  );

  const { findings, forbidden } = scan(root, files);
  findings.push(...scanArchives(root, files));

  // The placeholder is the one permitted mention, and it must stay blank.
  const examplePath = path.join(root, '.env.example');
  if (existsSync(examplePath)) {
    for (const line of readFileSync(examplePath, 'utf8').split('\n')) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (value !== '') {
        findings.push({
          file: '.env.example',
          ruleId: 'env-example-value',
          description: 'the environment template carries a value',
          excerpt: line.slice(0, 40),
        });
      }
    }
  }

  for (const entry of forbidden) {
    process.stdout.write(`  FORBIDDEN  ${entry}\n`);
  }
  for (const finding of findings) {
    process.stdout.write(`  FINDING    ${finding.file}: ${finding.description} (${finding.ruleId})\n`);
    process.stdout.write(`             ${finding.excerpt}\n`);
  }

  const clean = findings.length === 0 && forbidden.length === 0;
  process.stdout.write(
    [
      '',
      `rules applied:  ${RULES.map((rule) => rule.id).join(', ')}, env-example-value, forbidden-archive-entry`,
      `forbidden paths: ${FORBIDDEN_PATHS.join(', ')}, node_modules`,
      `findings:        ${findings.length}`,
      `forbidden found: ${forbidden.length}`,
      '',
      `RESULT: ${clean ? 'CLEAN' : 'FAILED'}`,
      '',
    ].join('\n'),
  );
  if (!clean) process.exitCode = 1;
}

main();
