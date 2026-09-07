/**
 * TypeScript support for Jest, built on the esbuild the renderer already uses.
 *
 * The cloud server under `cloud/` is TypeScript and had no test harness at all,
 * so its session-id handling — the part most prone to silent breakage — could
 * not be covered. Stripping types with esbuild keeps that reachable without
 * pulling in a second toolchain (ts-jest, babel presets) for a handful of files.
 */
const { transformSync } = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const { code, map } = transformSync(sourceText, {
      loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'cjs',
      target: 'node18',
      sourcefile: sourcePath,
      sourcemap: 'external',
    });
    return { code, map };
  },
};
