/**
 * Shared constants for swarm coordination tools
 */

/**
 * Pheromone types and their half-lives in milliseconds.
 * Half-life determines decay rate - after one half-life, intensity drops to 50%.
 */
export const PHEROMONE_CONFIG = {
  exploring: { halfLife: 2 * 60 * 1000, description: 'Browsing/reading' },
  modifying: { halfLife: 10 * 60 * 1000, description: 'Active work' },
  claiming: { halfLife: 60 * 60 * 1000, description: 'Ownership' },
  completed: { halfLife: 24 * 60 * 60 * 1000, description: 'Done' },
  warning: { halfLife: -1, description: 'Never decays' },
  blocked: { halfLife: 5 * 60 * 1000, description: 'Stuck' },
  proposal: { halfLife: 60 * 60 * 1000, description: 'Awaiting approval' },
  needs_review: { halfLife: 30 * 60 * 1000, description: 'Review requested' },
} as const;

export type PheromoneType = keyof typeof PHEROMONE_CONFIG;

export const PHEROMONE_TYPES = Object.keys(PHEROMONE_CONFIG) as PheromoneType[];

/**
 * Get half-life for a pheromone type.
 * Returns -1 for types that never decay (e.g., warning).
 */
export const getHalfLife = (type: PheromoneType): number => {
  return PHEROMONE_CONFIG[type]?.halfLife ?? PHEROMONE_CONFIG.exploring.halfLife;
};

/**
 * Workflow states are mutually exclusive per agent+node.
 * Setting one removes others in this group.
 * Flags (warning, proposal, needs_review) can coexist with workflow states.
 */
export const WORKFLOW_STATES: PheromoneType[] = ['exploring', 'claiming', 'modifying', 'completed', 'blocked'];

/**
 * Flags can coexist with workflow states.
 */
export const FLAG_TYPES: PheromoneType[] = ['warning', 'proposal', 'needs_review'];
