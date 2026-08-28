/**
 * Agent-facing surface of `@stateproof/benchmark`.
 *
 * This entry point deliberately exports no way to reach gold data. Anything
 * that will eventually build a model prompt imports from here, so the
 * isolation is a property of the module graph rather than a convention:
 * `createGoldReader`, `loadGoldBundle`, `loadBenchmarkCase`, `loadAllCases`
 * and `datasetHash` live behind `@stateproof/benchmark/gold`, and the
 * validator lives behind `@stateproof/benchmark/validate`.
 */

export {
  BENCHMARK_NAME,
  BENCHMARK_ROOT,
  CASES_DIR,
  CORE_DATASET,
  HARD_BENCHMARK_NAME,
  HARD_CASES_DIR,
  HARD_DATASET,
  HARD_SPLITS_DIR,
  REPO_ROOT,
  SPLITS_DIR,
  type DatasetPaths,
  caseDirFor,
  datasetPaths,
  listCaseIds,
} from './paths';

export {
  AGENT_VISIBLE_FILES,
  HUMAN_ONLY_FILES,
  GoldDataAccessError,
  createAgentInputReader,
  onCaseFileRead,
  type AgentVisibleFile,
  type CaseFileReadListener,
  type CaseFileReader,
  type HumanOnlyFile,
} from './fs-guard';

export { caseIdsForSplit, loadSplitManifest } from './splits';

export {
  FixtureParseError,
  hashAgentVisibleCase,
  listAgentVisibleCaseIds,
  loadAgentVisibleCase,
  loadAgentVisibleCases,
  parseOrThrow,
  parseTrajectoryJsonl,
  type AgentInputLoadOptions,
} from './load-agent-input';
