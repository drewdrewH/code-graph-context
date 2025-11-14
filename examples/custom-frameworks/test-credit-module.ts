import { TypeScriptParser } from './dist/core/parsers/typescript-parser.js';
import { FAIRSQUARE_FRAMEWORK_SCHEMA } from './dist/core/config/fairsquare-framework-schema.js';
import { CORE_TYPESCRIPT_SCHEMA } from './dist/core/config/graph.js';

async function test() {
  const parser = new TypeScriptParser(
    '/Users/ahernandez/develop/fairsquare/src/modules/credit',
    '/Users/ahernandez/develop/fairsquare/tsconfig.base.json',
    CORE_TYPESCRIPT_SCHEMA,
    [FAIRSQUARE_FRAMEWORK_SCHEMA],
    {
      excludePatterns: ['node_modules/', 'dist/', '.spec.ts', '.test.ts', '.d.ts'],
    },
  );

  console.log('Starting parse of credit module...');
  const result = await parser.parseWorkspace();

  console.log('\n=== STATISTICS ===');
  console.log(`Total nodes: ${result.nodes.length}`);
  console.log(`Total edges: ${result.edges.length}`);

  // Check Services
  const services = result.nodes.filter((n) => n.properties.semanticType === 'Service');
  console.log(`\n=== SERVICES (${services.length}) ===`);
  for (const service of services) {
    const deps = service.properties.context?.dependencies || [];
    console.log(`${service.properties.name}:`);
    console.log(`  dependencies: ${JSON.stringify(deps)}`);
  }

  // Check Repositories
  const repos = result.nodes.filter((n) => n.properties.semanticType === 'Repository');
  console.log(`\n=== REPOSITORIES (${repos.length}) ===`);
  for (const repo of repos) {
    console.log(`${repo.properties.name}`);
  }

  // Check edges
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

  // Check USES_REPOSITORY edges specifically
  const usesRepoEdges = result.edges.filter((e) => e.type === 'USES_REPOSITORY');
  console.log(`\n=== USES_REPOSITORY EDGES (${usesRepoEdges.length}) ===`);
  for (const edge of usesRepoEdges) {
    const source = result.nodes.find((n) => n.id === edge.startNodeId);
    const target = result.nodes.find((n) => n.id === edge.endNodeId);
    console.log(`${source?.properties.name} --> ${target?.properties.name}`);
    console.log(`  context:`, edge.properties.context);
  }
}

test().catch(console.error);
