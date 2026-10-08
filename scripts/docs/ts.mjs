/**
 * Loads the pure TypeScript modules re-exported by scripts/docs/entry.ts: esbuild bundles them in
 * memory for Node, and the bundle is imported from a data: URL. Nothing is written to disk.
 */

import { join } from 'node:path';
import * as esbuild from 'esbuild';

let loaded = null;

export function loadModules(root) {
  loaded ??= (async () => {
    const result = await esbuild.build({
      entryPoints: [join(root, 'scripts/docs/entry.ts')],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      define: { __TEST__: 'false', __TARGET__: '"chrome"' },
    });
    const code = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  })();
  return loaded;
}
