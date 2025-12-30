/**
 * Path Utilities
 * Centralized path normalization functions using Node.js path module
 */

import path from 'path';

/**
 * Normalize a file path to absolute, consistent format
 * - Resolves relative paths against cwd
 * - Normalizes separators and removes trailing slashes
 */
export function normalizeFilePath(filePath: string): string {
  if (!filePath) return '';

  // Resolve to absolute if relative
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  // Normalize (resolves .. and . segments, consistent separators)
  return path.normalize(absolute);
}

/**
 * Convert absolute path to relative from a root directory
 * - Uses path.relative() for correct handling
 * - Returns absolute if path is outside root
 */
export function toRelativePath(absolutePath: string, projectRoot: string): string {
  if (!absolutePath) return '';
  if (!projectRoot) return absolutePath;

  const relative = path.relative(projectRoot, absolutePath);

  // If relative path starts with '..', it's outside the root - return absolute
  if (relative.startsWith('..')) {
    return absolutePath;
  }

  return relative;
}

/**
 * Find common root directory from array of file paths
 * - Uses path.dirname() and path.sep correctly
 * - Handles edge cases (single file, no common root)
 */
export function getCommonRoot(filePaths: string[]): string {
  const validPaths = filePaths.filter(Boolean);

  if (validPaths.length === 0) return process.cwd();
  if (validPaths.length === 1) return path.dirname(validPaths[0]);

  const parts = validPaths.map((p) => p.split(path.sep));
  const commonParts: string[] = [];

  for (let i = 0; i < parts[0].length; i++) {
    const segment = parts[0][i];
    if (parts.every((p) => p[i] === segment)) {
      commonParts.push(segment);
    } else {
      break;
    }
  }

  return commonParts.join(path.sep) || path.sep;
}

/**
 * Check if a path is absolute
 * - Cross-platform using path.isAbsolute()
 */
export function isAbsolutePath(filePath: string): boolean {
  return path.isAbsolute(filePath);
}

/**
 * Normalize path for comparison/matching
 * - Consistent separators using path.normalize()
 */
export function normalizeForComparison(filePath: string): string {
  if (!filePath) return '';
  return path.normalize(filePath);
}
