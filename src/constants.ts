export const MAX_TRAVERSAL_DEPTH = 5;

// Logging Configuration (shared between core and mcp)
export const LOG_CONFIG = {
  debugLogFile: 'debug-search.log',
  separator: '---',
  jsonIndent: 2,
  // Alias for backwards compatibility with mcp code
  jsonIndentation: 2,
} as const;

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
  // Common config and test infrastructure files
  'jest\\.config\\.ts$',
  '-e2e/',
  'test-setup\\.ts$',
  'global-setup\\.ts$',
  'global-teardown\\.ts$',
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
  // Common config and test infrastructure files
  '**/jest.config.ts',
  '**/*-e2e/**',
  '**/test-setup.ts',
  '**/global-setup.ts',
  '**/global-teardown.ts',
];
