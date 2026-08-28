/**
 * Human-only surface of `@stateproof/benchmark`, reachable only as
 * `@stateproof/benchmark/gold`.
 *
 * Importing this module is a deliberate act. Nothing that builds a model
 * prompt may do it; the scoring layer and fixture validation may.
 */

export { createGoldReader } from './fs-guard';
export {
  datasetHash,
  loadAllCases,
  loadBenchmarkCase,
  loadGoldBundle,
  type GoldBundle,
  type GoldLoadOptions,
} from './load-gold';
