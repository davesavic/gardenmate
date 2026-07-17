import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./js/__mocks__/wails.js'],
    include: ['js/*_test.js'],
    testTimeout: 5000,
  },
});
