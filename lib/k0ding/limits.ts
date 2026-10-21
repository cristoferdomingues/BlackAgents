/** Caps for the K0ding code browser and the review loop. */
export const K0DING_LIMITS = {
  /** Viewer and a staged file. Bigger files are refused. */
  maxFileBytes: 1_048_576,
  /** How much of a file a tool call may return. */
  maxToolReadChars: 100_000,
  maxSearchMatches: 200,
  maxSearchFiles: 5_000,
  maxSearchLineChars: 300,
  maxListEntries: 500,
  maxFindResults: 50,
  maxRoots: 20,
  maxLabelChars: 80,
  maxHidden: 40,
  maxContextFiles: 20,
  maxPromptChars: 20_000,
  maxSessionMessages: 200,
  maxMessageChars: 2_000_000,
} as const

/** Folders skipped unless the user asks to see hidden files. */
export const DEFAULT_HIDDEN_DIRS = [".git", "node_modules", "dist", "build", ".next", "coverage"] as const
