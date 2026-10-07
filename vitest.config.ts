import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __TEST__: 'false', __TARGET__: '"chrome"' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
