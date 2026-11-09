import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const distIconsDir = resolve(distDir, 'icons');

async function runBuild() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distIconsDir, { recursive: true });

  const sharedOptions = {
    bundle: true,
    format: 'iife',
    target: ['chrome114'],
    charset: 'utf8',
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  };

  await build({
    ...sharedOptions,
    entryPoints: [resolve(rootDir, 'src/content/index.ts')],
    outfile: resolve(distDir, 'content.js'),
  });

  await build({
    ...sharedOptions,
    entryPoints: [resolve(rootDir, 'src/content/page-bridge.ts')],
    outfile: resolve(distDir, 'page-bridge.js'),
  });

  await copyFile(
    resolve(rootDir, 'manifest.json'),
    resolve(distDir, 'manifest.json'),
  );

  for (const size of [16, 32, 48, 128]) {
    const fileName = `icon-${size}.png`;
    await copyFile(
      resolve(rootDir, 'icons', fileName),
      resolve(distIconsDir, fileName),
    );
  }

  console.log('Build complete: dist/ is ready for Chrome Load unpacked.');
}

runBuild().catch((err) => {
  console.error(err);
  process.exit(1);
});
