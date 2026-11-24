// Bundles lambda/index.js (+ lib/) into dist/lambda.zip, ready for `aws lambda update-function-code`.
import { build } from 'esbuild';
import AdmZip from 'adm-zip';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['lambda/index.js'],
  outfile: 'dist/lambda/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  // ESM bundles of CJS deps need require()
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

const zip = new AdmZip();
zip.addLocalFile('dist/lambda/index.mjs');
zip.writeZip('dist/lambda.zip');
console.log(`dist/lambda.zip  ${(fs.statSync('dist/lambda.zip').size / 1024).toFixed(0)} KB`);
