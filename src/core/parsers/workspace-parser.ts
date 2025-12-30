/**
 * Workspace Parser
 * Orchestrates parsing of multi-package monorepos
 */

import crypto from 'crypto';
import path from 'path';

import { glob } from 'glob';

import { debugLog } from '../../utils/file-utils.js';
import { Neo4jNode, Neo4jEdge, CoreEdgeType, CORE_TYPESCRIPT_SCHEMA } from '../config/schema.js';
import { resolveProjectId } from '../utils/project-id.js';
import { WorkspaceConfig, WorkspacePackage } from '../workspace/index.js';

import { TypeScriptParser } from './typescript-parser.js';

export interface WorkspaceParseResult {
  nodes: Neo4jNode[];
  edges: Neo4jEdge[];
  packageResults: Map<string, { nodes: number; edges: number }>;
}

interface DeferredEdge {
  edgeType: string;
  sourceNodeId: string;
  targetName: string;
  targetType: string;
  targetFilePath?: string; // File path of target for precise matching (used for EXTENDS/IMPLEMENTS)
}

export class WorkspaceParser {
  private config: WorkspaceConfig;
  private projectId: string;
  private lazyLoad: boolean;
  private discoveredFiles: Map<string, string[]> | null = null;
  private parsedNodes: Map<string, Neo4jNode> = new Map();
  private parsedEdges: Map<string, Neo4jEdge> = new Map();
  private accumulatedDeferredEdges: DeferredEdge[] = [];

  constructor(config: WorkspaceConfig, projectId?: string, lazyLoad: boolean = true) {
    this.config = config;
    this.projectId = resolveProjectId(config.rootPath, projectId);
    this.lazyLoad = lazyLoad;
  }

  /**
   * Get the project ID for this workspace
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Get workspace configuration
   */
  getConfig(): WorkspaceConfig {
    return this.config;
  }

  /**
   * Discover all source files across all packages
   */
  async discoverSourceFiles(): Promise<string[]> {
    if (this.discoveredFiles !== null) {
      // Return flattened list
      return Array.from(this.discoveredFiles.values()).flat();
    }

    this.discoveredFiles = new Map();
    let totalFiles = 0;
    const packageCounts: Record<string, number> = {};

    for (const pkg of this.config.packages) {
      const files = await this.discoverPackageFiles(pkg);
      this.discoveredFiles.set(pkg.name, files);
      totalFiles += files.length;
      packageCounts[pkg.name] = files.length;
    }

    await debugLog('WorkspaceParser discovered files', {
      totalFiles,
      packageCount: this.config.packages.length,
      packageCounts,
    });

    return Array.from(this.discoveredFiles.values()).flat();
  }

  /**
   * Discover files in a single package
   */
  private async discoverPackageFiles(pkg: WorkspacePackage): Promise<string[]> {
    // Include both .ts and .tsx files
    const pattern = path.join(pkg.path, '**/*.{ts,tsx}');
    const files = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/*.d.ts', '**/dist/**', '**/build/**'],
      absolute: true,
    });
    return files;
  }

  /**
   * Get files grouped by package
   */
  async getFilesByPackage(): Promise<Map<string, string[]>> {
    if (this.discoveredFiles === null) {
      await this.discoverSourceFiles();
    }
    return this.discoveredFiles!;
  }

  /**
   * Parse a single package and return its results
   */
  async parsePackage(pkg: WorkspacePackage): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }> {
    console.log(`\n📦 Parsing package: ${pkg.name}`);

    // Create parser for this package with its own tsconfig
    const tsConfigPath = pkg.tsConfigPath || path.join(pkg.path, 'tsconfig.json');

    const parser = new TypeScriptParser(
      pkg.path,
      tsConfigPath,
      undefined, // Use default core schema
      [], // No framework schemas for now - can be enhanced later
      undefined, // Default parse options
      this.projectId, // Use workspace-level projectId
      this.lazyLoad,
    );

    // Discover files for this package
    const files = await this.discoverPackageFiles(pkg);
    if (files.length === 0) {
      console.log(`   ⚠️ No TypeScript files found in ${pkg.name}`);
      return { nodes: [], edges: [] };
    }

    console.log(`   📄 ${files.length} files to parse`);

    // Parse all files in this package
    const result = await parser.parseChunk(files, true); // Skip edge resolution for now

    // Add package name to all nodes
    for (const node of result.nodes) {
      node.properties.packageName = pkg.name;
    }

    console.log(`   ✅ ${result.nodes.length} nodes, ${result.edges.length} edges`);

    return result;
  }

  /**
   * Parse a chunk of files (for streaming compatibility)
   * Files are grouped by package and parsed together
   */
  async parseChunk(
    filePaths: string[],
    skipEdgeResolution: boolean = false,
  ): Promise<{ nodes: Neo4jNode[]; edges: Neo4jEdge[] }> {
    // Group files by package
    const filesByPackage = new Map<WorkspacePackage, string[]>();

    for (const filePath of filePaths) {
      const pkg = this.findPackageForFile(filePath);
      if (pkg) {
        const files = filesByPackage.get(pkg) || [];
        files.push(filePath);
        filesByPackage.set(pkg, files);
      }
    }

    const allNodes: Neo4jNode[] = [];
    const allEdges: Neo4jEdge[] = [];

    // Parse each package's files
    for (const [pkg, files] of filesByPackage) {
      // Use package's tsconfig if it exists, otherwise use root tsconfig
      const tsConfigPath = pkg.tsConfigPath || path.join(this.config.rootPath, 'tsconfig.json');

      try {
        const parser = new TypeScriptParser(
          pkg.path,
          tsConfigPath,
          undefined,
          [],
          undefined,
          this.projectId,
          this.lazyLoad,
        );

        const result = await parser.parseChunk(files, skipEdgeResolution);

        // Add package name to nodes
        for (const node of result.nodes) {
          node.properties.packageName = pkg.name;
        }

        // Export and accumulate deferred edges for cross-package resolution
        const chunkData = parser.exportChunkResults();
        this.accumulatedDeferredEdges.push(...chunkData.deferredEdges);

        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
      } catch (error) {
        console.warn(`⚠️ Failed to parse package ${pkg.name}:`, error);
        // Continue with other packages
      }
    }

    return { nodes: allNodes, edges: allEdges };
  }

  /**
   * Find which package a file belongs to
   */
  private findPackageForFile(filePath: string): WorkspacePackage | null {
    for (const pkg of this.config.packages) {
      if (filePath.startsWith(pkg.path)) {
        return pkg;
      }
    }
    return null;
  }

  /**
   * Parse all packages in the workspace
   */
  async parseAll(): Promise<WorkspaceParseResult> {
    const packageResults = new Map<string, { nodes: number; edges: number }>();
    const allNodes: Neo4jNode[] = [];
    const allEdges: Neo4jEdge[] = [];

    for (const pkg of this.config.packages) {
      const result = await this.parsePackage(pkg);

      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);

      packageResults.set(pkg.name, {
        nodes: result.nodes.length,
        edges: result.edges.length,
      });
    }

    console.log(`\n🎉 Workspace parsing complete!`);
    console.log(`   Total: ${allNodes.length} nodes, ${allEdges.length} edges`);

    return {
      nodes: allNodes,
      edges: allEdges,
      packageResults,
    };
  }

  /**
   * Clear parsed data (for memory management)
   * Note: Does NOT clear accumulated deferred edges - those need to be resolved at the end
   */
  clearParsedData(): void {
    this.parsedNodes.clear();
    this.parsedEdges.clear();
  }

  /**
   * Add existing nodes for cross-package edge resolution
   */
  addExistingNodesFromChunk(nodes: Neo4jNode[]): void {
    for (const node of nodes) {
      this.parsedNodes.set(node.id, node);
    }
  }

  /**
   * Get current counts for progress reporting
   */
  getCurrentCounts(): { nodes: number; edges: number; deferredEdges: number } {
    return {
      nodes: this.parsedNodes.size,
      edges: this.parsedEdges.size,
      deferredEdges: this.accumulatedDeferredEdges.length,
    };
  }

  /**
   * Resolve accumulated deferred edges against all parsed nodes
   * Call this after all chunks have been parsed
   */
  async resolveDeferredEdgesManually(): Promise<Neo4jEdge[]> {
    const resolvedEdges: Neo4jEdge[] = [];
    const unresolvedImports: string[] = [];
    const unresolvedExtends: string[] = [];
    const unresolvedImplements: string[] = [];

    // Count by edge type for logging
    const importsCount = this.accumulatedDeferredEdges.filter((e) => e.edgeType === 'IMPORTS').length;
    const extendsCount = this.accumulatedDeferredEdges.filter((e) => e.edgeType === 'EXTENDS').length;
    const implementsCount = this.accumulatedDeferredEdges.filter((e) => e.edgeType === 'IMPLEMENTS').length;

    for (const deferred of this.accumulatedDeferredEdges) {
      // Find target node by name, type, and optionally file path from accumulated nodes
      const targetNode = this.findNodeByNameAndType(deferred.targetName, deferred.targetType, deferred.targetFilePath);

      if (targetNode) {
        // Find source node to get filePath
        const sourceNode = this.parsedNodes.get(deferred.sourceNodeId);
        const filePath = sourceNode?.properties.filePath || '';

        // Get relationship weight from core schema
        const coreEdgeType = deferred.edgeType as CoreEdgeType;
        const coreEdgeSchema = CORE_TYPESCRIPT_SCHEMA.edgeTypes[coreEdgeType];
        const relationshipWeight = coreEdgeSchema?.relationshipWeight ?? 0.5;

        // Generate a unique edge ID
        const edgeHash = crypto
          .createHash('md5')
          .update(`${deferred.sourceNodeId}-${deferred.edgeType}-${targetNode.id}`)
          .digest('hex')
          .substring(0, 12);

        const edge: Neo4jEdge = {
          id: `${this.projectId}:${deferred.edgeType}:${edgeHash}`,
          type: deferred.edgeType,
          startNodeId: deferred.sourceNodeId,
          endNodeId: targetNode.id,
          properties: {
            coreType: coreEdgeType,
            projectId: this.projectId,
            source: 'ast',
            confidence: 1.0,
            relationshipWeight,
            filePath,
            createdAt: new Date().toISOString(),
          },
        };
        resolvedEdges.push(edge);
      } else {
        // Track unresolved by type
        if (deferred.edgeType === 'IMPORTS') {
          unresolvedImports.push(deferred.targetName);
        } else if (deferred.edgeType === 'EXTENDS') {
          unresolvedExtends.push(deferred.targetName);
        } else if (deferred.edgeType === 'IMPLEMENTS') {
          unresolvedImplements.push(deferred.targetName);
        }
      }
    }

    // Log resolution stats
    const importsResolved = resolvedEdges.filter((e) => e.type === 'IMPORTS').length;
    const extendsResolved = resolvedEdges.filter((e) => e.type === 'EXTENDS').length;
    const implementsResolved = resolvedEdges.filter((e) => e.type === 'IMPLEMENTS').length;

    debugLog('WorkspaceParser edge resolution', {
      totalDeferredEdges: this.accumulatedDeferredEdges.length,
      totalNodesAvailable: this.parsedNodes.size,
      imports: {
        queued: importsCount,
        resolved: importsResolved,
        unresolved: unresolvedImports.length,
        sample: unresolvedImports.slice(0, 10),
      },
      extends: {
        queued: extendsCount,
        resolved: extendsResolved,
        unresolved: unresolvedExtends.length,
        sample: unresolvedExtends.slice(0, 10),
      },
      implements: {
        queued: implementsCount,
        resolved: implementsResolved,
        unresolved: unresolvedImplements.length,
        sample: unresolvedImplements.slice(0, 10),
      },
    });

    // Clear accumulated deferred edges after resolution
    this.accumulatedDeferredEdges = [];

    return resolvedEdges;
  }

  /**
   * Find a node by name and type from accumulated nodes
   * For SourceFiles, implements smart import resolution:
   * - Direct file path match
   * - Relative import resolution (./foo, ../bar)
   * - Scoped package imports (@workspace/ui, @any-ui/core)
   *
   * For ClassDeclaration/InterfaceDeclaration with filePath, uses precise matching.
   */
  private findNodeByNameAndType(name: string, type: string, filePath?: string): Neo4jNode | undefined {
    const allNodes = [...this.parsedNodes.values()];

    // If we have a file path and it's not a SourceFile, use precise matching first
    if (filePath && type !== 'SourceFile') {
      for (const node of allNodes) {
        if (
          node.properties.coreType === type &&
          node.properties.name === name &&
          node.properties.filePath === filePath
        ) {
          return node;
        }
      }
      // If precise match fails, fall through to name-only matching below
    }

    // For SOURCE_FILE with import specifier, try multiple matching strategies
    if (type === 'SourceFile') {
      // Strategy 1: Direct file path match
      for (const node of allNodes) {
        if (node.labels.includes(type) && node.properties.filePath === name) {
          return node;
        }
      }

      // Strategy 2: Resolve relative imports (./foo, ../bar)
      if (name.startsWith('.')) {
        // Normalize: remove leading ./ or ../
        const normalizedPath = name.replace(/^\.\.\//, '').replace(/^\.\//, '');

        // Try matching with common extensions
        const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
        for (const ext of extensions) {
          const searchPath = normalizedPath + ext;
          for (const node of allNodes) {
            if (node.labels.includes(type)) {
              // Match if filePath ends with the normalized path
              if (
                node.properties.filePath.endsWith(searchPath) ||
                node.properties.filePath.endsWith('/' + searchPath)
              ) {
                return node;
              }
            }
          }
        }
      }

      // Strategy 3: Workspace package imports (@workspace/ui, @any-ui/core)
      if (name.startsWith('@')) {
        const parts = name.split('/');
        const packageName = parts.slice(0, 2).join('/'); // @scope/package
        const subPath = parts.slice(2).join('/'); // rest of path after package name

        // First, try to find an exact match with subpath
        if (subPath) {
          const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
          for (const ext of extensions) {
            const searchPath = subPath + ext;
            for (const node of allNodes) {
              if (node.labels.includes(type) && node.properties.packageName === packageName) {
                if (
                  node.properties.filePath.endsWith(searchPath) ||
                  node.properties.filePath.endsWith('/' + searchPath)
                ) {
                  return node;
                }
              }
            }
          }
        }

        // For bare package imports (@workspace/ui), look for index files
        if (!subPath) {
          for (const node of allNodes) {
            if (node.labels.includes(type) && node.properties.packageName === packageName) {
              const fileName = node.properties.name;
              if (fileName === 'index.ts' || fileName === 'index.tsx') {
                return node;
              }
            }
          }
          // If no index file, return any file from the package as a fallback
          for (const node of allNodes) {
            if (node.labels.includes(type) && node.properties.packageName === packageName) {
              return node;
            }
          }
        }
      }
    }

    // Default: exact name match (for non-SourceFile types like classes, interfaces)
    for (const node of allNodes) {
      if (node.properties.coreType === type && node.properties.name === name) {
        return node;
      }
    }

    return undefined;
  }
}
