// Tests: npm test. Separate from vite.config.ts on purpose — the TanStack Start
// plugin isn't needed (server functions are called directly, see tests/setup.ts)
// and would only slow the run down.
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            src: fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        setupFiles: ['tests/setup.ts'],
        // The suites share one module-level harness (tests/harness.ts).
        fileParallelism: false,
        testTimeout: 20000,
    },
})
