# Known Issues

## NL-to-Cypher Service

### 1. NL-to-Cypher requires OpenAI but no guard prevents init attempt
**Status:** Fixed
**Severity:** Medium
**Files:** `src/mcp/service-init.ts`, `src/mcp/tools/natural-language-to-cypher.tool.ts`

`initializeNaturalLanguageService()` is now guarded behind `isOpenAIAvailable()` (i.e. `OPENAI_API_KEY` presence). When the key is absent, the service is skipped and the tool returns a clear message: "natural_language_to_cypher requires OPENAI_API_KEY. Set it and restart the MCP server to enable this tool." The old `OPENAI_ENABLED` var has been renamed to `OPENAI_EMBEDDINGS_ENABLED` to separate embedding control from NL-to-Cypher control.

### 2. Discovery queries missing `projectId` parameter
**Status:** Fixed
**Severity:** High
**Files:** `src/mcp/service-init.ts`

`discoverSchemaFromGraph()` now accepts a `projectId` parameter and passes it to all four DISCOVER_* queries. `initializeNeo4jSchema()` queries for the most recently parsed project via `LIST_PROJECTS_QUERY` and passes its ID. If no projects exist, discovery is skipped gracefully.

### 3. Error objects serialize as `{}` in debug logs
**Status:** Fixed
**Severity:** Low
**Files:** `src/core/utils/file-utils.ts`

Added `serializeForLog()` helper inside `debugLog` that converts Error objects to `{ name, message, stack }` before JSON.stringify. Handles both direct Error arguments and nested Errors in object properties. All ~40 call sites benefit automatically.

## Known Limitations

### NL-to-Cypher requires OpenAI API key
**Status:** Known limitation
**Severity:** Info

The `natural_language_to_cypher` tool uses the OpenAI Assistants API (GPT-4) and cannot run locally. Without `OPENAI_API_KEY`, the tool is disabled with a clear message. Future options: Ollama integration, local LLM via sidecar, or template-based fallback.
