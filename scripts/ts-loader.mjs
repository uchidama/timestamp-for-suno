import { transform } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && context.parentURL) {
    const candidateTsUrl = new URL(
      specifier.slice(0, -3) + '.ts',
      context.parentURL,
    );
    if (
      candidateTsUrl.protocol === 'file:' &&
      existsSync(fileURLToPath(candidateTsUrl))
    ) {
      return {
        url: candidateTsUrl.href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const filePath = fileURLToPath(url);
    const source = await readFile(filePath, 'utf8');
    const result = await transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline',
      sourcefile: filePath,
    });
    return {
      format: 'module',
      source: result.code,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
