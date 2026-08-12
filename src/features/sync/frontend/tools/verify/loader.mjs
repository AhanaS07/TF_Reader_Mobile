/**
 * Lets Node import the app's own TypeScript modules unchanged.
 *
 * Two things stand in the way and this hook removes both:
 *   - the app imports React Native packages that do not exist here, so the
 *     three the sync path touches are redirected to shims;
 *   - the app writes extensionless relative imports, which Node's ESM resolver
 *     rejects, so a missing `.ts` is filled in.
 *
 * Nothing else is substituted. The repositories, mappers, outbox and Sync
 * Manager under test are the real files the phone runs.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHIMS = {
  'expo-sqlite': './shims/expo-sqlite.mjs',
  'expo-crypto': './shims/expo-crypto.mjs',
  'expo-constants': './shims/expo-constants.mjs',
};

export async function resolve(specifier, context, next) {
  const shim = SHIMS[specifier];
  if (shim) {
    return { url: new URL(shim, import.meta.url).href, shortCircuit: true };
  }

  if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL) {
    const directory = path.dirname(fileURLToPath(context.parentURL));
    for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`]) {
      const resolved = path.resolve(directory, candidate);
      if (existsSync(resolved)) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
  }

  return next(specifier, context);
}
