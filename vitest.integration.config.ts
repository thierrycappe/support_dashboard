import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
