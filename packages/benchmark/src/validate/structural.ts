import {
  type BenchmarkCase,
  CURRENT_SCHEMA_VERSION,
  REFUND_OPS_DOMAIN,
  findTool,
  validateRefundOpsReferences,
  validateRefundOpsSnapshot,
  verifyFinalStateDerivable,
} from '@stateproof/core';
import { type ApprovedCase, approvedCase } from './approved-cases';
import type { ValidationIssue } from './types';

function issue(caseId: string, check: string, message: string): ValidationIssue {
  return { caseId, check, severity: 'error', message };
}

/**
 * Checks that hold for every fixture regardless of its gold verdict: consistent
 * identifiers, a well-formed trajectory, a domain-valid sandbox, and gold files
 * that actually describe the same case.
 */
export function validateStructure(
  benchmarkCase: BenchmarkCase,
  /** Registry lookup, so a second dataset checks against its own matrix. */
  lookupApproved: (caseId: string) => ApprovedCase | undefined = approvedCase,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { caseId, agentVisible, goldContract, goldVerdict, metadata } = benchmarkCase;

  // --- schema version -------------------------------------------------------
  const versioned: Array<[string, string]> = [
    ['task.json', agentVisible.task.schemaVersion],
    ['tool-registry.json', agentVisible.toolRegistry.schemaVersion],
    ['initial-state.json', agentVisible.initialState.schemaVersion],
    ['final-state.json', agentVisible.finalState.schemaVersion],
    ['gold-contract.json', goldContract.schemaVersion],
    ['gold-verdict.json', goldVerdict.schemaVersion],
    ['case-metadata.json', metadata.schemaVersion],
  ];
  for (const [fileName, version] of versioned) {
    if (version !== CURRENT_SCHEMA_VERSION) {
      issues.push(
        issue(
          caseId,
          'schema-version',
          `${fileName} declares schemaVersion ${version}, expected ${CURRENT_SCHEMA_VERSION}`,
        ),
      );
    }
  }

  // --- identifier consistency ----------------------------------------------
  if (metadata.caseId !== caseId) {
    issues.push(issue(caseId, 'case-id', `case-metadata.json declares caseId ${metadata.caseId}`));
  }
  if (goldVerdict.caseId !== caseId) {
    issues.push(issue(caseId, 'case-id', `gold-verdict.json declares caseId ${goldVerdict.caseId}`));
  }
  if (goldContract.caseId !== undefined && goldContract.caseId !== caseId) {
    issues.push(
      issue(caseId, 'case-id', `gold-contract.json declares caseId ${goldContract.caseId}`),
    );
  }
  if (goldContract.taskId !== agentVisible.task.taskId) {
    issues.push(
      issue(
        caseId,
        'task-id',
        `gold contract targets taskId ${goldContract.taskId} but the task is ${agentVisible.task.taskId}`,
      ),
    );
  }

  // --- snapshots ------------------------------------------------------------
  if (agentVisible.initialState.label !== 'initial') {
    issues.push(issue(caseId, 'snapshot-label', 'initial-state.json is not labelled "initial"'));
  }
  if (agentVisible.finalState.label !== 'final') {
    issues.push(issue(caseId, 'snapshot-label', 'final-state.json is not labelled "final"'));
  }
  if (agentVisible.finalState.capturedAt < agentVisible.initialState.capturedAt) {
    issues.push(
      issue(caseId, 'snapshot-order', 'final state was captured before the initial state'),
    );
  }
  const initialCollections = Object.keys(agentVisible.initialState.collections).sort();
  const finalCollections = Object.keys(agentVisible.finalState.collections).sort();
  if (initialCollections.join(',') !== finalCollections.join(',')) {
    issues.push(
      issue(
        caseId,
        'snapshot-shape',
        `collections differ between snapshots: initial [${initialCollections.join(', ')}] vs final [${finalCollections.join(', ')}]`,
      ),
    );
  }

  if (agentVisible.task.domain === REFUND_OPS_DOMAIN) {
    for (const [label, snapshot] of [
      ['initial-state.json', agentVisible.initialState],
      ['final-state.json', agentVisible.finalState],
    ] as const) {
      for (const domainIssue of validateRefundOpsSnapshot(snapshot)) {
        issues.push(
          issue(
            caseId,
            'domain-schema',
            `${label} ${domainIssue.collection}/${domainIssue.recordId}: ${domainIssue.message}`,
          ),
        );
      }
      // Records must also agree with each other, not merely be well shaped.
      for (const referenceIssue of validateRefundOpsReferences(snapshot)) {
        issues.push(
          issue(
            caseId,
            'referential-integrity',
            `${label} ${referenceIssue.collection}/${referenceIssue.recordId}: ${referenceIssue.message}`,
          ),
        );
      }
    }
  }

  // --- trajectory -----------------------------------------------------------
  const openCalls = new Map<string, string>();
  const resolvedCalls = new Set<string>();
  for (const event of agentVisible.trajectory) {
    if (event.type === 'tool_call') {
      if (findTool(agentVisible.toolRegistry, event.toolName) === undefined) {
        issues.push(
          issue(
            caseId,
            'trajectory-tool',
            `seq ${event.seq} calls "${event.toolName}", which is not in the tool registry`,
          ),
        );
      }
      if (openCalls.has(event.callId)) {
        issues.push(
          issue(caseId, 'trajectory-callid', `seq ${event.seq} reuses callId "${event.callId}"`),
        );
      }
      openCalls.set(event.callId, event.toolName);
    }
    if (event.type === 'tool_result') {
      const calledTool = openCalls.get(event.callId);
      if (calledTool === undefined) {
        issues.push(
          issue(
            caseId,
            'trajectory-callid',
            `seq ${event.seq} returns a result for unknown callId "${event.callId}"`,
          ),
        );
      } else if (calledTool !== event.toolName) {
        issues.push(
          issue(
            caseId,
            'trajectory-callid',
            `seq ${event.seq} returns "${event.toolName}" for callId "${event.callId}", which called "${calledTool}"`,
          ),
        );
      } else if (resolvedCalls.has(event.callId)) {
        issues.push(
          issue(
            caseId,
            'trajectory-callid',
            `callId "${event.callId}" has more than one result`,
          ),
        );
      }
      resolvedCalls.add(event.callId);
    }
  }
  for (const [callId, toolName] of openCalls) {
    if (!resolvedCalls.has(callId)) {
      issues.push(
        issue(caseId, 'trajectory-callid', `call "${toolName}" (${callId}) has no result event`),
      );
    }
  }

  // --- the final state must be derivable from the successful writes --------
  // Read-only calls and failed calls must leave the sandbox untouched, and
  // every successful write must produce its declared effect. Replaying is a
  // stronger claim than "something changed somewhere".
  {
    const replay = verifyFinalStateDerivable(
      agentVisible.initialState,
      agentVisible.finalState,
      agentVisible.trajectory,
      agentVisible.toolRegistry,
    );
    for (const replayIssue of replay.issues) {
      const where = replayIssue.seq === null ? '' : ` (seq ${replayIssue.seq})`;
      issues.push(
        issue(caseId, 'state-derivability', `${replayIssue.kind}${where}: ${replayIssue.message}`),
      );
    }
  }

  // --- gold files describe this case ---------------------------------------
  const requirementIds = goldContract.requirements.map((requirement) => requirement.requirementId);
  const expectationIds = goldVerdict.requirementExpectations.map(
    (expectation) => expectation.requirementId,
  );
  for (const requirementId of requirementIds) {
    if (!expectationIds.includes(requirementId)) {
      issues.push(
        issue(caseId, 'gold-coverage', `gold verdict has no expectation for ${requirementId}`),
      );
    }
  }
  for (const expectationId of expectationIds) {
    if (!requirementIds.includes(expectationId)) {
      issues.push(
        issue(
          caseId,
          'gold-coverage',
          `gold verdict expects ${expectationId}, which is not in the gold contract`,
        ),
      );
    }
  }

  // --- assertions point at collections that exist --------------------------
  for (const requirement of goldContract.requirements) {
    for (const assertion of requirement.assertions) {
    const collections: string[] =
      assertion.kind === 'no_new_records' ||
      assertion.kind === 'no_unrelated_mutations' ||
      assertion.kind === 'mutations_limited_to'
        ? [assertion.collection]
        : assertion.kind === 'event_order'
          ? []
          : assertion.kind === 'record_field_equals_selected_record_id'
            ? [assertion.leftSelector.collection, assertion.rightSelector.collection]
            : [assertion.selector.collection];
    for (const collection of collections) {
      if (!finalCollections.includes(collection)) {
        issues.push(
          issue(
            caseId,
            'assertion-target',
            `${requirement.requirementId} targets collection "${collection}", which does not exist in the sandbox state`,
          ),
        );
      }
    }
    if (assertion.kind === 'event_order') {
      for (const selector of [assertion.earlier, assertion.later]) {
        if (
          selector.toolName !== undefined &&
          findTool(agentVisible.toolRegistry, selector.toolName) === undefined
        ) {
          issues.push(
            issue(
              caseId,
              'assertion-target',
              `${requirement.requirementId} references tool "${selector.toolName}", which is not in the tool registry`,
            ),
          );
        }
      }
    }
    }
  }

  // --- gold expectation ids are unique -------------------------------------
  {
    const seen = new Set<string>();
    for (const expectationId of expectationIds) {
      if (seen.has(expectationId)) {
        issues.push(
          issue(caseId, 'gold-coverage', `gold verdict repeats expectation ${expectationId}`),
        );
      }
      seen.add(expectationId);
    }
  }

  // --- metadata hygiene -----------------------------------------------------
  if (!metadata.approvedForUse) {
    issues.push(
      issue(caseId, 'metadata', 'every core case must carry approvedForUse: true'),
    );
  }
  if (metadata.multiFault && !metadata.approvedForUse) {
    issues.push(
      issue(
        caseId,
        'metadata',
        'multi-fault cases must be explicitly approved before they may be used',
      ),
    );
  }
  if (metadata.goldLabel === 'valid') {
    const populated = [
      ['failureMode', metadata.failureMode],
      ['failureDescription', metadata.failureDescription],
      ['isolatedFailureRequirementId', metadata.isolatedFailureRequirementId],
    ].filter(([, value]) => value !== null);
    for (const [field] of populated) {
      issues.push(
        issue(caseId, 'metadata', `valid cases must leave ${String(field)} null`),
      );
    }
  }
  if (
    metadata.isolatedFailureRequirementId !== null &&
    !requirementIds.includes(metadata.isolatedFailureRequirementId)
  ) {
    issues.push(
      issue(
        caseId,
        'metadata',
        `isolatedFailureRequirementId ${metadata.isolatedFailureRequirementId} is not a requirement of the gold contract`,
      ),
    );
  }

  // --- the case must match the approved canonical matrix -------------------
  const approved = lookupApproved(caseId);
  if (approved === undefined) {
    issues.push(
      issue(
        caseId,
        'approved-case',
        'case is not in the approved matrix for its dataset; unapproved cases are not permitted',
      ),
    );
  } else {
    if (approved.split !== metadata.split) {
      issues.push(
        issue(
          caseId,
          'approved-case',
          `matrix places this case in the ${approved.split} split but its metadata says ${metadata.split}`,
        ),
      );
    }
    if (approved.goldVerdict !== goldVerdict.overall) {
      issues.push(
        issue(
          caseId,
          'approved-case',
          `matrix gold verdict is ${approved.goldVerdict} but gold-verdict.json says ${goldVerdict.overall}`,
        ),
      );
    }
    if (
      !metadata.multiFault &&
      approved.isolatedFailureRequirementId !== metadata.isolatedFailureRequirementId
    ) {
      issues.push(
        issue(
          caseId,
          'approved-case',
          `matrix isolated failure is ${String(approved.isolatedFailureRequirementId)} but metadata says ${String(metadata.isolatedFailureRequirementId)}`,
        ),
      );
    }
  }

  return issues;
}
