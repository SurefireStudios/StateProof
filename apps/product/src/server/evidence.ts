import type { RunView } from '../shared/types';

/**
 * The evidence pack: what you hand to someone who was not watching.
 *
 * It carries the verdict *and* everything needed to disagree with it — the
 * task, the agent's own claim, every requirement with its deterministic reason,
 * the events and record changes involved, and the contract's identity. It
 * deliberately carries no credential, no environment, no gold label and no
 * local path, because an evidence pack is meant to be forwarded.
 */

export interface EvidencePack {
  readonly schemaVersion: '1.0.0';
  readonly generatedAt: string;
  readonly run: {
    readonly runId: string;
    readonly label: string;
    readonly caseId: string | null;
    readonly verifiedAt: string;
    readonly mode: RunView['mode'];
    readonly imported: boolean;
  };
  readonly task: string;
  readonly agentClaim: string;
  readonly verdict: RunView['verdict'];
  readonly requirements: RunView['requirements'];
  readonly events: RunView['timeline'];
  readonly stateDiff: RunView['diff'];
  readonly contract: RunView['contract'];
  readonly usage: {
    readonly verificationModelCalls: 0;
    readonly compilationModelCalls: number;
    readonly compilationModelTokens: number;
    readonly verificationDurationMs: number;
  };
  readonly limitations: readonly string[];
}

export const EVIDENCE_LIMITATIONS: readonly string[] = [
  'Verification is deterministic and covers exactly what the compiled contract asserts.',
  'A requirement marked NEEDS_REVIEW means the evidence could not resolve, not that the run passed.',
  'The refund-operations domain is the only domain this product has been validated on.',
  'Benchmark results referenced elsewhere in the product come from 12 synthetic cases and do not establish generalization.',
];

export function buildEvidencePack(run: RunView): EvidencePack {
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    run: {
      runId: run.runId,
      label: run.label,
      caseId: run.caseId,
      verifiedAt: run.verifiedAt,
      mode: run.mode,
      imported: run.imported,
    },
    task: run.task,
    agentClaim: run.agentClaim,
    verdict: run.verdict,
    requirements: run.requirements,
    // Only the events and changes the verdict actually rests on, plus enough
    // context to read them.
    events: run.timeline,
    stateDiff: run.diff,
    contract: run.contract,
    usage: {
      verificationModelCalls: 0,
      compilationModelCalls: run.modelCalls,
      compilationModelTokens: run.modelTokens,
      verificationDurationMs: run.verificationDurationMs,
    },
    limitations: EVIDENCE_LIMITATIONS,
  };
}

function statusMark(status: RunView['verdict']): string {
  if (status === 'PASS') return 'PASS';
  if (status === 'FAIL') return 'FAIL';
  return 'NEEDS REVIEW';
}

export function renderEvidenceMarkdown(pack: EvidencePack): string {
  const lines: string[] = [
    `# Evidence pack — ${pack.run.label}`,
    '',
    `**Verdict: ${statusMark(pack.verdict)}**`,
    '',
    `- Run: \`${pack.run.runId}\``,
    `- Verified: ${pack.run.verifiedAt}`,
    `- Mode: ${pack.run.mode === 'deterministic' ? 'deterministic verification, zero model calls' : 'deterministic verification after a model-assisted contract compilation'}`,
    `- Verification time: ${pack.usage.verificationDurationMs} ms`,
    `- Model calls during verification: ${pack.usage.verificationModelCalls}`,
    '',
    '## Task',
    '',
    pack.task,
    '',
    "## The agent's claim",
    '',
    '> ' + pack.agentClaim.split('\n').join('\n> '),
    '',
    'This is the artefact a human would normally read. Nothing below is derived from it.',
    '',
    '## Requirements',
    '',
  ];

  for (const requirement of pack.requirements) {
    lines.push(`### ${statusMark(requirement.status)} — \`${requirement.requirementKey}\``);
    lines.push('');
    if (requirement.description !== '') lines.push(requirement.description, '');
    lines.push(`*Category:* ${requirement.category} · *Coverage:* ${requirement.verificationCoverage}`);
    lines.push('');
    lines.push(`**Deterministic reason.** ${requirement.reason}`);
    lines.push('');
    if (requirement.limitations.length > 0) {
      lines.push('**Declared limitations:**');
      for (const limitation of requirement.limitations) lines.push(`- ${limitation}`);
      lines.push('');
    }
    if (requirement.evidence.length > 0) {
      lines.push('**Evidence:**');
      for (const reference of requirement.evidence) lines.push(`- \`${reference.ref}\``);
      lines.push('');
    }
  }

  lines.push('## Event timeline', '');
  lines.push('| # | Event | Type | Detail | Cited |', '| --- | --- | --- | --- | --- |');
  for (const event of pack.events) {
    lines.push(
      `| ${event.seq} | \`${event.eventId}\` | ${event.type} | ${event.summary.replace(/\|/g, '\\|')} | ${event.cited ? 'yes' : ''} |`,
    );
  }
  lines.push('');

  lines.push('## State diff', '');
  for (const collection of pack.stateDiff) {
    if (collection.changes.length === 0) {
      lines.push(`- \`${collection.collection}\`: unchanged`);
      continue;
    }
    lines.push(`### \`${collection.collection}\``, '');
    for (const change of collection.changes) {
      lines.push(`**${change.kind}** \`${change.recordId}\``, '');
      lines.push('| Field | Before | After |', '| --- | --- | --- |');
      for (const field of change.changedFields) {
        lines.push(
          `| ${field.field} | ${field.before.replace(/\|/g, '\\|')} | ${field.after.replace(/\|/g, '\\|')} |`,
        );
      }
      lines.push('');
    }
  }

  lines.push(
    '## Contract',
    '',
    `- Summary: ${pack.contract.taskSummary}`,
    `- Contract hash: \`${pack.contract.contractHash}\``,
    `- Task fingerprint: \`${pack.contract.taskFingerprint}\``,
    `- Compiled by: ${pack.contract.promptPath} (sha256 \`${pack.contract.promptHash.slice(0, 16)}\`)`,
    `- Assertion schema: ${pack.contract.assertionSchemaVersion}`,
    `- Source: ${pack.contract.source}`,
    '',
  );

  if (pack.contract.ambiguities.length > 0) {
    lines.push('**Ambiguities the contract declared:**', '');
    for (const ambiguity of pack.contract.ambiguities) lines.push(`- ${ambiguity}`);
    lines.push('');
  }

  lines.push('## Limitations', '');
  for (const limitation of pack.limitations) lines.push(`- ${limitation}`);
  lines.push('');

  return lines.join('\n');
}
