import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/lib/report.test.ts', 'src/lib/search-labels.test.ts'],
  },
});
