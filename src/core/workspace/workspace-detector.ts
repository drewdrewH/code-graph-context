/**
 * Workspace Detector
 * Auto-discovers monorepo structure (Turborepo, pnpm, yarn, npm workspaces)
 */

import fs from 'fs/promises';
import path from 'path';

import { glob } from 'glob';
import YAML from 'yaml';

import { debugLog } from '../../utils/file-utils.js';

export interface WorkspacePackage {
  name: string; // Package name from package.json (e.g., "@ui/auth")
  path: string; // Absolute path to package directory
  tsConfigPath: string | null; // Path to tsconfig.json if exists
  relativePath: string; // Relative path from workspace root (e.g., "packages/auth")
}

export type WorkspaceType = 'turborepo' | 'pnpm' | 'yarn' | 'npm' | 'single';

export interface WorkspaceConfig {
  type: WorkspaceType;
  rootPath: string;
  packages: WorkspacePackage[];
}

export class WorkspaceDetector {
  /**
   * Detect workspace configuration from a root path
   */
  async detect(rootPath: string): Promise<WorkspaceConfig> {
    const absoluteRoot = path.resolve(rootPath);

    // Check for different workspace types in order of specificity
    const type = await this.detectWorkspaceType(absoluteRoot);

    if (type === 'single') {
      // Single project, not a monorepo
      return {
        type: 'single',
        rootPath: absoluteRoot,
        packages: await this.getSingleProjectPackage(absoluteRoot),
      };
    }

    // Get workspace patterns and enumerate packages
    const patterns = await this.getWorkspacePatterns(absoluteRoot, type);
    const packages = await this.enumeratePackages(absoluteRoot, patterns);

    await debugLog('Workspace detected', { type, packageCount: packages.length });

    return {
      type,
      rootPath: absoluteRoot,
      packages,
    };
  }

  /**
   * Detect the type of workspace/monorepo
   */
  private async detectWorkspaceType(rootPath: string): Promise<WorkspaceType> {
    // Check for Turborepo (has turbo.json)
    const turboJsonPath = path.join(rootPath, 'turbo.json');
    const hasTurboJson = await this.fileExists(turboJsonPath);
    await debugLog('Checking for turbo.json', { path: turboJsonPath, exists: hasTurboJson });
    if (hasTurboJson) {
      return 'turborepo';
    }

    // Check for pnpm workspaces (has pnpm-workspace.yaml)
    const pnpmWorkspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
    const hasPnpmWorkspace = await this.fileExists(pnpmWorkspacePath);
    await debugLog('Checking for pnpm-workspace.yaml', { path: pnpmWorkspacePath, exists: hasPnpmWorkspace });
    if (hasPnpmWorkspace) {
      return 'pnpm';
    }

    // Check package.json for workspaces field
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (await this.fileExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        if (packageJson.workspaces) {
          // Yarn uses workspaces array or object with packages
          if (Array.isArray(packageJson.workspaces)) {
            return 'yarn';
          }
          if (packageJson.workspaces.packages) {
            return 'yarn';
          }
          // npm also uses workspaces
          return 'npm';
        }
      } catch {
        // Ignore parse errors
      }
    }

    await debugLog('No workspace markers found', { rootPath, result: 'single' });
    return 'single';
  }

  /**
   * Get workspace glob patterns based on workspace type
   */
  private async getWorkspacePatterns(rootPath: string, type: WorkspaceType): Promise<string[]> {
    switch (type) {
      case 'turborepo':
      case 'pnpm': {
        // pnpm-workspace.yaml defines packages
        const pnpmWorkspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
        if (await this.fileExists(pnpmWorkspacePath)) {
          try {
            const content = await fs.readFile(pnpmWorkspacePath, 'utf-8');
            const config = YAML.parse(content);
            if (config?.packages && Array.isArray(config.packages)) {
              return config.packages;
            }
          } catch {
            // Fall through to defaults
          }
        }
        // Turborepo default patterns
        return ['apps/*', 'packages/*'];
      }

      case 'yarn':
      case 'npm': {
        // Read from package.json workspaces
        const packageJsonPath = path.join(rootPath, 'package.json');
        try {
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          if (Array.isArray(packageJson.workspaces)) {
            return packageJson.workspaces;
          }
          if (packageJson.workspaces?.packages) {
            return packageJson.workspaces.packages;
          }
        } catch {
          // Fall through to defaults
        }
        return ['packages/*'];
      }

      default:
        return [];
    }
  }

  /**
   * Enumerate all packages matching workspace patterns
   */
  private async enumeratePackages(rootPath: string, patterns: string[]): Promise<WorkspacePackage[]> {
    const packages: WorkspacePackage[] = [];
    const seenPaths = new Set<string>();

    await debugLog('Enumerating packages with patterns', { patterns, rootPath });

    for (const pattern of patterns) {
      // Handle negation patterns (start with !)
      if (pattern.startsWith('!')) {
        continue; // Skip negation patterns in enumeration
      }

      // Glob for directories matching the pattern
      const matches = await glob(pattern, {
        cwd: rootPath,
        absolute: true,
        nodir: false,
        mark: true, // Adds trailing slash to directories
      });

      await debugLog('Glob pattern matched', { pattern, matchCount: matches.length, sample: matches.slice(0, 5) });

      // Filter to only directories (those ending with /)
      const directories = matches.filter((m) => m.endsWith('/') || !m.includes('.'));
      await debugLog('After directory filter', { pattern, directoryCount: directories.length });

      for (const match of directories) {
        // Remove trailing slash if present
        const packagePath = match.endsWith('/') ? match.slice(0, -1) : match;

        // Skip if already seen
        if (seenPaths.has(packagePath)) continue;
        seenPaths.add(packagePath);

        // Check if this is a valid package (has package.json)
        const packageJsonPath = path.join(packagePath, 'package.json');
        if (!(await this.fileExists(packageJsonPath))) {
          continue;
        }

        // Read package name
        let packageName: string;
        try {
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          packageName = packageJson.name || path.basename(packagePath);
        } catch {
          packageName = path.basename(packagePath);
        }

        // Check for tsconfig
        const tsConfigPath = path.join(packagePath, 'tsconfig.json');
        const hasTsConfig = await this.fileExists(tsConfigPath);

        packages.push({
          name: packageName,
          path: packagePath,
          tsConfigPath: hasTsConfig ? tsConfigPath : null,
          relativePath: path.relative(rootPath, packagePath),
        });
      }
    }

    // Sort by path for consistent ordering
    packages.sort((a, b) => a.path.localeCompare(b.path));

    return packages;
  }

  /**
   * Get package info for a single (non-monorepo) project
   */
  private async getSingleProjectPackage(rootPath: string): Promise<WorkspacePackage[]> {
    const packageJsonPath = path.join(rootPath, 'package.json');
    let packageName = path.basename(rootPath);

    if (await this.fileExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        packageName = packageJson.name || packageName;
      } catch {
        // Use directory name
      }
    }

    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    const hasTsConfig = await this.fileExists(tsConfigPath);

    return [
      {
        name: packageName,
        path: rootPath,
        tsConfigPath: hasTsConfig ? tsConfigPath : null,
        relativePath: '.',
      },
    ];
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
