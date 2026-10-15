import { defineConfig } from 'vitest/config';

// One time zone everywhere, with daylight saving time, so that the calendar tests (logical days,
// windows, periods) mean the same on every machine and cover the change of the clocks.
process.env.TZ = 'Europe/Rome';

export default defineConfig({
  define: { __TEST__: 'false', __TARGET__: '"chrome"' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Declarations, plain data and the test-build hooks hold no logic to cover.
      exclude: ['src/**/*.d.ts', 'src/engine/types.ts', 'src/shared/models.ts', 'src/background/testing.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      // The logic is unit tested; the pages are tested end to end (tests/e2e). Below these the
      // run fails, so that the logic keeps its tests.
      thresholds: {
        'src/engine/**': { lines: 95, statements: 93, functions: 95, branches: 85 },
        'src/background/**': { lines: 85, statements: 80, functions: 70, branches: 70 },
      },
    },
  },
});
