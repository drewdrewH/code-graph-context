/**
 * MCP Server Constants
 * All constants used throughout the MCP server implementation
 */

// Re-export shared constants
export { LOG_CONFIG } from '../constants.js';

// Server Configuration
export const MCP_SERVER_CONFIG = {
  name: 'codebase-graph',
  version: '1.0.0',
} as const;

// File Paths
export const FILE_PATHS = {
  debugLog: 'debug-search.log',
  schemaOutput: 'neo4j-apoc-schema.json',
  graphOutput: 'graph.json',
} as const;

// Tool Names
export const TOOL_NAMES = {
  hello: 'hello',
  searchCodebase: 'search_codebase',
  naturalLanguageToCypher: 'natural_language_to_cypher',
  traverseFromNode: 'traverse_from_node',
  parseTypescriptProject: 'parse_typescript_project',
  testNeo4jConnection: 'test_neo4j_connection',
  impactAnalysis: 'impact_analysis',
  checkParseStatus: 'check_parse_status',
  listProjects: 'list_projects',
  startWatchProject: 'start_watch_project',
  stopWatchProject: 'stop_watch_project',
  listWatchers: 'list_watchers',
  detectDeadCode: 'detect_dead_code',
  detectDuplicateCode: 'detect_duplicate_code',
  swarmPheromone: 'swarm_pheromone',
  swarmSense: 'swarm_sense',
  swarmCleanup: 'swarm_cleanup',
  swarmPostTask: 'swarm_post_task',
  swarmClaimTask: 'swarm_claim_task',
  swarmCompleteTask: 'swarm_complete_task',
  swarmGetTasks: 'swarm_get_tasks',
  swarmOrchestrate: 'swarm_orchestrate',
} as const;

// Tool Metadata
export const TOOL_METADATA = {
  [TOOL_NAMES.hello]: {
    title: 'Hello Tool',
    description: 'Test tool that says hello',
  },
  [TOOL_NAMES.searchCodebase]: {
    title: 'Search Codebase',
    description: `Search the codebase using semantic similarity to find relevant code, functions, classes, and implementations.

**Before searching:**
Use list_projects to see available projects and get the project name/ID to search.

Returns normalized JSON with source code snippets. Uses JSON:API pattern to deduplicate nodes.

**Default Usage (Recommended)**:
Start with default parameters for richest context in a single call. Most queries complete successfully.

Parameters:
- query: Natural language description of what you're looking for

**Token Optimization (Only if needed)**:
Use these parameters ONLY if you encounter token limit errors (>25,000 tokens):

- maxDepth (default: 3): Reduce to 1-2 for shallow exploration
- maxNodesPerChain (default: 5): Limit chains shown per depth level
- includeCode (default: true): Set false to get structure only, fetch code separately
- snippetLength (default: 700): Reduce to 400-600 for smaller code snippets
- skip (default: 0): For pagination (skip N results)

**Progressive Strategy**:
1. Try with defaults first
2. If token error: Use maxDepth=1, includeCode=false for structure
3. Then traverse deeper or Read specific files for full code

**Compact Mode** (for exploration without full source code):
- includeCode: false → Returns just names, types, and file paths
- snippetLength: 200 → Smaller code previews
- maxNodesPerChain: 2 → Fewer relationship chains per depth`,
  },
  [TOOL_NAMES.naturalLanguageToCypher]: {
    title: 'Natural Language to Cypher',
    description: `Convert natural language queries into Cypher queries for Neo4j.

**Before using:**
Use list_projects to see available projects and get the project name.

**When to use:**
- For complex queries that search_codebase can't handle
- When you need custom filtering or aggregation
- To explore specific relationship patterns

**Parameters:**
- projectId: Project name, path, or ID (use list_projects to find)
- query: Natural language description of what you want to find

**Examples:**
- "Find all classes with more than 5 methods"
- "List functions that have more than 3 parameters"
- "Find files that import from a path containing 'utils'"
- "Show interfaces with 'Response' in their name"
- "Find all exported functions"

**Tips:**
- Import nodes store file paths, not module names (use 'path containing X')
- Node types: SourceFile, Class, Function, Method, Interface, Property, Parameter, Constructor, Import, Export, Decorator, Enum, Variable, TypeAlias
- Relationships: CONTAINS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_MEMBER, HAS_PARAMETER, TYPED_AS, CALLS, DECORATED_WITH
- For NestJS, use semanticType property instead of decorators (e.g., semanticType = 'NestController')

**Relationships (Core):**
- CONTAINS: File/class contains members
- HAS_MEMBER: Class/interface has methods/properties
- HAS_PARAMETER: Method/function has parameters
- IMPORTS: SourceFile imports another
- EXPORTS: SourceFile exports items
- EXTENDS: Class/interface extends another
- IMPLEMENTS: Class implements interface(s)
- CALLS: Method/function calls another
- TYPED_AS: Parameter/property has type annotation
- DECORATED_WITH: Node has decorators

**Relationships (NestJS/Framework):**
- INJECTS: Service/controller injects dependency
- EXPOSES: Controller exposes HTTP endpoints
- MODULE_IMPORTS, MODULE_PROVIDES, MODULE_EXPORTS: NestJS module system
- GUARDED_BY, TRANSFORMED_BY, INTERCEPTED_BY: Security/middleware

**Query Phrasing:**
Phrase queries using properties known to exist (filePath, name) rather than abstract concepts:
- Use "in account folder" or "filePath contains /account/" instead of "in account module"
- Use "classes extending DbService" not "services that extend DbService" (Service is a decorator, not a type)
- Use "with name containing 'Controller'" instead of "controllers"
The tool performs better with concrete, schema-aligned language.`,
  },
  [TOOL_NAMES.traverseFromNode]: {
    title: 'Traverse from Node',
    description: `Traverse the graph starting from a specific node ID to explore its connections and relationships in detail.

Parameters:
- nodeId (required): The node ID to start traversal from (obtained from search_codebase)
- maxDepth (default: 3): How many relationship hops to traverse (1-10)
- skip (default: 0): Number of results to skip for pagination

Advanced options (use when needed):
- includeCode (default: true): Set to false for structure-only view without source code
- maxNodesPerChain (default: 5): Limit chains shown per depth level (applied independently at each depth)
- summaryOnly: Set to true for just file paths and statistics without detailed traversal

Best practices:
- Use list_projects first to see available projects
- Start with search_codebase to find initial nodes
- Default includes source code snippets for immediate context
- Set includeCode: false for high-level architecture view only
- Use summaryOnly: true for a quick overview of many connections

**Compact Mode** (for exploration without full source code):
- summaryOnly: true → Returns only file paths and statistics
- includeCode: false → Structure without source code
- snippetLength: 200 → Smaller code previews
- maxTotalNodes: 20 → Limit total unique nodes returned`,
  },
  [TOOL_NAMES.parseTypescriptProject]: {
    title: 'Parse TypeScript Project',
    description: `Parse a TypeScript/NestJS project and build a code graph in Neo4j.

**IMPORTANT: Always use async mode for parsing:**
- Set async: true to avoid timeouts on large codebases
- Use check_parse_status to monitor progress

**Workflow:**
1. Call with async: true and projectPath
2. Note the returned jobId
3. Poll check_parse_status({ jobId }) until completed
4. Use list_projects to confirm the project was added

**Parameters:**
- projectPath (required): Absolute path to the project root
- async (recommended: true): Run parsing in background
- clearExisting: Set true to replace existing graph for this project
- projectId: Optional custom ID (auto-generated from path if omitted)

**Example:**
parse_typescript_project({ projectPath: "/path/to/project", async: true })
→ Returns jobId for polling`,
  },
  [TOOL_NAMES.testNeo4jConnection]: {
    title: 'Test Neo4j Connection & APOC',
    description: 'Test connection to Neo4j database and verify APOC plugin is available',
  },
  [TOOL_NAMES.impactAnalysis]: {
    title: 'Impact Analysis',
    description: `Analyze the impact of modifying a code node. Shows what depends on this node and helps assess risk before making changes.

**Before analyzing:**
Use list_projects to see available projects and get the project name.

Returns:
- Risk level (LOW/MEDIUM/HIGH/CRITICAL) based on dependency count and relationship types
- Direct dependents: nodes that directly reference the target
- Transitive dependents: nodes affected through dependency chains
- Affected files: list of files that would need review
- Critical paths: high-risk dependency chains

Parameters:
- nodeId: Node ID from search_codebase or traverse_from_node results
- filePath: Alternative - analyze all exports from a file
- maxDepth: How far to trace transitive dependencies (default: 4)

Use this before refactoring to understand blast radius of changes.`,
  },
  [TOOL_NAMES.checkParseStatus]: {
    title: 'Check Parse Status',
    description: `Check the status of an async parsing job started with parse_typescript_project({ async: true }).

Returns:
- Job status (pending/running/completed/failed)
- Progress: phase, files processed, chunks completed
- Nodes and edges imported so far
- Final result on completion or error message on failure

Use this to poll for progress when parsing large codebases asynchronously.`,
  },
  [TOOL_NAMES.listProjects]: {
    title: 'List Projects',
    description: `List all parsed projects in the database with their IDs, names, and paths.

Returns:
- projectId: The full project ID (e.g., "proj_a1b2c3d4e5f6")
- name: Friendly project name from package.json (e.g., "backend")
- path: Full filesystem path to the project
- updatedAt: When the project was last parsed

Use the name or path in other tools instead of the cryptic projectId.`,
  },
  [TOOL_NAMES.startWatchProject]: {
    title: 'Start Watch Project',
    description: `Start watching a project for file changes and automatically update the graph.

**Parameters:**
- projectPath (required): Absolute path to the project root
- tsconfigPath (required): Path to tsconfig.json
- projectId (optional): Custom project ID (auto-generated if omitted)
- debounceMs (optional): Delay before processing changes (default: 1000ms)

**Behavior:**
- Watches for .ts file changes (add/change/delete)
- Automatically triggers incremental graph updates
- Sends MCP notifications for progress updates
- Excludes node_modules, dist, build, .git, *.d.ts, *.js

**Usage:**
start_watch_project({ projectPath: "/path/to/project", tsconfigPath: "/path/to/project/tsconfig.json" })

Use list_watchers to see active watchers, stop_watch_project to stop.`,
  },
  [TOOL_NAMES.stopWatchProject]: {
    title: 'Stop Watch Project',
    description: `Stop watching a project for file changes.

**Parameters:**
- projectId (required): Project ID to stop watching

**Usage:**
stop_watch_project({ projectId: "proj_abc123..." })

Use list_watchers to see active watchers.`,
  },
  [TOOL_NAMES.listWatchers]: {
    title: 'List Watchers',
    description: `List all active file watchers.

Returns information about each watcher:
- projectId: The project being watched
- projectPath: File system path
- status: active, paused, or error
- debounceMs: Configured debounce delay
- pendingChanges: Number of queued file changes
- lastUpdateTime: When the graph was last updated
- errorMessage: Error details if status is "error"

Use stop_watch_project to stop a watcher.`,
  },
  [TOOL_NAMES.detectDeadCode]: {
    title: 'Detect Dead Code',
    description: `Identify potentially unused code in the codebase including exports never imported, private methods never called, and orphan interfaces.

**Before analyzing:**
Use list_projects to see available projects and get the project name.

Returns:
- Risk level (LOW/MEDIUM/HIGH/CRITICAL) based on dead code count
- Dead code items with confidence levels (HIGH/MEDIUM/LOW) and categories
- Grouped by type (methods, classes, interfaces, etc.)
- Grouped by category (library-export, ui-component, internal-unused)
- Affected files list
- Excluded entry points for audit (controllers, modules, etc.)

Parameters:
- projectId: Project name, path, or ID (required)
- excludePatterns: Additional file patterns to exclude (e.g., ["*.config.ts", "*.seed.ts"])
- excludeSemanticTypes: Additional semantic types to exclude (e.g., ["EntityClass", "DTOClass"])
- excludeLibraryExports: Exclude all items from packages/* directories (default: false)
- excludeCoreTypes: Exclude specific AST types (e.g., ["InterfaceDeclaration", "EnumDeclaration"])
- includeEntryPoints: Include excluded entry points in audit section (default: true)
- minConfidence: Minimum confidence to include (LOW/MEDIUM/HIGH, default: LOW)
- filterCategory: Filter by category (library-export, ui-component, internal-unused, all) (default: all)
- summaryOnly: Return only statistics without full dead code list (default: false)
- limit: Maximum items per page (default: 100, max: 500)
- offset: Number of items to skip for pagination (default: 0)

**Categories:**
- library-export: Exports from packages/* directories (may be used by external consumers)
- ui-component: Exports from components/ui/* (component library, intentionally broad API)
- internal-unused: Regular internal code that appears unused

**Auto-excluded entry points:**
- Semantic types: NestController, NestModule, NestGuard, NestPipe, NestInterceptor, NestFilter, NestProvider, NestService, HttpEndpoint
- File patterns: main.ts, *.module.ts, *.controller.ts, index.ts

**Confidence levels:**
- HIGH: Exported but never imported or referenced
- MEDIUM: Private with no internal calls
- LOW: Could be used dynamically

Use filterCategory=internal-unused for actionable dead code cleanup.`,
  },
  [TOOL_NAMES.detectDuplicateCode]: {
    title: 'Detect Duplicate Code',
    description: `Find duplicate code patterns using structural (AST hash) and semantic (embedding similarity) analysis.

**Before analyzing:**
Use list_projects to see available projects and get the project name.

Returns:
- Duplicate groups with similarity scores
- Confidence levels (HIGH/MEDIUM/LOW)
- Grouped by detection type (structural, semantic)
- Recommendations for each duplicate group
- Affected files list

Parameters:
- projectId: Project name, path, or ID (required)
- type: Detection approach - "structural", "semantic", or "all" (default: all)
- minSimilarity: Minimum similarity for semantic duplicates (0.5-1.0, default: 0.80)
- includeCode: Include source code snippets (default: false)
- maxResults: Maximum duplicate groups per page (default: 20, max: 100)
- scope: Node types to analyze - "methods", "functions", "classes", or "all" (default: all)
- summaryOnly: Return only statistics without full duplicates list (default: false)
- offset: Number of groups to skip for pagination (default: 0)

**Detection Types:**
- structural: Finds exact duplicates by normalized code hash (ignores formatting, variable names, literals)
- semantic: Finds similar code using embedding similarity (catches different implementations of same logic)
- all: Runs both detection types

**Similarity Thresholds:**
- 0.90+: Very high similarity, almost certainly duplicates
- 0.85-0.90: High similarity, likely duplicates with minor variations
- 0.80-0.85: Moderate similarity, worth reviewing

Use this to identify refactoring opportunities and reduce code duplication.`,
  },
  [TOOL_NAMES.swarmPheromone]: {
    title: 'Swarm Pheromone',
    description: `Leave a pheromone marker on a code node for stigmergic coordination between agents.

**What is Stigmergy?**
Agents coordinate indirectly by leaving markers (pheromones) on code nodes. Other agents sense these markers and adapt their behavior. No direct messaging needed.

**Pheromone Types:**
- exploring: "I'm looking at this" (2 min half-life)
- modifying: "I'm actively working on this" (10 min half-life)
- claiming: "This is my territory" (1 hour half-life)
- completed: "I finished work here" (24 hour half-life)
- warning: "Danger - don't touch" (never decays)
- blocked: "I'm stuck on this" (5 min half-life)
- proposal: "Proposed artifact awaiting approval" (1 hour half-life)
- needs_review: "Someone should check this" (30 min half-life)

**Parameters:**
- nodeId: The code node ID to mark
- type: Type of pheromone (see above)
- agentId: Your unique agent identifier
- swarmId: Swarm ID from orchestrator (for bulk cleanup)
- intensity: 0.0-1.0, how strong the signal (default: 1.0)
- data: Optional metadata (summary, reason, etc.)
- remove: Set true to remove the pheromone

**Workflow states** (exploring, claiming, modifying, completed, blocked) are mutually exclusive per agent+node. Setting one automatically removes others.

**Usage Pattern:**
1. Before starting work: swarm_sense to check what's claimed
2. Claim your target: swarm_pheromone({ nodeId, type: "claiming", agentId, swarmId })
3. Refresh periodically if working long
4. Mark complete: swarm_pheromone({ nodeId, type: "completed", agentId, swarmId, data: { summary: "..." } })

**Decay:**
Pheromones automatically fade over time. If an agent dies, its markers decay and work becomes available again.`,
  },
  [TOOL_NAMES.swarmSense]: {
    title: 'Swarm Sense',
    description: `Query pheromones in the code graph to sense what other agents are doing.

**What This Does:**
Returns active pheromones with their current intensity (after decay). Use this to:
- See what nodes are being worked on
- Avoid conflicts with other agents
- Find unclaimed work
- Check if your dependencies are being modified

**Parameters:**
- swarmId: Filter by swarm ID (see only this swarm's pheromones)
- types: Filter by pheromone types (e.g., ["modifying", "claiming"])
- nodeIds: Check specific nodes
- agentIds: Filter by specific agents
- excludeAgentId: Exclude your own pheromones (see what OTHERS are doing)
- minIntensity: Minimum intensity after decay (default: 0.3)
- limit: Max results (default: 50)
- includeStats: Get summary statistics by type
- cleanup: Remove fully decayed pheromones (intensity < 0.01)

**Usage Pattern:**
\`\`\`
// Before starting work, check what's taken
swarm_sense({
  types: ["modifying", "claiming"],
  minIntensity: 0.3
})

// Check a specific node before modifying
swarm_sense({
  nodeIds: ["proj_xxx:Service:UserService"],
  types: ["modifying", "warning"]
})

// See what other agents are doing (exclude self)
swarm_sense({
  excludeAgentId: "my-agent-id",
  types: ["exploring", "modifying"]
})
\`\`\`

**Decay:**
Intensity decreases over time (exponential decay). A pheromone with intensity 0.25 is almost gone. Below minIntensity threshold, it's not returned.`,
  },
  [TOOL_NAMES.swarmCleanup]: {
    title: 'Swarm Cleanup',
    description: `Bulk delete pheromones after a swarm completes.

**When to use:**
Call this when a swarm finishes to clean up all its pheromones. Prevents pollution for future swarms.

**Parameters:**
- projectId: Required - the project
- swarmId: Delete all pheromones from this swarm
- agentId: Delete all pheromones from this specific agent
- all: Set true to delete ALL pheromones in project (use with caution)
- keepTypes: Pheromone types to preserve (default: ["warning"])
- dryRun: Preview what would be deleted without deleting

**Must specify one of:** swarmId, agentId, or all=true

**Examples:**
\`\`\`
// Clean up after a swarm completes
swarm_cleanup({ projectId: "backend", swarmId: "swarm_abc123" })

// Preview what would be deleted
swarm_cleanup({ projectId: "backend", swarmId: "swarm_abc123", dryRun: true })

// Clean up a specific agent's pheromones
swarm_cleanup({ projectId: "backend", agentId: "swarm_abc123_auth" })

// Nuclear option: delete all (except warnings)
swarm_cleanup({ projectId: "backend", all: true })
\`\`\`

**Note:** \`warning\` pheromones are preserved by default. Pass \`keepTypes: []\` to delete everything.`,
  },
  [TOOL_NAMES.swarmPostTask]: {
    title: 'Swarm Post Task',
    description: `Post a task to the swarm blackboard for agents to claim and work on.

**What is the Blackboard?**
The blackboard is a shared task queue where agents post work, claim tasks, and coordinate. Unlike pheromones (indirect coordination), tasks are explicit work items with dependencies.

**Parameters:**
- projectId: Project to post the task in
- swarmId: Group related tasks together
- title: Short task title (max 200 chars)
- description: Detailed description of what needs to be done
- type: Task category (implement, refactor, fix, test, review, document, investigate, plan)
- priority: Urgency level (critical, high, normal, low, backlog)
- targetNodeIds: Code nodes this task affects (from search_codebase)
- targetFilePaths: File paths this task affects
- dependencies: Task IDs that must complete before this task can start
- createdBy: Your agent ID
- metadata: Additional context (acceptance criteria, notes, etc.)

**Task Lifecycle:**
available → claimed → in_progress → needs_review → completed
                  ↘ blocked (if dependencies incomplete)
                  ↘ failed (if something goes wrong)

**Dependency Management:**
Tasks with incomplete dependencies are automatically marked as "blocked" and become "available" when all dependencies complete.

**Example:**
\`\`\`
swarm_post_task({
  projectId: "backend",
  swarmId: "feature_auth",
  title: "Implement JWT validation",
  description: "Add JWT token validation to the auth middleware...",
  type: "implement",
  priority: "high",
  targetNodeIds: ["proj_xxx:Class:AuthMiddleware"],
  dependencies: ["task_abc123"],  // Must complete first
  createdBy: "planner_agent"
})
\`\`\``,
  },
  [TOOL_NAMES.swarmClaimTask]: {
    title: 'Swarm Claim Task',
    description: `Claim a task from the blackboard to work on it.

**Actions:**
- claim: Reserve a task (prevents others from taking it)
- start: Begin working on a claimed task (transitions to in_progress)
- release: Give up a task you've claimed (makes it available again)

**Auto-Selection:**
If you don't specify a taskId, the tool claims the highest-priority available task matching your criteria:
- types: Only consider certain task types (e.g., ["fix", "implement"])
- minPriority: Only consider tasks at or above this priority

**Claim Flow:**
1. swarm_claim_task({ action: "claim" }) - Reserve the task
2. swarm_claim_task({ action: "start", taskId: "..." }) - Begin work
3. [Do the work]
4. swarm_complete_task({ action: "complete" }) - Finish

**Example - Claim specific task:**
\`\`\`
swarm_claim_task({
  projectId: "backend",
  swarmId: "feature_auth",
  agentId: "worker_1",
  taskId: "task_abc123",
  action: "claim"
})
\`\`\`

**Example - Auto-select highest priority:**
\`\`\`
swarm_claim_task({
  projectId: "backend",
  swarmId: "feature_auth",
  agentId: "worker_1",
  types: ["implement", "fix"],
  minPriority: "normal"
})
\`\`\`

**Releasing Tasks:**
If you can't complete a task, release it so others can pick it up:
\`\`\`
swarm_claim_task({
  projectId: "backend",
  taskId: "task_abc123",
  agentId: "worker_1",
  action: "release",
  releaseReason: "Blocked by external API issue"
})
\`\`\``,
  },
  [TOOL_NAMES.swarmCompleteTask]: {
    title: 'Swarm Complete Task',
    description: `Mark a task as completed, failed, or request review.

**Actions:**
- complete: Task finished successfully (triggers dependent tasks to become available)
- fail: Task failed (can be retried if retryable=true)
- request_review: Submit work for review before completion
- approve: Reviewer approves the work (completes the task)
- reject: Reviewer rejects (returns to in_progress or marks failed)
- retry: Make a failed task available again

**Completing with Artifacts:**
\`\`\`
swarm_complete_task({
  projectId: "backend",
  taskId: "task_abc123",
  agentId: "worker_1",
  action: "complete",
  summary: "Implemented JWT validation with RS256 signing",
  artifacts: {
    files: ["src/auth/jwt.service.ts"],
    commits: ["abc123"],
    pullRequests: ["#42"]
  },
  filesChanged: ["src/auth/jwt.service.ts", "src/auth/auth.module.ts"],
  linesAdded: 150,
  linesRemoved: 20
})
\`\`\`

**Request Review (for important changes):**
\`\`\`
swarm_complete_task({
  projectId: "backend",
  taskId: "task_abc123",
  agentId: "worker_1",
  action: "request_review",
  summary: "Implemented auth - needs security review",
  reviewNotes: "Please verify token expiration logic"
})
\`\`\`

**Approve/Reject (for reviewers):**
\`\`\`
swarm_complete_task({
  projectId: "backend",
  taskId: "task_abc123",
  agentId: "reviewer_1",
  action: "approve",
  reviewerId: "reviewer_1",
  notes: "LGTM"
})
\`\`\`

**Failing a Task:**
\`\`\`
swarm_complete_task({
  projectId: "backend",
  taskId: "task_abc123",
  agentId: "worker_1",
  action: "fail",
  reason: "External API is down",
  errorDetails: "ConnectionTimeout after 30s",
  retryable: true
})
\`\`\``,
  },
  [TOOL_NAMES.swarmGetTasks]: {
    title: 'Swarm Get Tasks',
    description: `Query tasks from the blackboard with filters.

**Basic Usage:**
\`\`\`
// Get all available tasks in a swarm
swarm_get_tasks({
  projectId: "backend",
  swarmId: "feature_auth",
  statuses: ["available"]
})

// Get a specific task with full details
swarm_get_tasks({
  projectId: "backend",
  taskId: "task_abc123"
})

// Get your claimed/in-progress tasks
swarm_get_tasks({
  projectId: "backend",
  claimedBy: "worker_1",
  statuses: ["claimed", "in_progress"]
})
\`\`\`

**Filters:**
- swarmId: Filter by swarm
- statuses: Task statuses (available, claimed, in_progress, blocked, needs_review, completed, failed, cancelled)
- types: Task types (implement, refactor, fix, test, review, document, investigate, plan)
- claimedBy: Agent who has the task
- createdBy: Agent who created the task
- minPriority: Minimum priority level

**Sorting:**
- priority: Highest priority first (default)
- created: Newest first
- updated: Most recently updated first

**Additional Data:**
- includeStats: true - Get aggregate statistics (counts by status, type, agent)
- includeDependencyGraph: true - Get task dependency graph for visualization

**Example with stats:**
\`\`\`
swarm_get_tasks({
  projectId: "backend",
  swarmId: "feature_auth",
  includeStats: true
})
// Returns: { tasks: [...], stats: { byStatus: {available: 5, in_progress: 2}, ... } }
\`\`\``,
  },
  [TOOL_NAMES.swarmOrchestrate]: {
    title: 'Swarm Orchestrate',
    description: `Orchestrate multiple agents to tackle complex, multi-file code tasks in parallel.

**What This Does:**
Spawns and coordinates multiple LLM worker agents to execute complex codebase changes. Uses the code graph to understand dependencies and the swarm system for coordination.

**Example Tasks:**
- "Rename getUserById to fetchUser across the codebase"
- "Add JSDoc comments to all exported functions in src/core/"
- "Convert all class components to functional React components"
- "Add deprecation warnings to all v1 API endpoints"

**How It Works:**
1. **Analyze** - Uses search_codebase to find affected nodes and impact_analysis for dependencies
2. **Plan** - Decomposes task into atomic, dependency-ordered SwarmTasks
3. **Spawn** - Starts N worker agents that claim tasks and leave pheromones
4. **Monitor** - Tracks progress, detects blocked agents, enables self-healing
5. **Complete** - Aggregates results and cleans up pheromones

**Parameters:**
- projectId: Project to operate on
- task: Natural language description of the task
- maxAgents: Maximum concurrent worker agents (default: 3)
- dryRun: If true, only plan without executing (default: false)
- autoApprove: Skip approval step for each task (default: false)
- priority: Overall priority level (critical, high, normal, low, backlog)

**Self-Healing:**
- Pheromone decay automatically frees stuck work
- Failed tasks become available for retry
- Blocked agents release tasks for others

**Example:**
\`\`\`
swarm_orchestrate({
  projectId: "backend",
  task: "Add JSDoc comments to all exported functions in src/services/",
  maxAgents: 3,
  dryRun: false
})
\`\`\`

**Returns:**
- swarmId: Unique identifier for this swarm run
- status: planning | executing | completed | failed
- plan: Task breakdown with dependency graph
- progress: Real-time completion stats
- results: Summary of changes made`,
  },
} as const;

// Default Values
export const DEFAULTS = {
  traversalDepth: 3,
  skipOffset: 0,
  batchSize: 500,
  maxResultsDisplayed: 30,
  codeSnippetLength: 500, // Reduced from 1000 to control output size
  chainSnippetLength: 700,
  maxEmbeddingChars: 30000, // ~7500 tokens, under 8192 limit for text-embedding-3-large
} as const;

// Parsing Configuration
export const PARSING = {
  /** File count threshold to trigger parallel parsing with worker pool */
  parallelThreshold: 500,
  /** File count threshold to trigger streaming import */
  streamingThreshold: 100,
  /** Default number of files per chunk */
  defaultChunkSize: 100,
  /** Worker timeout in milliseconds (30 minutes) */
  workerTimeoutMs: 30 * 60 * 1000,
} as const;

// Job Management
export const JOBS = {
  /** Interval for cleaning up completed/stale jobs (5 minutes) */
  cleanupIntervalMs: 5 * 60 * 1000,
  /** Maximum number of jobs to keep in memory */
  maxJobs: 100,
} as const;

// Watch Mode Configuration
export const WATCH = {
  /** Default debounce delay before processing file changes */
  defaultDebounceMs: 1000,
  /** Maximum concurrent file watchers */
  maxWatchers: 10,
  /** Maximum pending file change events before dropping */
  maxPendingEvents: 1000,
  /** Default exclude patterns for file watching */
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/*.d.ts',
    '**/*.js',
    '**/*.map',
  ],
} as const;

// Messages
export const MESSAGES = {
  errors: {
    noRelevantCode: 'No relevant code found.',
    serviceNotInitialized:
      'ERROR: Natural Language to Cypher service is not initialized yet. Please try again in a few moments.',
    connectionTestFailed: 'Connection test failed',
    neo4jRequirement: 'Note: This server requires Neo4j with APOC plugin installed',
    genericError: 'ERROR:',
  },
  success: {
    hello: 'Hello from codebase MCP!',
    parseSuccess: 'SUCCESS:',
    partialSuccess: 'PARTIAL SUCCESS:',
  },
  queries: {
    naturalLanguagePrefix: 'Natural Language Query:',
    cypherQueryHeader: 'Generated Cypher Query',
    queryResultsHeader: 'Query Results',
    noResultsFound: 'No results found for this query.',
    moreResultsIndicator: '_... and {} more results_',
    summaryPrefix: '**Summary:** Executed query and found {} results.',
  },
  neo4j: {
    connectionTest: 'RETURN "Connected!" as message, datetime() as timestamp',
    apocTest: 'CALL apoc.help("apoc") YIELD name RETURN count(name) as apocFunctions',
    connectionSuccess: 'Neo4j connected: {} at {}\nAPOC plugin available with {} functions',
  },
  server: {
    starting: '=== MCP Server Starting ===',
    connected: '=== MCP Server Connected and Running ===',
    creatingTransport: 'Creating transport...',
    connectingTransport: 'Connecting server to transport...',
    startingServer: 'Starting MCP server...',
  },
} as const;
