import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@stateproof/core': resolveFromRoot('./packages/core/src/index.ts'),
      '@stateproof/benchmark/gold': resolveFromRoot('./packages/benchmark/src/gold.ts'),
      '@stateproof/benchmark/validate': resolveFromRoot('./packages/benchmark/src/validate/index.ts'),
      '@stateproof/benchmark': resolveFromRoot('./packages/benchmark/src/index.ts'),
      '@stateproof/model-provider': resolveFromRoot('./packages/model-provider/src/index.ts'),
      '@stateproof/agents': resolveFromRoot('./packages/agents/src/index.ts'),
      '@stateproof/submission': resolveFromRoot('./packages/submission/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    /**
     * Above Vitest's 5s default, which was never a deliberate choice here.
     *
     * The heaviest tests are integration tests that do real work rather than compute:
     * the locked-protocol guards initialise scratch git repositories and run the CLIs
     * as child processes, and the dashboard tests build the site and hash artifacts.
     * They peak around 2s on a developer machine, and Windows CI runners are several
     * times slower at process spawning and file I/O, so 5s sat close enough to the
     * edge that the Windows job failed intermittently on a different handful of tests
     * each time while Ubuntu passed.
     *
     * This is headroom, not permission to be slow: a genuinely hung process still
     * fails the run, and any test that actually approaches this ceiling is doing
     * something worth looking at.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
