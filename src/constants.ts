export const MAX_TRAVERSAL_DEPTH = 5;

// Shared exclude patterns for file parsing and change detection
// Regex patterns (escaped dots, anchored to end)
export const EXCLUDE_PATTERNS_REGEX = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '\\.d\\.ts$',
  '\\.spec\\.ts$',
  '\\.test\\.ts$',
];

// Glob patterns for use with glob library
export const EXCLUDE_PATTERNS_GLOB = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '**/*.d.ts',
  '**/*.spec.ts',
  '**/*.test.ts',
];
