/**
 * The library build: one ESM and one CommonJS file per entry, shared
 * code in chunks, no minification (consumers minify). Type declarations
 * come from `tsc -p tsconfig.build.json` and `scripts/build-types.mjs`.
 */

import { defineConfig } from 'vitest/config'

/** The public entries, by output path without extension. */
const entries = {
  index: 'src/index.ts',
  'disposable/index': 'src/disposable/index.ts',
  'dns/index': 'src/dns/index.ts',
  'providers/kickbox/index': 'src/providers/kickbox/index.ts',
  'providers/mock/index': 'src/providers/mock/index.ts',
  'kickbox-csv/index': 'src/kickbox-csv/index.ts',
}

export default defineConfig({
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    lib: {
      entry: entries,
      formats: ['es', 'cjs'],
      fileName: (format, name) =>
        `${name}.${format === 'es' ? 'js' : 'cjs'}`,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.fixtures.ts', 'src/data/**'],
    },
  },
})
