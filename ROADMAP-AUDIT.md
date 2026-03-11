# Code Graph Context — Roadmap Audit

Audit of the "7 Critical Gaps" assessment, ranked by **bang-for-buck** (impact / effort).
Where I disagree with the original assessment, I say so and explain why.

---

## Ranking Key

| Effort | Meaning |
|--------|---------|
| **Trivial** | < 1 hour, single file change |
| **Small** | 1-3 hours, few files |
| **Medium** | 1-3 days |
| **Large** | 1-2 weeks |
| **Massive** | 3+ weeks, architectural change |

| Impact | Meaning |
|--------|---------|
| **Critical** | Directly improves core value proposition |
| **High** | Meaningfully improves UX or adoption |
| **Medium** | Nice-to-have, noticeable improvement |
| **Low** | Marginal or speculative benefit |

---

## Tier S — Do Immediately (highest bang-for-buck)

### 1. Fix hardcoded `limit: 1` in search_codebase
- **File:** `src/mcp/tools/search-codebase.tool.ts:96`
- **Effort:** Trivial (change one number, adjust response formatting)
- **Impact:** Critical
- **Why:** This is the most-used tool. Returning only 1 vector match means if the top match isn't the right entry point, the entire search fails. Return top 3-5 matches with scores, let the LLM pick the best traversal root. This is a 10-minute fix that substantially improves search quality.
- **How:** Change `limit: 1` → `limit: 3`, return all matches with similarity scores, traverse from the best one but show the others as alternative entry points.

### 2. Make swarm tools opt-in (not extract to separate package)
- **Effort:** Small (add a flag/env var to skip registration)
- **Impact:** High
- **Why:** The assessment says "extract to separate package" — that's over-engineering. The real problem is tool noise: 7 swarm + 5 session tools = 12 tools most users never need. Just gate them behind `ENABLE_SWARM=true` and `ENABLE_SESSION=true` env vars. Default off. Core tool count drops from 25 → 13, which is a much cleaner LLM experience.
- **Disagreement:** Don't delete or extract the swarm. It's a genuine differentiator. Just don't show it by default. The assessment undervalues it — multi-agent coordination via MCP is novel and worth keeping.

### 3. Add a `topK` parameter to search_codebase
- **Effort:** Small (expose the existing `limit` as a user-facing param)
- **Impact:** High
- **Why:** Even after fixing the hardcoded limit, users should control how many results they want. Some queries need 1 precise match, others need 5 candidates. The internal plumbing already supports this — just expose it.

---

## Tier A — Do Soon (high impact, moderate effort)

### 4. Test suite — parser + integration tests
- **Effort:** Medium (2-3 days for meaningful coverage)
- **Impact:** Critical (unlocks safe refactoring for everything else)
- **Why:** Agree completely with the assessment. Without tests, every change below is risky. Priority order:
  1. **Parser unit tests** — feed known TS snippets through `typescript-parser.ts`, assert correct nodes/edges
  2. **Tool integration tests** — mock Neo4j, verify tool input/output contracts
  3. **Fixture project** — a small TS project in `test/fixtures/` that exercises all parser paths
- **Skip:** Don't bother with e2e tests against real Neo4j yet. Unit + integration is enough.

### 5. Local embeddings option (replace OpenAI requirement)
- **Effort:** Medium-Large (2-4 days: integrate @huggingface/transformers, handle dimension differences, test quality)
- **Impact:** High
- **Why:** The OpenAI key is the real adoption friction, not Docker. Most developers who'd use an MCP code analysis tool already have Docker. But requiring an OpenAI key means:
  - Costs money per parse
  - Requires signup/billing for a competing AI provider
  - API key management friction
- **How:** Use `@huggingface/transformers` with `all-MiniLM-L6-v2` (384 dims). Make it the default. Keep OpenAI as the premium option for better quality. Need a separate vector index for different dimensions.
- **Disagreement with assessment:** The assessment bundles "SQLite + local embeddings" together. Decouple them. Local embeddings alone removes 80% of the friction without touching the storage layer.

### 6. Git diff integration — `analyze_diff` tool
- **Effort:** Medium (you already have `impact_analysis` — this wraps it with git diff parsing)
- **Impact:** Critical
- **Why:** This is the killer feature the assessment correctly identifies. The workflow is:
  1. Developer makes changes, runs `analyze_diff`
  2. Tool parses the git diff, identifies changed nodes in the graph
  3. Runs impact_analysis on each changed node
  4. Returns: what breaks, what needs updating, which tests to run
- **This is the clearest "why graph > file reading" demo.** File-reading Claude can't do transitive dependency analysis from a diff.

---

## Tier B — Do When Ready (moderate impact, worth the effort)

### 7. AST-aware context formatting
- **Effort:** Medium
- **Impact:** Medium-High
- **Why:** The current truncation (`first 500 + last 500` chars) is naive. Cutting mid-expression wastes context tokens and confuses the LLM. Better approach:
  - Show method/function signatures always
  - Show decorator metadata always (especially for NestJS)
  - Truncate method bodies intelligently (show first few lines + `...`)
- **Also:** Add a `format: "compact" | "full" | "signatures"` param to traversal tools.

### 8. Architecture visualization (Mermaid diagrams)
- **Effort:** Small-Medium (you have the graph data, Mermaid is string concatenation)
- **Impact:** Medium
- **Why:** This is a legitimate differentiator — no file-reading tool can produce a dependency diagram. Add a `visualize` tool or a `format: "mermaid"` option on traverse_from_node. Start with simple flowcharts showing call chains.
- **Don't over-engineer:** Class diagrams, sequence diagrams, etc. can come later. Start with `graph TD` showing node relationships.

### 9. Benchmark/demo showing graph > file-reading
- **Effort:** Medium (create fixture project, record both approaches, document)
- **Impact:** High for adoption, zero for functionality
- **Why:** The assessment is right that "why can't Claude just read my files?" is the question. A concrete demo in the README showing:
  - "Find all callers of `UserService.createUser`" — Claude with files: 8 tool calls, misses 2. Graph: 1 tool call, finds all 12.
  - "What breaks if I rename `AuthGuard`?" — Claude with files: can't answer. Graph: shows 23 affected routes.
- **Caveat:** Don't fabricate numbers. Run real comparisons on a real (or realistic fixture) project.

### 10. Parse `package.json` dependency graph
- **Effort:** Small
- **Impact:** Medium
- **Why:** This is the only ecosystem parsing suggestion worth doing now. Understanding which packages a project uses (and which are dev vs prod) helps the LLM give better advice. Also enables detecting unused dependencies.
- **Skip Prisma, GraphQL, env files for now.** They're niche and add parser maintenance burden. Revisit when you have multi-language plans.

---

## Tier C — Do Later or Conditionally

### 11. SQLite as default storage (replace Neo4j requirement)
- **Effort:** Massive (rewrite entire storage layer, replace Cypher queries, implement graph traversal in SQL, vector search alternative)
- **Impact:** High for casual adoption
- **Why I'd defer this:** The assessment treats this as Tier 1, but I disagree on timing. Here's why:
  - Neo4j is genuinely better for graph queries. Cypher traversals are 10-100x simpler to write than recursive SQL CTEs.
  - Your 830-line `neo4j.service.ts` with dozens of Cypher queries would need complete rewriting.
  - `sqlite-vec` is immature and the ecosystem is thin.
  - **The real question:** Who is your user? If it's "every TS developer" — yes, SQLite matters. If it's "power users who already use Claude Code with MCP" — they can handle Docker.
- **Compromise:** Consider a read-only SQLite export for sharing graph snapshots, not a full SQLite backend.

### 12. `npx code-graph-context` zero-config mode
- **Effort:** Medium (but only useful if you do SQLite or offer a hosted Neo4j)
- **Impact:** High for adoption, blocked by Neo4j requirement
- **Why defer:** Without SQLite, `npx` still needs Docker + Neo4j running. The zero-config dream requires solving storage first. Until then, this is aspirational.
- **Quick win alternative:** Improve the `init` command to auto-pull Docker image and auto-start — reduce setup to `npm i -g code-graph-context && code-graph-context init && code-graph-context status`.

### 13. PR review context tool
- **Effort:** Medium
- **Impact:** Medium
- **Why:** Overlaps heavily with the `analyze_diff` tool (#6). If you build #6 well, PR review context falls out naturally. Don't build a separate PR tool — extend analyze_diff to accept PR URLs via `gh` CLI.

### 14. Test-to-code mapping
- **Effort:** Large (need to parse test files, resolve imports to source, build coverage edges)
- **Impact:** Medium-High
- **Why defer:** Cool feature but the parser doesn't currently distinguish test files from source files. You'd need heuristics (file path patterns, test framework imports) plus new edge types (TESTS, COVERS). Worth doing eventually but not before tests, local embeddings, and diff analysis.

---

## Tier D — Skip or Radically Rethink

### 15. Multi-language via Tree-sitter
- **Effort:** Massive
- **Impact:** Low for current users
- **Why skip:** Your competitive advantage IS TypeScript depth. ts-morph gives you full type information that Tree-sitter can't match. Going multi-language with Tree-sitter means trading depth for breadth — and breadth is where Sourcegraph already wins. Stay deep on TypeScript, expand to TS ecosystem files (package.json, tsconfig) instead.

### 16. SCIP compatibility
- **Effort:** Massive
- **Impact:** Low
- **Why skip:** SCIP is Sourcegraph's format. Adopting it ties you to their ecosystem without clear benefit. Your graph schema is richer (semantic types, framework patterns) than what SCIP captures. If interop matters later, export to SCIP — don't restructure around it.

### 17. CI integration (auto-parse on push)
- **Effort:** Large
- **Impact:** Low for current adoption level
- **Why skip for now:** You need users before you need CI. CI integration matters for teams with shared Neo4j instances — a use case that doesn't exist yet. Revisit when you have 3+ team users.

### 18. Type-flow tracking
- **Effort:** Massive (essentially building a type checker)
- **Impact:** Medium
- **Why skip:** ts-morph already exposes TypeScript's type system. Full type-flow tracking means re-implementing inference that `tsc` already does. Instead, leverage ts-morph's `.getType()` on nodes and store return types as node properties — much cheaper, 80% of the value.
- **Quick win version:** Store resolved return types on FunctionDeclaration/MethodDeclaration nodes during parsing. This is Small effort and gives you type info in traversals without building a type checker.

---

## Corrections to the Original Assessment

| Claim | Reality |
|-------|---------|
| "9 swarm tools (36% of surface)" | 7 swarm tools + 5 session tools = 12/25. Session tools are useful for single-user workflows too. |
| "No proven workflow for swarm" | The `/skills/swarm/SKILL.md` defines a concrete protocol. It works but requires Claude Code with multiple agents. |
| "Docker is a dealbreaker" | For casual devs, yes. For MCP power users (your actual audience), Docker is already on their machine. |
| "SQLite + local embeddings as Tier 1" | Decouple these. Local embeddings = Tier A (days). SQLite storage = Tier C (weeks). |
| "Ecosystem parsing (Prisma, GraphQL)" | Over-scoped. Only package.json is worth it now. Prisma/GraphQL are niche. |
| "Source code snippets default to 500-700 chars" | Actually defaults to `DEFAULTS.codeSnippetLength` (configurable), truncation is first 500 + last 500 = 1000 chars for full mode. |

---

## Suggested Execution Order

```
Phase 1 (This Week) — Quick Wins
├── #1  Fix limit:1 → limit:3
├── #2  Gate swarm/session tools behind env vars
└── #3  Add topK parameter to search_codebase

Phase 2 (Next 1-2 Weeks) — Foundation
├── #4  Test suite (parser + integration)
└── #5  Local embeddings option

Phase 3 (Next 2-4 Weeks) — Differentiation
├── #6  analyze_diff tool (git diff → impact analysis)
├── #7  AST-aware context formatting
└── #8  Mermaid architecture visualization

Phase 4 (Next 1-2 Months) — Adoption
├── #9  Benchmark demo for README
├── #10 Parse package.json dependencies
└── #12 Improve CLI init flow

Phase 5 (Quarterly) — Evaluate
├── #11 SQLite mode (only if adoption data demands it)
├── #14 Test-to-code mapping
└── #13 PR review via analyze_diff extension
```

---

## The Bottom Line

The original assessment is mostly correct but over-indexes on adoption friction (SQLite, zero-config) at the expense of core quality (search accuracy, context formatting, testing). For a tool at v2.8.0 with an established npm package, the priority should be:

1. **Make what exists work better** (fix limit:1, reduce tool noise, improve context output)
2. **Prove it's better than alternatives** (tests, benchmarks, diff analysis)
3. **Then** reduce setup friction (local embeddings, better CLI)
4. **Last** add new capabilities (ecosystem parsing, visualization)

The core graph insight is sound. Focus on making the existing 13 core tools excellent before expanding the surface area.
