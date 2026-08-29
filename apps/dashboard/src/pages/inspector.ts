import type { JsonValue, TraceEvent } from '@stateproof/core';
import type { CaseView, DashboardModel } from '../model';
import { evidenceTargets } from '../model';
import { esc, integer, page, verdictClass } from '../shell';

/**
 * One page per case, rather than one page plus a fetch.
 *
 * Generated pages open straight from disk. A judge who unzips the submission and
 * double-clicks `inspector.html` gets a working inspector with no server, which
 * a `fetch`-based case switcher would not survive.
 */

function eventDetail(event: TraceEvent): string {
  switch (event.type) {
    case 'tool_call':
      return `${event.toolName}(${JSON.stringify(event.arguments)})`;
    case 'tool_result':
      return `${event.toolName} → ${event.status}${
        event.status === 'error' ? `: ${JSON.stringify(event.result)}` : ''
      }`;
    case 'human_approval':
      return `scope=${event.scope} decision=${event.decision} approver=${event.approver}`;
    case 'agent_message':
      return `${event.role}: ${event.content}`;
  }
}

function eventClass(event: TraceEvent): string {
  if (event.type === 'human_approval') return 'is-approval';
  if (event.type === 'tool_result' && event.status === 'error') return 'is-error';
  if (event.type === 'tool_call') return 'is-write';
  return '';
}

function renderTimeline(caseView: CaseView): string {
  const rows = caseView.trajectory
    .map(
      (event) => `
      <li class="event ${eventClass(event)}" id="ev-${esc(event.eventId)}">
        <span class="seq">#${esc(String(event.seq))}</span>
        <span class="kind">${esc(event.type)}<br><span class="faint">${esc(event.eventId)}</span></span>
        <span class="detail">${esc(eventDetail(event))}</span>
      </li>`,
    )
    .join('');
  return `<ol class="timeline card" id="timeline" style="padding:0">${rows}</ol>`;
}

function renderValue(value: JsonValue | undefined): string {
  if (value === undefined) return '<absent>';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderDiff(caseView: CaseView): string {
  // Every collection gets a section, including the untouched ones. "Nothing
  // changed in refunds" is the evidence a scope or prohibition requirement
  // cites, so an evidence link naming it has to land somewhere real.
  const byCollection = new Map<string, typeof caseView.diff>();
  for (const collection of Object.keys(caseView.agentVisible.finalState.collections).sort()) {
    byCollection.set(collection, []);
  }
  for (const change of caseView.diff) {
    byCollection.set(change.collection, [...(byCollection.get(change.collection) ?? []), change]);
  }

  return [...byCollection.entries()]
    .map(([collection, changes]) => {
      const rows = changes
        .map((change) => {
          const fields = change.changedFields
            .map(
              (field) => `
            <div class="field-change">
              <span class="faint">${esc(field)}</span>
              <span class="was">${esc(renderValue(change.before?.[field]))}</span>
              <span class="now">${esc(renderValue(change.after?.[field]))}</span>
            </div>`,
            )
            .join('');
          return `
          <div class="diff-row" id="rec-final-${esc(collection)}-${esc(change.recordId)}">
            <div class="diff-head">
              <span class="tag ${esc(change.kind)}">${esc(change.kind)}</span>
              <span>${esc(change.recordId)}</span>
              <span class="faint">${esc(String(change.changedFields.length))} field(s)</span>
            </div>
            ${fields}
          </div>`;
        })
        .join('');
      return `
      <div class="card" id="diff-${esc(collection)}" style="padding:0; margin-bottom:12px">
        <div style="padding:12px 14px; ${changes.length === 0 ? '' : 'border-bottom:1px solid var(--line)'}">
          <strong class="mono">${esc(collection)}</strong>
          <span class="faint small"> — ${
            changes.length === 0
              ? 'unchanged between the initial and final snapshots'
              : `${esc(String(changes.length))} changed record(s)`
          }</span>
        </div>
        ${rows}
      </div>`;
    })
    .join('');
}

function renderRequirements(caseView: CaseView): string {
  return caseView.requirements
    .map((requirement) => {
      const refs = requirement.evidenceRefs
        .map((ref) => {
          const targets = evidenceTargets(ref);
          return `<li><a class="ev-link" href="#${esc(targets[0] ?? '')}"
            data-evidence-target="${esc(targets.join(' '))}"
            data-missing="${targets.length === 0 ? 'true' : 'false'}">${esc(ref)}</a></li>`;
        })
        .join('');
      return `
      <article class="req">
        <div class="req-head">
          <span class="pill ${verdictClass(requirement.status)}">${esc(requirement.status)}</span>
          <span class="req-key">${esc(requirement.requirementKey)}</span>
        </div>
        <div class="req-body">
          ${requirement.description === '' ? '' : `<p class="small" style="margin:0 0 8px">${esc(requirement.description)}</p>`}
          <p class="req-reason mono">${esc(requirement.reason)}</p>
          <details class="evidence">
            <summary>${esc(String(requirement.evidenceRefs.length))} evidence reference(s)</summary>
            <ul class="ev-list">${refs}</ul>
          </details>
        </div>
      </article>`;
    })
    .join('');
}

function renderStateRecords(caseView: CaseView): string {
  const snapshot = caseView.agentVisible.finalState;
  return Object.entries(snapshot.collections)
    .map(([collection, records]) => {
      const rows = records
        .map(
          (record) => `
        <tr id="rec-final-${esc(collection)}-${esc(record.id)}">
          <td class="mono">${esc(record.id)}</td>
          <td class="mono small">${esc(JSON.stringify(record.fields))}</td>
        </tr>`,
        )
        .join('');
      return `
      <details class="card" style="margin-bottom:10px">
        <summary class="mono">${esc(collection)} <span class="faint">(${esc(String(records.length))})</span></summary>
        <div class="table-wrap" style="margin-top:10px">
          <table><thead><tr><th>Record</th><th>Fields (final state)</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </details>`;
    })
    .join('');
}

function renderComparison(model: DashboardModel, caseView: CaseView): string {
  const stateproof = caseView.stateproofScored;
  const baseline = caseView.baseline;
  const list = (keys: string[]): string =>
    keys.length === 0 ? '<span class="faint">—</span>' : `<span class="mono small">${esc(keys.join(', '))}</span>`;

  return `
  <div class="table-wrap">
    <table>
      <thead><tr><th>System</th><th>Verdict</th><th>Gold</th><th>Correct</th><th>Failures reported</th><th>Missed</th><th>False failures</th><th class="num">Model calls</th><th class="num">Tokens</th></tr></thead>
      <tbody>
        <tr>
          <td>Frontier baseline<br><span class="faint small">${esc(model.baseline.registered.id)}</span></td>
          <td>${baseline === null ? '—' : `<span class="pill ${verdictClass(baseline.verdict)}">${esc(baseline.verdict)}</span>`}</td>
          <td>${baseline === null ? '—' : `<span class="mono">${esc(baseline.goldVerdict)}</span>`}</td>
          <td>${baseline === null ? '—' : baseline.correct ? 'yes' : 'no'}</td>
          <td>${baseline === null ? '—' : list(baseline.predictedFailedKeys)}</td>
          <td>${baseline === null ? '—' : list(baseline.missedKeys)}</td>
          <td>${baseline === null ? '—' : list(baseline.falselyFailedKeys)}</td>
          <td class="num">${esc(integer(model.baseline.modelCalls))}</td>
          <td class="num">${esc(integer(model.baseline.totalTokens))}</td>
        </tr>
        <tr class="row-highlight">
          <td>StateProof v3<br><span class="faint small">${esc(model.cold.registered.id)}</span></td>
          <td><span class="pill ${verdictClass(caseView.verdict)}">${esc(caseView.verdict)}</span></td>
          <td>${stateproof === null ? '—' : `<span class="mono">${esc(stateproof.goldVerdict)}</span>`}</td>
          <td>${stateproof === null ? '—' : stateproof.correct ? 'yes' : 'no'}</td>
          <td>${stateproof === null ? '—' : list(stateproof.predictedFailedKeys)}</td>
          <td>${stateproof === null ? '—' : list(stateproof.missedKeys)}</td>
          <td>${stateproof === null ? '—' : list(stateproof.falselyFailedKeys)}</td>
          <td class="num">${esc(integer(model.cold.modelCalls))}</td>
          <td class="num">${esc(integer(model.cold.totalTokens))}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="faint small">Whole-suite model usage for eight cases; StateProof compiles three
  contracts and reuses them. Gold columns come from the completed report artifacts, never from a
  gold file read at render time.</p>`;
}

export function inspectorFileName(caseId: string, defaultCaseId: string): string {
  return caseId === defaultCaseId ? 'inspector.html' : `inspector-${caseId}.html`;
}

export function renderInspector(model: DashboardModel, caseView: CaseView): string {
  const chips = model.cases
    .map(
      (entry) =>
        `<a class="case-chip${entry.caseId === caseView.caseId ? ' is-active' : ''}"
           href="${esc(inspectorFileName(entry.caseId, model.defaultCaseId))}">${esc(entry.caseId)}
           <span class="faint">${esc(entry.verdict)}</span></a>`,
    )
    .join('');

  const body = `
<div class="case-switch">${chips}</div>

<section class="grid grid-2">
  <div class="card">
    <h3>Original task</h3>
    <p style="margin:0">${esc(caseView.task)}</p>
  </div>
  <div>
    <h3 class="faint small" style="text-transform:uppercase; letter-spacing:.06em">The agent's claim</h3>
    <div class="claim">${esc(caseView.finalResponse)}</div>
    <p class="faint small" style="margin-top:8px">This is the artefact a human would normally read.
    Nothing below is derived from it.</p>
  </div>
</section>

<section>
  <h2>StateProof verdict
    <span class="pill solid ${verdictClass(caseView.verdict)}" style="margin-left:8px">${esc(caseView.verdict)}</span>
  </h2>
  ${renderRequirements(caseView)}
</section>

<section>
  <h2>Event timeline</h2>
  <p class="muted small">Approvals are highlighted amber, writes blue, errors red. Ordering is by
  <code>seq</code>, never by timestamp.</p>
  ${renderTimeline(caseView)}
</section>

<section>
  <h2>Initial → final state diff</h2>
  ${renderDiff(caseView)}
</section>

<section>
  <h2>Final state records</h2>
  <p class="muted small">Expand a collection to reach the exact record an evidence link cites.</p>
  ${renderStateRecords(caseView)}
</section>

<section>
  <h2>Contract provenance</h2>
  <dl class="kv card">
    <dt>Task fingerprint</dt><dd>${esc(caseView.contract.taskFingerprint)}</dd>
    <dt>Contract hash</dt><dd>${esc(caseView.contract.contractHash)}</dd>
    <dt>Prompt</dt><dd>${esc(caseView.contract.promptPath)}</dd>
    <dt>Prompt sha256</dt><dd>${esc(caseView.contract.promptHash)}</dd>
    <dt>Assertion schema</dt><dd>${esc(caseView.contract.assertionSchemaVersion)}</dd>
    <dt>Cold run</dt><dd>${caseView.contract.coldCacheHit ? 'reused a contract compiled earlier in the run' : 'compiled the contract for this task'}</dd>
    <dt>Warm run</dt><dd>${caseView.contract.warmCacheHit ? 'loaded from the persisted bundle — no model call' : 'not served from cache'}</dd>
  </dl>
</section>

<section>
  <h2>Baseline versus StateProof</h2>
  ${renderComparison(model, caseView)}
</section>
`;

  return page({
    title: `Run Inspector · ${caseView.caseId}`,
    active: 'inspector.html',
    subtitle: 'The final response is a claim. Everything below is evidence.',
    body,
  });
}
