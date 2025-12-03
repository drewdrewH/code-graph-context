/**
 * Parser Factory
 * Creates TypeScript parsers with appropriate framework schemas
 */

import { EXCLUDE_PATTERNS_REGEX } from '../../constants.js';
import { FAIRSQUARE_FRAMEWORK_SCHEMA } from '../config/fairsquare-framework-schema.js';
import { NESTJS_FRAMEWORK_SCHEMA } from '../config/nestjs-framework-schema.js';
import { CORE_TYPESCRIPT_SCHEMA, FrameworkSchema, CoreNodeType } from '../config/schema.js';

import { TypeScriptParser } from './typescript-parser.js';

export enum ProjectType {
  NESTJS = 'nestjs',
  FAIRSQUARE = 'fairsquare',
  BOTH = 'both', // For codebases with mixed patterns
  VANILLA = 'vanilla', // Plain TypeScript, no frameworks
}

export interface ParserFactoryOptions {
  workspacePath: string;
  tsConfigPath?: string;
  projectType?: ProjectType;
  customFrameworkSchemas?: FrameworkSchema[];
  excludePatterns?: string[];
  excludedNodeTypes?: CoreNodeType[];
}

export class ParserFactory {
  /**
   * Create a parser with appropriate framework schemas
   */
  static createParser(options: ParserFactoryOptions): TypeScriptParser {
    const {
      workspacePath,
      tsConfigPath = 'tsconfig.json',
      projectType = ProjectType.NESTJS, // Default to NestJS (use auto-detect for best results)
      customFrameworkSchemas = [],
      excludePatterns = EXCLUDE_PATTERNS_REGEX,
      excludedNodeTypes = [CoreNodeType.PARAMETER_DECLARATION],
    } = options;

    // Select framework schemas based on project type
    const frameworkSchemas = this.selectFrameworkSchemas(projectType, customFrameworkSchemas);

    console.log(`📦 Creating parser for ${projectType} project`);
    console.log(`📚 Framework schemas: ${frameworkSchemas.map((s) => s.name).join(', ')}`);

    return new TypeScriptParser(workspacePath, tsConfigPath, CORE_TYPESCRIPT_SCHEMA, frameworkSchemas, {
      excludePatterns,
      excludedNodeTypes,
    });
  }

  /**
   * Select framework schemas based on project type
   */
  private static selectFrameworkSchemas(projectType: ProjectType, customSchemas: FrameworkSchema[]): FrameworkSchema[] {
    const schemas: FrameworkSchema[] = [];

    switch (projectType) {
      case ProjectType.NESTJS:
        schemas.push(NESTJS_FRAMEWORK_SCHEMA);
        break;

      case ProjectType.FAIRSQUARE:
        schemas.push(FAIRSQUARE_FRAMEWORK_SCHEMA);
        break;

      case ProjectType.BOTH:
        // Apply FairSquare first (higher priority), then NestJS
        schemas.push(FAIRSQUARE_FRAMEWORK_SCHEMA);
        schemas.push(NESTJS_FRAMEWORK_SCHEMA);
        break;

      case ProjectType.VANILLA:
        // No framework schemas
        break;
    }

    // Add any custom schemas
    schemas.push(...customSchemas);

    return schemas;
  }

  /**
   * Auto-detect project type from workspace
   */
  static async detectProjectType(workspacePath: string): Promise<ProjectType> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      const hasNestJS = '@nestjs/common' in deps || '@nestjs/core' in deps;
      const hasFairSquare =
        '@fairsquare/core' in deps ||
        '@fairsquare/server' in deps ||
        packageJson.name === '@fairsquare/source';

      if (hasFairSquare && hasNestJS) {
        return ProjectType.BOTH;
      } else if (hasFairSquare) {
        return ProjectType.FAIRSQUARE;
      } else if (hasNestJS) {
        return ProjectType.NESTJS;
      } else {
        return ProjectType.VANILLA;
      }
    } catch (error) {
      console.warn('Could not detect project type, defaulting to vanilla TypeScript');
      return ProjectType.VANILLA;
    }
  }

  /**
   * Create parser with auto-detection
   */
  static async createParserWithAutoDetection(workspacePath: string, tsConfigPath?: string): Promise<TypeScriptParser> {
    const projectType = await this.detectProjectType(workspacePath);
    console.log(`🔍 Auto-detected project type: ${projectType}`);

    return this.createParser({
      workspacePath,
      tsConfigPath,
      projectType,
    });
  }
}
