import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import { buildProduct } from '../src/build';
import { benchmarkView } from '../src/server/benchmark';
import { compileStatus } from '../src/server/compile';
import { DEMO_CASE_ID, demoSummary, heroProof, verifyDemo } from '../src/server/demo';
import { buildEvidencePack, renderEvidenceMarkdown } from '../src/server/evidence';
import {
  ImportError,
  REQUIRED_FILES,
  clearImports,
  importRun,
} from '../src/server/importer';
import { clearRuns, getRun } from '../src/server/runs';
import { ZipError, assertSafeEntryName, readZip } from '../src/server/zip';
import {
  RunViewSchema,
  ImportResultSchema,
  BenchmarkViewSchema,
  HeroProofSchema,
} from '../src/shared/types';

/**
 * The product is a surface over a frozen engine. These tests hold it to that:
 * it must run the real verifier, never invent a number, never reach gold data,
 * never write into the submitted artifacts, and treat every upload as hostile.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PRODUCT_SRC = path.join(REPO_ROOT, 'apps', 'product', 'src');
const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  clearRuns();
  clearImports();
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

// --- a minimal ZIP writer, so archive tests build real archives -------------
function makeZip(entries: Array<{ name: string; contents: string; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.contents, 'utf8');
    const stored = entry.store === true;
    const data = stored ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuffer, eocd]);
}

/** A valid run package built from a committed development case. */
function runPackageFiles(caseId = 'PBH-B01'): Record<string, string> {
  const dir = path.join(HARD_CASES_DIR, caseId);
  return {
    'task.json': readFileSync(path.join(dir, 'task.json'), 'utf8'),
    'tool-registry.json': readFileSync(path.join(dir, 'tool-registry.json'), 'utf8'),
    'initial-state.json': readFileSync(path.join(dir, 'initial-state.json'), 'utf8'),
    'final-state.json': readFileSync(path.join(dir, 'final-state.json'), 'utf8'),
    'trajectory.jsonl': readFileSync(path.join(dir, 'trajectory.jsonl'), 'utf8'),
    'final-response.txt': readFileSync(path.join(dir, 'final-response.txt'), 'utf8'),
  };
}

// --- the demo ----------------------------------------------------------------

describe('the built-in demo', () => {
  it('uses a development case, never a locked one', () => {
    const summary = demoSummary(REPO_ROOT);
    expect(summary.caseId).toBe(DEMO_CASE_ID);
    const registry = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'submission', 'reproduction-manifest.json'), 'utf8'),
    ) as { replayCaseIds: string[]; lockedCaseIds: string[] };
    expect(registry.replayCaseIds).toContain(summary.caseId);
    expect(registry.lockedCaseIds).not.toContain(summary.caseId);
  });

  it('builds the landing-page panel out of the verifier, not out of copy', () => {
    // The home page makes a strong claim in a few lines. Everything in it has
    // to survive a re-execution, or the panel becomes marketing about a
    // product whose entire argument is that summaries are not evidence.
    const hero = HeroProofSchema.parse(heroProof(REPO_ROOT));
    const run = verifyDemo(REPO_ROOT);

    expect(hero.caseId).toBe(DEMO_CASE_ID);
    expect(hero.agentClaim).toBe(run.agentClaim);
    expect(hero.verdict).toBe(run.verdict);
    expect(hero.requirementsChecked).toBe(run.requirements.length);
    expect(hero.modelCalls).toBe(0);
    expect(hero.modelTokens).toBe(0);

    const contradicted = run.requirements.filter((requirement) => requirement.status !== 'PASS');
    expect(hero.requirementsFailed).toBe(contradicted.length);
    expect(hero.findings).toHaveLength(contradicted.length);
    expect(hero.findings.map((finding) => finding.requirementKey)).toEqual(
      contradicted.map((requirement) => requirement.requirementKey),
    );

    for (const [index, finding] of hero.findings.entries()) {
      const requirement = contradicted[index];
      expect(requirement).toBeDefined();
      if (requirement === undefined) continue;
      expect(finding.status).toBe(requirement.status);
      // The evidence is the verifier's own words, carried whole.
      expect(requirement.reason).toContain(finding.evidence);
      expect(finding.evidence.length).toBeGreaterThan(0);
      // The label is the key humanised — never a summary of the finding.
      expect(finding.label.toLowerCase()).toBe(requirement.requirementKey.replace(/_/g, ' '));
    }
  });

  it('runs the real verifier and makes zero model calls', () => {
    const run = verifyDemo(REPO_ROOT);
    expect(RunViewSchema.parse(run)).toBeTruthy();
    expect(run.modelCalls).toBe(0);
    expect(run.modelTokens).toBe(0);
    expect(run.mode).toBe('deterministic');
    expect(run.contract.source).toBe('frozen-bundle');
  });

  it('reproduces the submitted StateProof verdict for that case', () => {
    const run = verifyDemo(REPO_ROOT);
    const registry = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'submission', 'reproduction-manifest.json'), 'utf8'),
    ) as { replayTargetRunId: string; runs: Array<{ id: string; predictionPath: string }> };
    const target = registry.runs.find((entry) => entry.id === registry.replayTargetRunId);
    const submitted = JSON.parse(
      readFileSync(path.join(REPO_ROOT, target?.predictionPath ?? ''), 'utf8'),
    ) as {
      predictions: Array<{
        caseId: string;
        contractHash: string;
        prediction: { verdict: string; requirementAssessments: Array<{ requirementKey: string; status: string }> };
      }>;
    };
    const pinned = submitted.predictions.find((entry) => entry.caseId === DEMO_CASE_ID);
    expect(pinned).toBeDefined();
    expect(run.verdict).toBe(pinned?.prediction.verdict);
    expect(run.contract.contractHash).toBe(pinned?.contractHash);
    expect(run.requirements.map((requirement) => `${requirement.requirementKey}:${requirement.status}`)).toEqual(
      pinned?.prediction.requirementAssessments.map(
        (assessment) => `${assessment.requirementKey}:${assessment.status}`,
      ),
    );
  });

  it('resolves every evidence reference to something the inspector renders', () => {
    const run = verifyDemo(REPO_ROOT);
    const eventIds = new Set(run.timeline.map((event) => `ev-${event.eventId}`));
    const diffIds = new Set(run.diff.map((collection) => `diff-${collection.collection}`));
    const recordIds = new Set(
      run.diff.flatMap((collection) =>
        collection.changes.map((change) => `rec-${collection.collection}-${change.recordId}`),
      ),
    );
    const rendered = new Set([...eventIds, ...diffIds, ...recordIds, 'timeline']);

    const references = run.requirements.flatMap((requirement) => requirement.evidence);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.targets.length, reference.ref).toBeGreaterThan(0);
      expect(reference.targets.some((target) => rendered.has(target)), reference.ref).toBe(true);
    }
  });

  it('keeps runs in memory only, and expires them', () => {
    const run = verifyDemo(REPO_ROOT);
    expect(getRun(run.runId)).not.toBeNull();
    expect(getRun(run.runId, Date.now() + 3 * 60 * 60 * 1000)).toBeNull();
  });
});

// --- evidence pack ------------------------------------------------------------

describe('the evidence pack', () => {
  it('exports JSON carrying the verdict and its support', () => {
    const pack = buildEvidencePack(verifyDemo(REPO_ROOT));
    expect(pack.schemaVersion).toBe('1.0.0');
    expect(pack.verdict).toBe('FAIL');
    expect(pack.requirements.length).toBeGreaterThan(0);
    expect(pack.usage.verificationModelCalls).toBe(0);
    expect(pack.limitations.join(' ')).toContain('12 synthetic cases');
    expect(JSON.parse(JSON.stringify(pack))).toBeTruthy();
  });

  it('exports Markdown that names the failed requirements', () => {
    const run = verifyDemo(REPO_ROOT);
    const markdown = renderEvidenceMarkdown(buildEvidencePack(run));
    expect(markdown).toContain('# Evidence pack');
    expect(markdown).toContain('**Verdict: FAIL**');
    for (const requirement of run.requirements.filter((entry) => entry.status === 'FAIL')) {
      expect(markdown).toContain(requirement.requirementKey);
    }
    expect(markdown).toContain('## Event timeline');
    expect(markdown).toContain('## State diff');
  });

  it('carries no credential, environment or local path', () => {
    const serialized = JSON.stringify(buildEvidencePack(verifyDemo(REPO_ROOT)));
    expect(serialized).not.toMatch(/sk-ant-/);
    expect(serialized).not.toContain('STATEPROOF_ANTHROPIC_API_KEY');
    expect(serialized).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(serialized).not.toContain('goldVerdict');
  });
});

// --- archive safety -----------------------------------------------------------

describe('archive handling', () => {
  it('rejects traversal, absolute and null-byte entry names', () => {
    for (const name of ['../escape.json', 'a/../../escape.json', '/etc/passwd', 'C:\\windows\\x', 'a\0b']) {
      expect(() => assertSafeEntryName(name), name).toThrow(ZipError);
    }
    expect(assertSafeEntryName('run/task.json')).toBe('run/task.json');
  });

  it('rejects a zip whose central directory names a traversal path', () => {
    const zip = makeZip([{ name: '../../evil.json', contents: '{}' }]);
    expect(() => readZip(zip)).toThrow(/path traversal/);
  });

  it('rejects too many entries', () => {
    const zip = makeZip(
      Array.from({ length: 8 }, (_, index) => ({ name: `f${index}.json`, contents: '{}' })),
    );
    expect(() => readZip(zip, { maxEntries: 4, maxEntryBytes: 1024, maxTotalBytes: 4096 })).toThrow(
      /entries/,
    );
  });

  it('rejects an oversized entry before decompressing it', () => {
    const zip = makeZip([{ name: 'big.json', contents: 'x'.repeat(4096) }]);
    expect(() => readZip(zip, { maxEntries: 8, maxEntryBytes: 128, maxTotalBytes: 8192 })).toThrow(
      /more than 128 bytes/,
    );
  });

  it('rejects something that is not an archive at all', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/not a ZIP archive/);
  });

  it('reads a well-formed archive, stored or deflated', () => {
    const zip = makeZip([
      { name: 'a.json', contents: '{"a":1}' },
      { name: 'b.json', contents: '{"b":2}', store: true },
    ]);
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['a.json', 'b.json']);
    expect(entries[1]?.contents.toString('utf8')).toBe('{"b":2}');
  });
});

// --- import validation --------------------------------------------------------

describe('importing a run', () => {
  it('accepts a well-formed package from individual files', () => {
    const { result } = importRun({ files: runPackageFiles() }, REPO_ROOT);
    expect(ImportResultSchema.parse(result)).toBeTruthy();
    expect(result.eventCount).toBeGreaterThan(0);
    expect(result.collections).toContain('refunds');
  });

  it('accepts the same package as a zip, including a wrapping folder', () => {
    const files = runPackageFiles();
    const zip = makeZip(
      Object.entries(files).map(([name, contents]) => ({ name: `run/${name}`, contents })),
    );
    const { result } = importRun({ zipBase64: zip.toString('base64') }, REPO_ROOT);
    expect(result.eventCount).toBeGreaterThan(0);
  });

  it('names every missing file rather than failing generically', () => {
    try {
      importRun({ files: { 'task.json': runPackageFiles()['task.json'] } }, REPO_ROOT);
      throw new Error('expected the import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      const fields = (error as ImportError).problems.map((problem) => problem.field);
      expect(fields).toContain('trajectory.jsonl');
      expect(fields).toContain('final-state.json');
    }
  });

  it('reports the line number for malformed JSONL', () => {
    const files = runPackageFiles();
    const lines = (files['trajectory.jsonl'] ?? '').split('\n');
    lines[2] = '{ this is not json';
    try {
      importRun({ files: { ...files, 'trajectory.jsonl': lines.join('\n') } }, REPO_ROOT);
      throw new Error('expected the import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      const problems = (error as ImportError).problems;
      expect(problems.some((problem) => problem.field.includes('trajectory.jsonl:3'))).toBe(true);
    }
  });

  it('rejects a collection outside the supported domain', () => {
    const files = runPackageFiles();
    const finalState = JSON.parse(files['final-state.json'] ?? '{}') as {
      collections: Record<string, unknown>;
    };
    finalState.collections['invoices'] = [];
    try {
      importRun({ files: { ...files, 'final-state.json': JSON.stringify(finalState) } }, REPO_ROOT);
      throw new Error('expected the import to fail');
    } catch (error) {
      expect((error as ImportError).problems.map((problem) => problem.message).join(' ')).toContain(
        'refund-operations domain',
      );
    }
  });

  it('rejects a tool call for a tool the registry never declared', () => {
    const files = runPackageFiles();
    const lines = (files['trajectory.jsonl'] ?? '').split('\n').filter((line) => line.trim() !== '');
    const template = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((event) => event['type'] === 'tool_call');
    expect(template).toBeDefined();
    const last = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
    const injected = JSON.stringify({
      ...template,
      eventId: 'EV-999',
      seq: lines.length + 1,
      timestamp: last['timestamp'],
      callId: 'call-999',
      toolName: 'shell.exec',
      arguments: { command: 'rm -rf /' },
    });
    try {
      importRun({ files: { ...files, 'trajectory.jsonl': [...lines, injected].join('\n') } }, REPO_ROOT);
      throw new Error('expected the import to fail');
    } catch (error) {
      expect((error as ImportError).problems.map((problem) => problem.message).join(' ')).toContain(
        'not declared in tool-registry.json',
      );
    }
  });

  it('reports out-of-order events as a field error, not a crash', () => {
    const files = runPackageFiles();
    const lines = (files['trajectory.jsonl'] ?? '').split('\n').filter((line) => line.trim() !== '');
    const template = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((event) => event['type'] === 'tool_call');
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    const injected = JSON.stringify({
      ...template,
      eventId: 'EV-998',
      seq: lines.length + 1,
      // Earlier than the event before it: a real ordering violation.
      timestamp: first['timestamp'],
    });
    try {
      importRun({ files: { ...files, 'trajectory.jsonl': [...lines, injected].join('\n') } }, REPO_ROOT);
      throw new Error('expected the import to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).problems[0]?.field).toContain('trajectory.jsonl');
    }
  });

  it('tells the user what to do next when no contract is available', () => {
    const { result } = importRun({ files: runPackageFiles() }, REPO_ROOT);
    if (result.contractStatus === 'no-contract') {
      expect(result.nextAction).toContain('compiled contract');
      expect(result.nextAction).toContain('demo');
    } else {
      expect(['compile-available', 'matched-frozen-contract']).toContain(result.contractStatus);
      expect(result.nextAction.length).toBeGreaterThan(0);
    }
  });
});

// --- the optional compile route ----------------------------------------------

describe('custom contract compilation', () => {
  it('reports availability without ever revealing a key', () => {
    const status = compileStatus();
    expect(status.credentialVariable).toBe('STATEPROOF_ANTHROPIC_API_KEY');
    expect(JSON.stringify(status)).not.toMatch(/sk-ant-/);
    if (!status.available) expect(status.reason).toContain('STATEPROOF_ANTHROPIC_API_KEY');
  });

  it('is disabled cleanly when no server key is configured', () => {
    const saved = process.env['STATEPROOF_ANTHROPIC_API_KEY'];
    delete process.env['STATEPROOF_ANTHROPIC_API_KEY'];
    try {
      const status = compileStatus();
      // The demo path must remain fully usable either way.
      expect(verifyDemo(REPO_ROOT).modelCalls).toBe(0);
      expect(typeof status.available).toBe('boolean');
    } finally {
      if (saved !== undefined) process.env['STATEPROOF_ANTHROPIC_API_KEY'] = saved;
    }
  });
});

// --- frozen-evaluation integrity ---------------------------------------------

describe('the product cannot touch the evaluation', () => {
  const files = sourceFiles(PRODUCT_SRC);

  it('never imports a gold loader', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('@stateproof/benchmark/gold');
      expect(text, file).not.toContain('loadGoldBundle');
      expect(text, file).not.toContain('goldVerdict');
      expect(text, file).not.toContain('gold-contract');
    }
  });

  it('never reads the other credential variable', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // The server may *name* the other variable in a comment; what it must
      // never do is read it.
      expect(text, file).not.toMatch(/process\.env\[?['"`]ANTHROPIC_API_KEY/);
      expect(text, file).not.toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    }
  });

  it('writes only to temporary directories', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('writeFileSync')) continue;
      // The only writer is the client build, into apps/product/dist.
      expect(file.endsWith(`build.ts`), file).toBe(true);
    }
  });

  it('leaves submitted artifacts untouched when the demo runs', () => {
    // Falls back to modification times outside a checkout: this suite also runs
    // inside an extracted release package, where there is no git to ask.
    const frozen = ['artifacts', 'submission', 'prompts', 'benchmarks'];
    const snapshot = (): string => {
      try {
        return execFileSync('git', ['status', '--porcelain', '--', ...frozen], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return frozen
          .flatMap((directory) => {
            const root = path.join(REPO_ROOT, directory);
            if (!existsSync(root)) return [];
            return sourceFiles(root).map(
              (file) => `${path.relative(REPO_ROOT, file)}:${statSync(file).mtimeMs}`,
            );
          })
          .sort()
          .join('\n');
      }
    };

    const before = snapshot();
    verifyDemo(REPO_ROOT);
    importRun({ files: runPackageFiles() }, REPO_ROOT);
    expect(snapshot()).toBe(before);
  });

  it('loads benchmark numbers through the validated final evaluation', () => {
    const view = benchmarkView(REPO_ROOT);
    expect(BenchmarkViewSchema.parse(view)).toBeTruthy();
    expect(view.generatedFrom).toBe('submission/final-evaluation.json');

    const final = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'submission', 'final-evaluation.json'), 'utf8'),
    ) as { usage: { baselineCombined: { modelCalls: number; totalTokens: number } } };
    const baselineRow = view.usage[0];
    expect(baselineRow?.modelCalls).toBe(final.usage.baselineCombined.modelCalls.toLocaleString('en-US'));
    expect(baselineRow?.totalTokens).toBe(
      final.usage.baselineCombined.totalTokens.toLocaleString('en-US'),
    );
    expect(view.scopeNote).toContain('12-case synthetic evaluation');
  });

  it('never presents a replay as a new evaluation', () => {
    const run = verifyDemo(REPO_ROOT);
    expect(run.label).toContain('Demo');
    expect(run.contract.source).toBe('frozen-bundle');
  });
});

// --- the build ----------------------------------------------------------------

describe('the submission claim language', () => {
  // The gate fixes this wording. Fixing the wording is only meaningful if the
  // numbers inside it are the measured ones, so the sentences are assembled
  // from the final evaluation and compared here against the required text.
  const REQUIRED_PRIMARY =
    "On 12 synthetic benchmark cases, StateProof matched the frontier baseline's perfect " +
    'requirement-level diagnosis while reducing first-deployment model calls by 75%, model tokens ' +
    'by 76.1%, and repeated verification to zero model calls and zero model tokens.';
  const REQUIRED_QUALIFICATION =
    'This evaluation does not establish universal generalization. It shows that StateProof ' +
    'preserved measured quality on four untouched held-out cases while making repeated ' +
    'verification deterministic, reproducible, and substantially more efficient.';
  const REQUIRED_HOT_TAKE =
    'For action-taking agents, the final answer is a claim—not evidence. ' +
    'Compile success once, then verify the state left behind.';

  it('renders the primary claim, its qualification and the hot take verbatim', () => {
    const view = BenchmarkViewSchema.parse(benchmarkView(REPO_ROOT));
    expect(view.primaryClaim).toBe(REQUIRED_PRIMARY);
    expect(view.qualification).toBe(REQUIRED_QUALIFICATION);
    expect(view.hotTake).toBe(REQUIRED_HOT_TAKE);
  });

  it('sources every figure in the claim from the final evaluation', () => {
    const view = benchmarkView(REPO_ROOT);
    const final = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'submission', 'final-evaluation.json'), 'utf8'),
    ) as {
      recomputedCombined: { stateproof: { caseCount: number } };
      efficiency: {
        firstDeploymentCallReduction: number;
        firstDeploymentTokenReduction: number;
      };
      usage: { stateproofRepeatedVerification: { modelCalls: number; totalTokens: number } };
    };

    expect(view.headline.caseCount).toBe(final.recomputedCombined.stateproof.caseCount);
    expect(view.primaryClaim).toContain(String(final.recomputedCombined.stateproof.caseCount));
    expect(view.headline.firstDeploymentCallReduction).toBe(
      `${(final.efficiency.firstDeploymentCallReduction * 100).toFixed(0)}%`,
    );
    expect(view.headline.firstDeploymentTokenReduction).toBe(
      `${(final.efficiency.firstDeploymentTokenReduction * 100).toFixed(1)}%`,
    );
    expect(view.headline.repeatedModelCalls).toBe(
      String(final.usage.stateproofRepeatedVerification.modelCalls),
    );
    expect(view.headline.repeatedModelTokens).toBe(
      String(final.usage.stateproofRepeatedVerification.totalTokens),
    );
  });

  it('never claims to be more accurate than the frontier baseline', () => {
    const view = benchmarkView(REPO_ROOT);
    const prose = `${view.primaryClaim} ${view.qualification} ${view.scopeNote} ${view.hotTake}`;
    expect(prose).not.toMatch(/more accurate|outperform|beats the (?:frontier|baseline)|better than/i);
    expect(prose).toContain('does not establish universal generalization');
  });
});

describe('the sample run package', () => {
  const samplePath = path.join(REPO_ROOT, 'samples', 'stateproof-sample-run.zip');

  it('contains the six agent-visible files and nothing else', () => {
    expect(existsSync(samplePath), 'run `pnpm sample:build`').toBe(true);
    const names = readZip(readFileSync(samplePath)).map((entry) => entry.name).sort();
    expect(names).toEqual([...REQUIRED_FILES].sort());
    for (const name of names) {
      expect(name, name).not.toMatch(/gold|metadata|verdict|split/i);
    }
  });

  it('carries no gold label, credential or local path', () => {
    const text = readZip(readFileSync(samplePath))
      .map((entry) => entry.contents)
      .join('\n');
    expect(text).not.toMatch(/goldLabel|failureMode|isolatedFailureRequirementId/);
    expect(text).not.toMatch(/sk-ant-/);
    expect(text).not.toMatch(/[A-Za-z]:\\Users\\|\/(?:home|Users)\//);
  });

  it('imports and verifies deterministically against a frozen contract', () => {
    const { result, imported } = importRun(
      { zipBase64: readFileSync(samplePath).toString('base64') },
      REPO_ROOT,
    );
    expect(result.contractStatus).toBe('matched-frozen-contract');
    expect(imported.matchedContractPath).not.toBeNull();
    // A judge who imports the sample should see a second, independent
    // verification rather than a repeat of the demo.
    expect(result.caseLabel).not.toContain(DEMO_CASE_ID);
  });
});

describe('links out of the product', () => {
  it('offers only committed, non-secret destinations', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { repository?: { url?: string } };
    const url = manifest.repository?.url;
    expect(url, 'package.json must declare the repository').toBeDefined();
    expect(url).toMatch(/^https:\/\//);
    expect(url).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
  });

  it('hosts the evidence dashboard instead of reimplementing it', () => {
    const server = readFileSync(path.join(PRODUCT_SRC, 'server', 'index.ts'), 'utf8');
    expect(server).toContain("'/dashboard/'");
    expect(server).toContain("path.join(REPO_ROOT, 'apps', 'dashboard', 'dist')");
    // Serving it must not mean copying it.
    const views = readFileSync(path.join(PRODUCT_SRC, 'client', 'views.ts'), 'utf8');
    expect(views).not.toContain('inspector.html');
  });
});

describe('the production build', () => {
  let outDir = '';

  beforeAll(async () => {
    outDir = tempDir('stateproof-product-build-');
    await buildProduct();
  });

  it('emits a shell, a bundle and a stylesheet', () => {
    const dist = path.join(REPO_ROOT, 'apps', 'product', 'dist');
    for (const file of ['index.html', 'client.js', 'styles.css']) {
      expect(existsSync(path.join(dist, file)), file).toBe(true);
    }
    void outDir;
  });

  it('inlines no script or style, so the CSP needs no exception', () => {
    const shell = readFileSync(
      path.join(REPO_ROOT, 'apps', 'product', 'dist', 'index.html'),
      'utf8',
    );
    expect(shell).not.toMatch(/<script(?![^>]*src=)/);
    expect(shell).not.toMatch(/<style/);
    expect(shell).toContain('The agent said it was done. Prove it.');
  });

  it('sets no style attribute from the client, which the CSP would drop', () => {
    // `style-src 'self'` blocks inline style attributes, including ones set
    // through setAttribute. Spacing that only exists in markup never renders,
    // and the browser fails silently — so keep every rule in the stylesheet.
    for (const file of ['views.ts', 'main.ts', 'dom.ts']) {
      const text = readFileSync(path.join(PRODUCT_SRC, 'client', file), 'utf8');
      expect(text, file).not.toMatch(/\bstyle:\s*['"`]/);
      expect(text, file).not.toMatch(/setAttribute\(\s*['"`]style['"`]/);
    }
  });

  it('carries the colophon and a self-hosted mark on every page', () => {
    const dist = path.join(REPO_ROOT, 'apps', 'product', 'dist');
    const shell = readFileSync(path.join(dist, 'index.html'), 'utf8');

    // The shell is every route, so the footer is on every route.
    expect(shell).toContain('Designed and built by <strong>Stephen Fitzgerald</strong>');
    expect(shell).toContain('micro1 Agentic Workflows Hackathon');
    for (const label of ['GitHub', 'Reproduction guide', 'Evidence dashboard', 'License']) {
      expect(shell, label).toContain(`>${label}</a>`);
    }

    // `img-src 'self' data:` means a remote mark would simply not render.
    expect(shell).toContain('src="/logo.svg"');
    expect(shell).not.toMatch(/<img[^>]+src="https?:/);
    expect(existsSync(path.join(dist, 'logo.svg')), 'the mark must ship').toBe(true);
  });

  it('ships no credential in the bundle', () => {
    const bundle = readFileSync(path.join(REPO_ROOT, 'apps', 'product', 'dist', 'client.js'), 'utf8');
    expect(bundle).not.toMatch(/sk-ant-/);
    expect(bundle).not.toContain('STATEPROOF_ANTHROPIC_API_KEY');
  });

  it('renders imported text structurally rather than as markup', () => {
    // The client builds DOM nodes; a template-literal renderer would be the
    // vector an imported agent response could exploit.
    const views = readFileSync(path.join(PRODUCT_SRC, 'client', 'views.ts'), 'utf8');
    const main = readFileSync(path.join(PRODUCT_SRC, 'client', 'main.ts'), 'utf8');
    for (const [name, text] of [['views.ts', views], ['main.ts', main]] as const) {
      expect(text, name).not.toContain('innerHTML');
      expect(text, name).not.toContain('outerHTML');
      expect(text, name).not.toContain('insertAdjacentHTML');
    }
    const dom = readFileSync(path.join(PRODUCT_SRC, 'client', 'dom.ts'), 'utf8');
    expect(dom).toContain('createTextNode');
  });
});

// --- a real case the demo depends on -----------------------------------------

describe('the demo case is the one that makes the point', () => {
  it('has an approval recorded after the protected action', () => {
    const agentVisible = loadAgentVisibleCase(DEMO_CASE_ID, { casesDir: HARD_CASES_DIR });
    const approval = agentVisible.trajectory.find((event) => event.type === 'human_approval');
    const execute = agentVisible.trajectory.find(
      (event) => event.type === 'tool_call' && event.toolName === 'refund.execute',
    );
    expect(approval).toBeDefined();
    expect(execute).toBeDefined();
    expect((approval?.seq ?? 0) > (execute?.seq ?? 0)).toBe(true);
  });

  it('fails at least three requirements', () => {
    const run = verifyDemo(REPO_ROOT);
    expect(run.requirements.filter((requirement) => requirement.status === 'FAIL').length).toBeGreaterThanOrEqual(3);
  });
});
