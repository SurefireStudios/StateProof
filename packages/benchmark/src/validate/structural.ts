import {
  type BenchmarkCase,
  CURRENT_SCHEMA_VERSION,
  REFUND_OPS_DOMAIN,
  REFUND_OPS_WRITE_EFFECTS,
  diffSnapshots,
  findTool,
  validateRefundOpsSnapshot,
} from '@stateproof/core';
import type { ValidationIssue } from './types';

function issue(caseId: string, check: string, message: string): ValidationIssue {
  return { caseId, check, severity: 'error', message };
}

/**
 * Checks that hold for every fixture regardless of its gold verdict: consistent
 * identifiers, a well-formed trajectory, a domain-valid sandbox, and gold files
 * that actually describe the same case.
 */
export function validateStructure(benchmarkCase: BenchmarkCase): ValidationIssue[] {
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

  // --- the final state must be explainable by successful writes ------------
  if (agentVisible.task.domain === REFUND_OPS_DOMAIN) {
    const successfulWriteTools = new Set<string>();
    const okResults = new Set(
      agentVisible.trajectory
        .filter((event) => event.type === 'tool_result' && event.status === 'ok')
        .map((event) => (event.type === 'tool_result' ? event.callId : '')),
    );
    for (const event of agentVisible.trajectory) {
      if (event.type !== 'tool_call') continue;
      const tool = findTool(agentVisible.toolRegistry, event.toolName);
      if (tool?.access === 'write' && okResults.has(event.callId)) {
        successfulWriteTools.add(event.toolName);
      }
    }

    const explainable = new Set<string>();
    for (const toolName of successfulWriteTools) {
      for (const collection of REFUND_OPS_WRITE_EFFECTS[toolName] ?? []) explainable.add(collection);
    }

    const changedCollections = new Set(
      diffSnapshots(agentVisible.initialState, agentVisible.finalState).map(
        (change) => change.collection,
      ),
    );
    for (const collection of [...changedCollections].sort()) {
      if (!explainable.has(collection)) {
        issues.push(
          issue(
            caseId,
            'state-derivability',
            `collection "${collection}" changed, but no successful write tool call in the trajectory can account for it`,
          ),
        );
      }
    }
    if (changedCollections.size === 0 && successfulWriteTools.size > 0) {
      issues.push(
        issue(
          caseId,
          'state-derivability',
          `successful write calls (${[...successfulWriteTools].sort().join(', ')}) left the sandbox unchanged`,
        ),
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
    const collection =
      assertion.kind === 'no_new_records' || assertion.kind === 'no_unrelated_mutations'
        ? assertion.collection
        : assertion.kind === 'event_order'
          ? null
          : assertion.selector.collection;
    if (collection !== null && !finalCollections.includes(collection)) {
      issues.push(
        issue(
          caseId,
          'assertion-target',
          `${requirement.requirementId} targets collection "${collection}", which does not exist in the sandbox state`,
        ),
      );
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

  // --- metadata hygiene -----------------------------------------------------
  if (metadata.multiFault && !metadata.approvedForUse) {
    issues.push(
      issue(
        caseId,
        'metadata',
        'multi-fault cases must be explicitly approved before they may be used',
      ),
    );
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

  return issues;
}
