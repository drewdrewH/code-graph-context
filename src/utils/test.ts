import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NESTJS_FRAMEWORK_SCHEMA } from '../core/config/graph-v2';
import { TypeScriptParser } from '../core/parsers/typescript-parser-v2';

const workspace = path.join(os.homedir(), 'nestjs/iluvcoffee');
const tsconfig = path.join(workspace, 'tsconfig.json'); // or tsconfig.build.json etc.

(async () => {
  console.log({ workspace, tsconfig, exists: fs.existsSync(tsconfig) });

  const parser = new TypeScriptParser(workspace, tsconfig, undefined, [NESTJS_FRAMEWORK_SCHEMA]);

  // 👇  pull in every *.ts file under the repo
  parser['project'].addSourceFilesAtPaths(path.join(workspace, 'src/**/*.ts'));

  const { nodes, edges } = await parser.parseWorkspace(); // runs fine now
  const { nodes: cleanNodes, edges: cleanEdges } = parser.exportToJson();

  console.log(`Parsed ${cleanNodes.length} nodes / ${cleanEdges.length} edges`);
  writeFileSync('em-backend-graph.json', JSON.stringify({ nodes: cleanNodes, edges: cleanEdges }, null, 2));
})();
