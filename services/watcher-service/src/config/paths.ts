import { normalize, resolve } from 'node:path';

export function resolveAbsoluteWatcherPath(pathValue: string, cwd = process.cwd()): string {
  return normalize(resolve(cwd, pathValue));
}

export function resolveWatcherPathWithin(directory: string, segment: string): string {
  return normalize(resolve(directory, segment));
}
