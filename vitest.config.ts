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
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
