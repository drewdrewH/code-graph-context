/**
 * Code Normalizer Utility
 * Normalizes code for structural duplicate detection by:
 * - Stripping comments and whitespace
 * - Replacing variable names with positional placeholders
 * - Replacing literals with type placeholders
 * - Computing SHA256 hash for comparison
 */

import * as crypto from 'crypto';

// TypeScript/JavaScript keywords and built-in identifiers to preserve during normalization
const RESERVED_KEYWORDS = new Set([
  // Keywords
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
  // TypeScript-specific keywords
  'abstract',
  'as',
  'asserts',
  'constructor',
  'declare',
  'get',
  'set',
  'infer',
  'is',
  'keyof',
  'module',
  'namespace',
  'require',
  'type',
  'satisfies',
  'using',
  // Built-in types
  'any',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'unknown',
  // Common built-ins
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'Error',
  'console',
  'JSON',
  'Math',
  'BigInt',
  'Symbol',
  'Proxy',
  'Reflect',
  // Our placeholders
  '$STR',
  '$NUM',
]);

export interface NormalizedCodeResult {
  normalizedCode: string;
  normalizedHash: string;
  metrics: StructuralMetrics;
}

export interface StructuralMetrics {
  parameterCount: number;
  statementCount: number;
  controlFlowDepth: number;
  lineCount: number;
  tokenCount: number;
}

/**
 * Normalize code for structural comparison.
 * Removes formatting differences while preserving semantic structure.
 */
export const normalizeCode = (code: string): NormalizedCodeResult => {
  if (!code || code.trim().length === 0) {
    return {
      normalizedCode: '',
      normalizedHash: '',
      metrics: {
        parameterCount: 0,
        statementCount: 0,
        controlFlowDepth: 0,
        lineCount: 0,
        tokenCount: 0,
      },
    };
  }

  // Step 1: Replace string literals FIRST (to protect their contents from comment removal)
  // This prevents strings containing "//" or "/*" from being corrupted
  let normalized = replaceStringLiterals(code);

  // Step 2: Remove comments (now safe since strings are already placeholders)
  normalized = removeComments(normalized);

  // Step 3: Normalize whitespace
  normalized = normalizeWhitespace(normalized);

  // Step 4: Replace numeric literals with placeholder
  normalized = replaceNumericLiterals(normalized);

  // Step 5: Replace variable names with positional placeholders
  normalized = replaceVariableNames(normalized);

  // Step 6: Calculate metrics
  const metrics = calculateMetrics(code);

  // Step 7: Compute hash
  const normalizedHash = computeHash(normalized);

  return {
    normalizedCode: normalized,
    normalizedHash,
    metrics,
  };
};

/**
 * Remove single-line and multi-line comments from code.
 */
const removeComments = (code: string): string => {
  // Remove multi-line comments /* ... */
  let result = code.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove single-line comments // ...
  result = result.replace(/\/\/.*$/gm, '');

  return result;
};

/**
 * Normalize whitespace: collapse multiple spaces, remove leading/trailing.
 */
const normalizeWhitespace = (code: string): string => {
  return code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Replace string literals with $STR placeholder.
 * Handles single quotes, double quotes, and template literals.
 */
const replaceStringLiterals = (code: string): string => {
  // Replace template literals (backticks) - handle simple cases
  let result = code.replace(/`[^`]*`/g, '$STR');

  // Replace double-quoted strings
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, '$STR');

  // Replace single-quoted strings
  result = result.replace(/'(?:[^'\\]|\\.)*'/g, '$STR');

  return result;
};

/**
 * Replace numeric literals with $NUM placeholder.
 * Handles: integers, floats, hex (0x), binary (0b), octal (0o), scientific notation, BigInt (n suffix)
 */
const replaceNumericLiterals = (code: string): string => {
  // Handle hex literals (0xFF, 0XAB)
  let result = code.replace(/\b0[xX][0-9a-fA-F_]+n?\b/g, '$NUM');

  // Handle binary literals (0b1010)
  result = result.replace(/\b0[bB][01_]+n?\b/g, '$NUM');

  // Handle octal literals (0o777)
  result = result.replace(/\b0[oO][0-7_]+n?\b/g, '$NUM');

  // Handle regular numbers (integers, floats, scientific notation, BigInt)
  // Supports underscore separators (1_000_000) and BigInt suffix (123n)
  // But not numbers that are part of variable names like $VAR_1
  result = result.replace(/(?<![a-zA-Z_$])\b\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?n?\b/g, '$NUM');

  return result;
};

/**
 * Replace variable and parameter names with positional placeholders.
 * Preserves keywords, built-in types, and operators.
 */
const replaceVariableNames = (code: string): string => {
  // Track variable name mappings
  const variableMap = new Map<string, string>();
  let varCounter = 1;

  // Match identifiers (variable names, function names, etc.)
  // This is a simplified approach - matches word characters after boundaries
  const identifierPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;

  return code.replace(identifierPattern, (match) => {
    // Skip keywords and built-ins (uses module-level constant)
    if (RESERVED_KEYWORDS.has(match)) {
      return match;
    }

    // Check if we've seen this identifier before
    if (variableMap.has(match)) {
      return variableMap.get(match)!;
    }

    // Assign new placeholder
    const placeholder = `$VAR_${varCounter++}`;
    variableMap.set(match, placeholder);
    return placeholder;
  });
};

/**
 * Calculate structural metrics from the original code.
 */
const calculateMetrics = (code: string): StructuralMetrics => {
  // Count parameters: look for function/method signatures
  const paramMatches = code.match(/\([^)]*\)/g) ?? [];
  let parameterCount = 0;
  for (const match of paramMatches) {
    // Count commas + 1 for non-empty param lists
    const inner = match.slice(1, -1).trim();
    if (inner.length > 0) {
      parameterCount += inner.split(',').filter((p) => p.trim().length > 0).length;
    }
  }

  // Count statements: approximate by counting semicolons and block closures
  const statementCount = (code.match(/[;{}]/g)?.length ?? 0) / 2;

  // Calculate control flow depth: count nesting of if/for/while/switch
  let maxDepth = 0;
  let currentDepth = 0;
  const controlFlowPattern = /\b(if|for|while|switch|try|catch)\s*\(|{|}/g;
  let match;
  while ((match = controlFlowPattern.exec(code)) !== null) {
    if (match[0] === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (match[0] === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  // Count lines (non-empty)
  const lineCount = code.split('\n').filter((line) => line.trim().length > 0).length;

  // Approximate token count
  const tokenCount = code.split(/\s+/).filter((t) => t.length > 0).length;

  return {
    parameterCount,
    statementCount: Math.round(statementCount),
    controlFlowDepth: maxDepth,
    lineCount,
    tokenCount,
  };
};

/**
 * Compute SHA256 hash of the normalized code.
 */
const computeHash = (normalizedCode: string): string => {
  if (normalizedCode.length === 0) {
    return '';
  }
  return crypto.createHash('sha256').update(normalizedCode).digest('hex');
};

/**
 * Check if two code blocks are structurally similar based on metrics.
 * Used for near-duplicate detection when hashes don't match.
 */
export const areMetricsSimilar = (
  metrics1: StructuralMetrics,
  metrics2: StructuralMetrics,
  threshold: number = 0.8,
): boolean => {
  // Compare each metric and calculate similarity score
  const paramSim =
    1 -
    Math.abs(metrics1.parameterCount - metrics2.parameterCount) /
      Math.max(metrics1.parameterCount, metrics2.parameterCount, 1);
  const stmtSim =
    1 -
    Math.abs(metrics1.statementCount - metrics2.statementCount) /
      Math.max(metrics1.statementCount, metrics2.statementCount, 1);
  const depthSim =
    1 -
    Math.abs(metrics1.controlFlowDepth - metrics2.controlFlowDepth) /
      Math.max(metrics1.controlFlowDepth, metrics2.controlFlowDepth, 1);
  const lineSim =
    1 - Math.abs(metrics1.lineCount - metrics2.lineCount) / Math.max(metrics1.lineCount, metrics2.lineCount, 1);

  // Weighted average (statement count and line count are more important)
  const avgSim = paramSim * 0.15 + stmtSim * 0.35 + depthSim * 0.15 + lineSim * 0.35;

  return avgSim >= threshold;
};
