/**
 * Compatibility surface. Agent-facing code must import from
 * `./load-agent-input` directly so it cannot reach gold data even by accident.
 */
export * from './load-agent-input';
export * from './load-gold';
