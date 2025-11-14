# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-13

### Added
- Initial release of Code Graph Context MCP server
- TypeScript/NestJS codebase parsing with AST analysis
- Neo4j graph storage with vector indexing
- Semantic search using OpenAI embeddings
- 6 MCP tools for code exploration:
  - `hello` - Test connection
  - `test_neo4j_connection` - Verify Neo4j connectivity
  - `parse_typescript_project` - Parse codebases into graph
  - `search_codebase` - Vector-based semantic search
  - `traverse_from_node` - Graph relationship traversal
  - `natural_language_to_cypher` - AI-powered Cypher query generation
- Framework-aware parsing for NestJS patterns
- Custom framework schema system (with FairSquare example)
- Auto-detection of project framework types
- Docker Compose setup for Neo4j with APOC plugin
- Comprehensive README with examples and workflows

### Framework Support
- NestJS (Controllers, Services, Modules, Guards, Pipes, Interceptors, DTOs, Entities)
- FairSquare custom framework (example implementation)
- Vanilla TypeScript projects

### Infrastructure
- MIT License
- Contributing guidelines
- Example projects and custom framework templates
- Environment configuration via `.env`
- Debug logging for troubleshooting

## [Unreleased]

### Planned
- Automated testing infrastructure
- Additional framework schemas (React, Angular, Vue)
- Multi-language support (Python, Java, C#)
- Performance optimizations for large codebases
- CI/CD pipelines
- Real-time file watching and incremental updates

---

[0.1.0]: https://github.com/drewdrewH/code-graph-context/releases/tag/v0.1.0
