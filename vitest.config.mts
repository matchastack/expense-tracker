import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // Month boundaries follow the device clock; pin a timezone so the tests are deterministic.
    env: { TZ: 'Asia/Singapore' },
    fileParallelism: false,
  },
});
