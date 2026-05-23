import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/*.module.ts', '**/main.ts', 'prisma/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@common': resolve(__dirname, 'src/common'),
      '@config': resolve(__dirname, 'src/config'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@providers': resolve(__dirname, 'src/providers'),
    },
  },
});
