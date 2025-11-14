import { TypeScriptParser } from './dist/core/parsers/typescript-parser-v2.js';
import { FAIRSQUARE_FRAMEWORK_SCHEMA } from './dist/core/config/fairsquare-framework-schema.js';
import { CORE_TYPESCRIPT_SCHEMA } from './dist/core/config/graph-v2.js';

async function test() {
  const parser = new TypeScriptParser(
    '/Users/ahernandez/develop/fairsquare/src',
    '/Users/ahernandez/develop/fairsquare/tsconfig.base.json',
    CORE_TYPESCRIPT_SCHEMA,
    [FAIRSQUARE_FRAMEWORK_SCHEMA],
    {
      excludePatterns: ['node_modules/', 'dist/', '.spec.ts', '.test.ts'],
    }
  );

  console.log('Starting parse...');
  const result = await parser.parseWorkspace();

  console.log('\n=== STATISTICS ===');
  console.log(`Total nodes: ${result.nodes.length}`);
  console.log(`Total edges: ${result.edges.length}`);

  // Count by semantic type
  const nodesBySemanticType: Record<string, number> = {};
  for (const node of result.nodes) {
    const semType = node.properties.semanticType || 'none';
    nodesBySemanticType[semType] = (nodesBySemanticType[semType] || 0) + 1;
  }

  console.log('\n=== NODES BY SEMANTIC TYPE ===');
  Object.entries(nodesBySemanticType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`${type}: ${count}`);
    });

  // Check Services with dependencies
  console.log('\n=== SERVICES WITH DEPENDENCIES ===');
  const services = result.nodes.filter(n => n.properties.semanticType === 'Service');
  console.log(`Total Services: ${services.length}`);

  for (const service of services.slice(0, 5)) {
    console.log(`\n${service.properties.name}:`);
    console.log(`  dependencies: ${JSON.stringify(service.properties.context?.dependencies || [])}`);
    console.log(`  dependencyCount: ${service.properties.context?.dependencyCount || 0}`);
  }

  // Check Repositories
  console.log('\n=== REPOSITORIES ===');
  const repos = result.nodes.filter(n => n.properties.semanticType === 'Repository');
  console.log(`Total Repositories: ${repos.length}`);

  for (const repo of repos.slice(0, 5)) {
    console.log(`\n${repo.properties.name}:`);
    console.log(`  File: ${repo.properties.filePath.split('/').slice(-3).join('/')}`);
  }

  // Count edges by type
  const edgesByType: Record<string, number> = {};
  for (const edge of result.edges) {
    const edgeType = edge.properties.semanticType || edge.type;
    edgesByType[edgeType] = (edgesByType[edgeType] || 0) + 1;
  }

  console.log('\n=== EDGES BY TYPE ===');
  Object.entries(edgesByType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`${type}: ${count}`);
    });

  // Check for USES_REPOSITORY edges
  const usesRepoEdges = result.edges.filter(e => e.type === 'USES_REPOSITORY');
  console.log(`\n=== USES_REPOSITORY EDGES: ${usesRepoEdges.length} ===`);
  for (const edge of usesRepoEdges.slice(0, 5)) {
    const source = result.nodes.find(n => n.id === edge.startNodeId);
    const target = result.nodes.find(n => n.id === edge.endNodeId);
    console.log(`${source?.properties.name} --> ${target?.properties.name}`);
  }
}

test().catch(console.error);
