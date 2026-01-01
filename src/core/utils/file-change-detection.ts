/**
 * File Change Detection
 * Shared utilities for detecting changed files for incremental parsing
 */

import { stat, realpath } from 'fs/promises';
import { resolve, sep } from 'path';

import { glob } from 'glob';

import { EXCLUDE_PATTERNS_GLOB, EXCLUDE_PATTERNS_REGEX } from '../../constants.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';

import { hashFile } from './file-utils.js';

/**
 * Check if a file path matches any of the exclude patterns.
 * Uses the same patterns as the TypeScript parser.
 */
const shouldExcludeFile = (filePath: string): boolean => {
  for (const pattern of EXCLUDE_PATTERNS_REGEX) {
    if (filePath.includes(pattern) || new RegExp(pattern).test(filePath)) {
      return true;
    }
  }
  return false;
};

/**
 * Information about a file indexed in Neo4j
 */
export interface IndexedFileInfo {
  filePath: string;
  mtime: number;
  size: number;
  contentHash: string;
}

/**
 * Result of detecting changed files
 */
export interface ChangedFilesResult {
  filesToReparse: string[];
  filesToDelete: string[];
}

export interface DetectChangedFilesOptions {
  /** Log warnings for skipped files (default: true) */
  logWarnings?: boolean;
}

/**
 * Detect which files have changed and need reparsing.
 * Compares current files on disk with indexed files in Neo4j.
 *
 * SECURITY: Validates that all file paths stay within the project directory
 * after symlink resolution to prevent path traversal attacks.
 *
 * @param projectPath - Root path of the project
 * @param neo4jService - Neo4j service instance
 * @param projectId - Project ID for scoping queries
 * @param options - Optional configuration
 * @returns Files that need reparsing and files that were deleted
 */
export const detectChangedFiles = async (
  projectPath: string,
  neo4jService: Neo4jService,
  projectId: string,
  options: DetectChangedFilesOptions = {},
): Promise<ChangedFilesResult> => {
  const { logWarnings = true } = options;

  // SECURITY: Resolve project path to real path to handle symlinks consistently
  const realProjectPath = await realpath(projectPath);

  const relativeFiles = await glob('**/*.{ts,tsx}', { cwd: projectPath, ignore: EXCLUDE_PATTERNS_GLOB });

  // SECURITY: Validate each file stays within project directory after symlink resolution
  const validatedFiles: string[] = [];
  for (const relFile of relativeFiles) {
    const absolutePath = resolve(projectPath, relFile);
    try {
      const realFilePath = await realpath(absolutePath);
      // Check that resolved path is within project
      if (realFilePath.startsWith(realProjectPath + sep) || realFilePath === realProjectPath) {
        // Use realFilePath for consistent path matching with Neo4j
        validatedFiles.push(realFilePath);
      } else if (logWarnings) {
        console.warn(`SECURITY: Skipping file outside project directory: ${relFile}`);
      }
    } catch {
      // File may have been deleted between glob and realpath - skip it
      if (logWarnings) {
        console.warn(`File no longer accessible: ${relFile}`);
      }
    }
  }

  const currentFiles = new Set(validatedFiles);

  // Get indexed files from Neo4j
  const queryResult = await neo4jService.run(QUERIES.GET_SOURCE_FILE_TRACKING_INFO, { projectId });
  const indexedFiles = queryResult as IndexedFileInfo[];
  const indexedMap = new Map(indexedFiles.map((f) => [f.filePath, f]));

  const filesToReparse: string[] = [];
  const filesToDelete: string[] = [];

  // Check each current file against indexed state
  for (const filePath of currentFiles) {
    const indexed = indexedMap.get(filePath);

    if (!indexed) {
      // New file - check if it should be excluded (same rules as parser)
      if (shouldExcludeFile(filePath)) {
        continue; // Skip excluded files
      }
      filesToReparse.push(filePath);
      continue;
    }

    try {
      const fileStats = await stat(filePath);
      const currentHash = await hashFile(filePath);

      // Only skip if mtime, size, AND hash all match (correctness over optimization)
      if (
        fileStats.mtimeMs === indexed.mtime &&
        fileStats.size === indexed.size &&
        currentHash === indexed.contentHash
      ) {
        continue;
      }

      // Any mismatch means file changed
      filesToReparse.push(filePath);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        // File was deleted between glob and stat - will be caught in deletion logic below
        if (logWarnings) {
          console.warn(`File deleted between glob and stat: ${filePath}`);
        }
      } else if (nodeError.code === 'EACCES') {
        // Permission denied - assume changed to be safe
        if (logWarnings) {
          console.warn(`Permission denied reading file: ${filePath}`);
        }
        filesToReparse.push(filePath);
      } else {
        throw error;
      }
    }
  }

  // Find deleted files (indexed but no longer on disk)
  for (const indexedPath of indexedMap.keys()) {
    if (!currentFiles.has(indexedPath)) {
      filesToDelete.push(indexedPath);
    }
  }

  return { filesToReparse, filesToDelete };
};
