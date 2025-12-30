import crypto from 'crypto';
import { basename, resolve } from 'path';

/**
 * Project ID prefix for generated IDs
 */
const PROJECT_ID_PREFIX = 'proj_';

/**
 * Interface for Neo4j service (minimal interface to avoid circular deps)
 */
export interface ProjectResolver {
  run(query: string, params: Record<string, any>): Promise<Record<string, any>[]>;
}

/**
 * Generates a deterministic projectId from an absolute project path.
 * The projectId is a short hash that uniquely identifies the project.
 *
 * @param projectPath - The absolute path to the project root
 * @returns A deterministic projectId in format 'proj_<hash>'
 *
 * @example
 * generateProjectId('/Users/dev/my-api') // => 'proj_a1b2c3d4e5f6'
 */
export const generateProjectId = (projectPath: string): string => {
  // Normalize to absolute path
  const absolutePath = resolve(projectPath);

  // Create a deterministic hash of the path
  const hash = crypto.createHash('sha256').update(absolutePath).digest('hex').substring(0, 12);

  return `${PROJECT_ID_PREFIX}${hash}`;
};

/**
 * Validates that a projectId has the correct format.
 *
 * @param projectId - The projectId to validate
 * @returns true if the projectId is valid, false otherwise
 *
 * @example
 * validateProjectId('proj_a1b2c3d4e5f6') // => true
 * validateProjectId('invalid') // => false
 */
export const validateProjectId = (projectId: string): boolean => {
  if (!projectId || typeof projectId !== 'string') {
    return false;
  }

  // Must start with prefix
  if (!projectId.startsWith(PROJECT_ID_PREFIX)) {
    return false;
  }

  // Must have exactly 12 hex characters after prefix
  const hash = projectId.slice(PROJECT_ID_PREFIX.length);
  if (hash.length !== 12) {
    return false;
  }

  // Hash must be valid hex
  return /^[a-f0-9]{12}$/.test(hash);
};

/**
 * Resolves a projectId from either an explicit value or a project path.
 * If projectId is provided, it's validated and returned.
 * If not, generates one from the projectPath.
 *
 * @param projectPath - The project path (required)
 * @param projectId - Optional explicit projectId
 * @returns The resolved projectId
 * @throws Error if explicit projectId is invalid
 *
 * @example
 * resolveProjectId('/Users/dev/my-api') // => 'proj_a1b2c3d4e5f6'
 * resolveProjectId('/Users/dev/my-api', 'proj_custom12345') // => 'proj_custom12345'
 */
export const resolveProjectId = (projectPath: string, projectId?: string): string => {
  if (projectId) {
    if (!validateProjectId(projectId)) {
      throw new Error(
        `Invalid projectId format: '${projectId}'. Expected format: 'proj_<12-hex-chars>' (e.g., 'proj_a1b2c3d4e5f6')`,
      );
    }
    return projectId;
  }

  return generateProjectId(projectPath);
};

/**
 * Extracts a friendly project name from a path or package.json.
 * Falls back to directory basename if package.json not available.
 *
 * @param projectPath - The project root path
 * @returns The project name
 */
export const getProjectName = async (projectPath: string): Promise<string> => {
  const absolutePath = resolve(projectPath);

  try {
    // Try to read package.json for the name
    const fs = await import('fs/promises');
    const packageJsonPath = `${absolutePath}/package.json`;
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.name) {
      return pkg.name;
    }
  } catch {
    // No package.json or invalid - fall back to directory name
  }

  // Use directory basename as fallback
  return basename(absolutePath);
};

/**
 * Query to find project by name, path, or projectId
 */
export const FIND_PROJECT_QUERY = `
  MATCH (p:Project)
  WHERE p.name = $input OR p.path = $input OR p.projectId = $input
  RETURN p.projectId AS projectId
  LIMIT 1
`;

/**
 * Query to create/update a Project node with status
 */
export const UPSERT_PROJECT_QUERY = `
  MERGE (p:Project {projectId: $projectId})
  SET p.name = $name,
      p.path = $path,
      p.status = $status,
      p.updatedAt = datetime()
  RETURN p.projectId AS projectId
`;

/**
 * Query to update Project node status after completion/failure
 */
export const UPDATE_PROJECT_STATUS_QUERY = `
  MATCH (p:Project {projectId: $projectId})
  SET p.status = $status,
      p.nodeCount = $nodeCount,
      p.edgeCount = $edgeCount,
      p.updatedAt = datetime()
  RETURN p.projectId AS projectId
`;

/**
 * Query to list all projects with status
 */
export const LIST_PROJECTS_QUERY = `
  MATCH (p:Project)
  RETURN p.projectId AS projectId, p.name AS name, p.path AS path,
         p.status AS status, p.nodeCount AS nodeCount, p.edgeCount AS edgeCount,
         p.updatedAt AS updatedAt
  ORDER BY p.updatedAt DESC
`;

/**
 * Resolves a flexible project input (name, path, or projectId) to a valid projectId.
 * Looks up the project in Neo4j if needed.
 *
 * @param input - Project name ("backend"), path ("/Users/.../backend"), or projectId
 * @param resolver - Neo4j service or compatible resolver
 * @returns The resolved projectId
 * @throws Error if project not found
 *
 * @example
 * // Valid projectId passes through
 * resolveProjectIdFromInput('proj_a1b2c3d4e5f6', neo4j) // => 'proj_a1b2c3d4e5f6'
 *
 * // Name looks up in Neo4j
 * resolveProjectIdFromInput('backend', neo4j) // => 'proj_a1b2c3d4e5f6'
 *
 * // Path looks up in Neo4j, or generates if not found
 * resolveProjectIdFromInput('/Users/dev/backend', neo4j) // => 'proj_a1b2c3d4e5f6'
 */
export const resolveProjectIdFromInput = async (input: string, resolver: ProjectResolver): Promise<string> => {
  // Already valid projectId format? Return as-is
  if (validateProjectId(input)) {
    return input;
  }

  // Try to find by name or path in Neo4j
  const result = await resolver.run(FIND_PROJECT_QUERY, { input });

  if (result.length > 0 && result[0].projectId) {
    return result[0].projectId;
  }

  // If looks like a path, generate the projectId from it
  // Check for Unix paths (/, ./, ..) and Windows paths (C:\, D:/, etc.)
  const isUnixPath = input.startsWith('/') || input.startsWith('./') || input.startsWith('..');
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(input);

  if (isUnixPath || isWindowsPath) {
    return generateProjectId(input);
  }

  throw new Error(
    `Project not found: "${input}". Run parse_typescript_project first or use list_projects to see available projects.`,
  );
};
