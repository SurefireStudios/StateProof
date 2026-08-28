import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@stateproof/core': resolveFromRoot('./packages/core/src/index.ts'),
      '@stateproof/benchmark': resolveFromRoot('./packages/benchmark/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
