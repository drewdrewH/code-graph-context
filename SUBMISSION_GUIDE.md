# Submission Guide for Code Graph Context

This guide covers submitting your project to registries and directories for organic discovery.

---

## 1. MCP Registry Submission (HIGHEST PRIORITY)

**File prepared:** `mcp-registry-submission.json`

### Steps:
1. Go to https://github.com/modelcontextprotocol/registry
2. Click "Fork" (top right)
3. In your fork, navigate to `/src/servers/` directory
4. Click "Add file" → "Create new file"
5. Name it: `code-graph-context.json`
6. Copy contents from `mcp-registry-submission.json` into it
7. Commit with message: "Add code-graph-context MCP server"
8. Click "Contribute" → "Open pull request"
9. Title: "Add code-graph-context MCP server"
10. Description:
```
Adding Code Graph Context - a framework-aware code analysis MCP server.

- Neo4j-based code graph with semantic search
- Extensible framework schema system
- Natural language to Cypher queries
- TypeScript/NestJS support

Repository: https://github.com/drewdrewH/code-graph-context
License: MIT
```

**Impact:** Automatic listing in GitHub MCP Registry + official MCP directory

---

## 2. Awesome MCP Servers Lists

### A. punkpeye/awesome-mcp-servers
**URL:** https://github.com/punkpeye/awesome-mcp-servers

**Steps:**
1. Fork the repository
2. Edit `README.md`
3. Find the appropriate category (likely "Developer Tools" or "Code Analysis")
4. Add your entry:
```markdown
- [code-graph-context](https://github.com/drewdrewH/code-graph-context) - Framework-aware code analysis using Neo4j graphs with semantic search and natural language querying.
```
5. Submit PR with title: "Add code-graph-context"

---

### B. appcypher/awesome-mcp-servers
**URL:** https://github.com/appcypher/awesome-mcp-servers

**Steps:**
1. Fork the repository
2. Edit `README.md`
3. Add under "Developer Tools" or "Code Analysis" section:
```markdown
### code-graph-context
Framework-aware TypeScript/NestJS code analysis using Neo4j graphs. Features semantic search, natural language to Cypher conversion, and extensible framework schemas.

[GitHub](https://github.com/drewdrewH/code-graph-context)
```
4. Submit PR with title: "Add code-graph-context"

---

## 3. Neo4j Community Forum

**URL:** https://community.neo4j.com/c/projects-collaboration/9

**Steps:**
1. Create account at https://community.neo4j.com/
2. Go to Projects & Collaboration category
3. Click "New Topic"
4. Title: "Code Graph Context - Framework-aware TypeScript code analysis MCP server"
5. Post:
```
I built a Model Context Protocol (MCP) server that uses Neo4j to analyze TypeScript/NestJS codebases with framework-aware semantic understanding.

**What it does:**
Transforms code into a queryable Neo4j graph with dual schemas:
- AST-level nodes (classes, methods, properties)
- Framework-level semantics (controllers, services, repositories)

**Neo4j Features Used:**
- Vector indexing for semantic search
- APOC procedures for graph operations
- Cypher for relationship queries
- neo4j-driver for Node.js

**Key Capabilities:**
- Extensible framework schema system
- Natural language → Cypher conversion
- Graph traversal for dependency analysis
- Semantic search with OpenAI embeddings

**Tech Stack:**
TypeScript, Neo4j 5.x, APOC, OpenAI, Model Context Protocol

**Use Cases:**
- "What services use this repository?"
- "Show HTTP endpoint dependency chains"
- "Find all classes implementing this interface"
- Impact analysis for refactoring

**Open Source:** MIT licensed
**GitHub:** https://github.com/drewdrewH/code-graph-context

Happy to discuss the graph schema design and optimization strategies!
```

**Impact:** Neo4j may feature it in their Developer Newsletter

---

## 4. GitHub Topics (Done via Web UI)

**URL:** https://github.com/drewdrewH/code-graph-context

**Steps:**
1. Go to your repository
2. Click the gear icon next to "About" (top right)
3. In the "Topics" field, add:
```
mcp-server
model-context-protocol
code-analysis
neo4j
graph-database
typescript
nestjs
ast-parser
semantic-search
openai
embeddings
graph-rag
code-graph
framework-aware
```
4. Click "Save changes"

**Impact:** Shows up in GitHub topic searches, improves discoverability

---

## 5. NPM Package Publishing (Future)

Once ready to publish to npm:

```bash
npm login
npm publish
```

**Impact:**
- Users can install via `npm install -g code-graph-context`
- Listed on npmjs.com
- Shows up in npm searches

---

## Priority Order

1. ✅ **Package.json keywords** - Already updated
2. 🔴 **GitHub Topics** - Do this now (2 minutes)
3. 🔴 **MCP Registry** - Critical for MCP users (10 minutes)
4. 🟡 **Awesome MCP Lists** - Good for SEO (15 minutes)
5. 🟡 **Neo4j Community** - Tagged projects get featured (10 minutes)
6. 🟢 **NPM Publish** - When stable for public use

---

## Expected Traffic Sources

After submissions:
- **MCP Registry:** Users browsing official MCP servers
- **GitHub Topics:** Developers searching for "mcp-server", "neo4j", "code-analysis"
- **Awesome Lists:** Curated list readers
- **Neo4j Community:** Featured in newsletters, shared by Neo4j DevRel
- **NPM:** Package searches
- **Google:** SEO from above links

---

## Tracking

Watch for traffic from:
- GitHub Insights → Traffic → Referring sites
- npm downloads (if published)
- GitHub stars/forks
- Issue/PR activity
