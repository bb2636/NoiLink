import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: false,
  },
  resolve: {
    alias: {
      '@noilink/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
});
