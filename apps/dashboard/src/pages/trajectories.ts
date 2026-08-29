import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DashboardModel } from '../model';
import { esc, page } from '../shell';

/**
 * What each agent was actually shown, and what it actually said.
 *
 * This is the page that makes the "compiled before it saw the run" claim
 * checkable: the Contract Agent's input envelope is right here, and it contains
 * no trajectory, no state and no final response.
 */

interface Attempt {
  readonly attempt: number;
  readonly kind: string;
  readonly system: string;
  readonly messages: Array<{ role: string; content: string }>;
  readonly responseText: string;
  readonly stopReason: string | null;
  readonly usage: { inputTokens: number; outputTokens: number } | null;
  readonly validationError: string | null;
}

interface TrajectorySection {
  readonly id: string;
  readonly role: string;
  readonly promptPath: string;
  readonly promptHash: string;
  readonly runId: string;
  readonly manifestPath: string;
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly configuration: string;
  readonly rawPath: string;
  readonly attempt: Attempt | null;
  readonly parsedSummary: string | null;
}

function firstRawResponse(repoRoot: string, run: DashboardModel['cold']): string | null {
  const candidate = run.manifest.rawResponsePaths[0];
  if (candidate === undefined) return null;
  // Manifest paths are relative to the artifacts directory.
  const full = path.join(repoRoot, 'artifacts', candidate);
  return existsSync(full) ? `artifacts/${candidate}` : null;
}

function readAttempt(repoRoot: string, relativePath: string | null): Attempt | null {
  if (relativePath === null) return null;
  const full = path.join(repoRoot, relativePath);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, 'utf8')) as Attempt;
}

function sectionsFor(model: DashboardModel, repoRoot: string): TrajectorySection[] {
  const runs = [
    { run: model.coreBaseline, role: 'Baseline evaluator v1 — representative case evaluation' },
    { run: model.baseline, role: 'Baseline evaluator v2 — representative case evaluation' },
    { run: model.v1, role: 'Contract Agent v1 — representative compilation' },
    { run: model.v2, role: 'Contract Agent v2 — representative compilation' },
    { run: model.cold, role: 'Contract Agent v3 — representative compilation' },
  ];

  return runs.flatMap(({ run, role }) => {
    if (run === null) return [];
    const rawPath = firstRawResponse(repoRoot, run);
    const attempt = readAttempt(repoRoot, rawPath);
    const promptPath = run.manifest.promptFilePaths[0] ?? '';
    let parsedSummary: string | null = null;
    if (attempt !== null && attempt.validationError === null) {
      try {
        const parsed = JSON.parse(attempt.responseText.trim()) as Record<string, unknown>;
        parsedSummary = JSON.stringify(parsed, null, 2);
      } catch {
        parsedSummary = null;
      }
    }
    return [
      {
        id: run.registered.id,
        role,
        promptPath,
        promptHash: run.manifest.promptHashes[promptPath] ?? '',
        runId: run.registered.id,
        manifestPath: run.registered.manifestPath,
        provider: run.manifest.modelProvider,
        modelId: run.manifest.modelId,
        configuration: JSON.stringify(run.manifest.modelConfiguration),
        rawPath: rawPath ?? '(no raw response recorded)',
        attempt,
        parsedSummary,
      },
    ];
  });
}

function truncate(text: string, limit = 4000): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} more characters — see the raw artifact)`;
}

function renderSection(section: TrajectorySection): string {
  const attempt = section.attempt;
  const envelope = attempt?.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n') ?? '';

  return `
<section class="card">
  <h2 style="margin-bottom:2px">${esc(section.role)}</h2>
  <p class="faint small mono" style="margin:0 0 12px">${esc(section.runId)}</p>
  <dl class="kv" style="margin-bottom:14px">
    <dt>Prompt file</dt><dd><a href="../../${esc(section.promptPath)}">${esc(section.promptPath)}</a></dd>
    <dt>Prompt sha256</dt><dd>${esc(section.promptHash)}</dd>
    <dt>Provider / model</dt><dd>${esc(section.provider ?? 'none')} / ${esc(section.modelId ?? 'none')}</dd>
    <dt>Model configuration</dt><dd>${esc(section.configuration)}</dd>
    <dt>Raw response</dt><dd><a href="../../${esc(section.rawPath)}">${esc(section.rawPath)}</a></dd>
    <dt>Run manifest</dt><dd><a href="../../${esc(section.manifestPath)}">${esc(section.manifestPath)}</a></dd>
    <dt>Attempts</dt><dd>${attempt === null ? '—' : `${esc(String(attempt.attempt))} (${esc(attempt.kind)})`}</dd>
    <dt>Validation</dt><dd>${
      attempt === null
        ? '—'
        : attempt.validationError === null
          ? '<span class="v-pass">accepted on this attempt</span>'
          : `<span class="v-fail">rejected</span>: ${esc(attempt.validationError)}`
    }</dd>
    <dt>Token usage</dt><dd>${
      attempt?.usage === null || attempt === null
        ? '—'
        : `${esc(String(attempt.usage.inputTokens))} in / ${esc(String(attempt.usage.outputTokens))} out`
    }</dd>
  </dl>
  ${
    attempt === null
      ? '<p class="muted small">No raw response artifact is recorded for this run.</p>'
      : `
  <details>
    <summary class="small">System instructions</summary>
    <pre>${esc(truncate(attempt.system))}</pre>
  </details>
  <details>
    <summary class="small">Input envelope (exactly what the model was sent)</summary>
    <pre>${esc(truncate(envelope))}</pre>
  </details>
  <details>
    <summary class="small">Raw response</summary>
    <pre>${esc(truncate(attempt.responseText))}</pre>
  </details>
  ${
    section.parsedSummary === null
      ? ''
      : `<details>
    <summary class="small">Parsed and validated output</summary>
    <pre>${esc(truncate(section.parsedSummary))}</pre>
  </details>`
  }`
  }
</section>`;
}

export function renderTrajectories(model: DashboardModel, repoRoot: string): string {
  const sections = sectionsFor(model, repoRoot);
  const repairRuns = model.view.runs.filter((run) => run.repairCalls > 0);

  const body = `
<section>
  <p class="muted">Five model-driven roles were used across the whole project, and every one of
  them is here with its prompt, its input envelope, its raw response and its validation result.
  Credentials appear nowhere: the model client reads the key from the environment and it never
  enters a prompt, an artifact or a manifest.</p>
  <div class="callout">
    <p style="margin:0"><strong>Check the Contract Agent envelopes.</strong> They contain the task,
    the tool definitions and the domain schema — and no trajectory, no state, no final response and
    no case id. That restriction is what makes a compiled contract a contract rather than a
    description of what happened.</p>
  </div>
</section>

${sections.map(renderSection).join('')}

<section class="card">
  <h2>Deterministic verification — code, not an agent</h2>
  <p class="small muted">The step that produces every verdict has no model in it. It evaluates the
  compiled contract's assertions against the trajectory and both state snapshots, and builds each
  evidence reference from the records and events those assertions matched.</p>
  <dl class="kv">
    <dt>Model calls during verification</dt><dd>0</dd>
    <dt>Warm run model calls</dt><dd>${esc(String(model.warm.modelCalls))}</dd>
    <dt>Warm run tokens</dt><dd>${esc(String(model.warm.totalTokens))}</dd>
    <dt>Deterministic verification time</dt><dd>${esc(String(model.warm.verificationWallMs ?? '—'))} ms</dd>
    <dt>Repeat determinism</dt><dd>${esc(String(1 + model.warmRepeats.length))} runs, identical canonical predictions</dd>
    <dt>Implementation</dt><dd>packages/core/src/verify/assertions.ts, packages/agents/src/verify/executor.ts</dd>
  </dl>
  <p class="small faint" style="margin-bottom:0">Repair retries observed across all runs:
  ${repairRuns.length === 0 ? 'none' : esc(repairRuns.map((run) => `${run.registered.label} (${run.repairCalls})`).join(', '))}.</p>
</section>
`;

  return page({
    title: 'Agent trajectories',
    active: 'trajectories.html',
    subtitle: 'Every model call this project made, with its inputs and its raw output.',
    body,
  });
}
