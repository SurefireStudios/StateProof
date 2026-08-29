import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if (FORBIDDEN_PATHS.includes(relative) || FORBIDDEN_PATHS.includes(base)) {
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

function main(): void {
  const target = process.argv[2];
  const scanningPackage = target !== undefined;
  const root = scanningPackage ? path.resolve(target) : REPO_ROOT;
  const files = scanningPackage ? walk(root) : trackedFiles();

  process.stdout.write(
    `secret scan: ${scanningPackage ? `package at ${root}` : 'tracked files'} (${files.length} entries)\n\n`,
  );

  const { findings, forbidden } = scan(root, files);

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
      `rules applied:  ${RULES.map((rule) => rule.id).join(', ')}, env-example-value`,
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
