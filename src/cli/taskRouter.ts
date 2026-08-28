/**
 * Port of src/cli/hooks/task-router.sh for MCP clients (Zed, Cursor)
 * that have no Claude-style UserPromptSubmit hooks.
 */

export interface TaskRoute {
  model: string;
  effort: "low" | "medium" | "high" | "max";
}

const DEFAULT_HIGH_COMPLEXITY = [
  "design",
  "architecture",
  "complex",
  "optimize",
  "security audit",
  "deep analysis",
  "performance",
  "bug fix",
  "error",
  "debug",
  "broken",
];

const DEFAULT_MEDIUM_COMPLEXITY = [
  "implement",
  "add feature",
  "integrate",
  "develop",
  "review",
  "refactor",
];

const DEFAULT_LOW_COMPLEXITY = [
  "typo",
  "minor change",
  "read",
  "list",
  "simple",
  "what is",
  "how to",
  "find",
];

const DEFAULT_MEDIUM_TASK_TYPES = new Set(["code_generation", "code_editing", "code_review"]);
const DEFAULT_LOW_TASK_TYPES = new Set(["qa_response", "documentation", "summarize", "explain"]);

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function getListFromEnv(envVar: string | undefined, defaultValue: string[]): string[] {
  if (envVar && typeof envVar === 'string') {
    return envVar.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  return defaultValue;
}

function getSetFromEnv(envVar: string | undefined, defaultValue: Set<string>): Set<string> {
  if (envVar && typeof envVar === 'string') {
    return new Set(envVar.split(',').map(s => s.trim()).filter(Boolean));
  }
  return defaultValue;
}

// Allow externalization of hardcoded keyword mappings for dynamic configuration.
// We evaluate these once upon module loading to save computation time.
const highComplexity = getListFromEnv(process.env.CODEATLAS_HIGH_COMPLEXITY, DEFAULT_HIGH_COMPLEXITY);
const mediumComplexity = getListFromEnv(process.env.CODEATLAS_MEDIUM_COMPLEXITY, DEFAULT_MEDIUM_COMPLEXITY);
const lowComplexity = getListFromEnv(process.env.CODEATLAS_LOW_COMPLEXITY, DEFAULT_LOW_COMPLEXITY);

const mediumTaskTypes = getSetFromEnv(process.env.CODEATLAS_MEDIUM_TASK_TYPES, DEFAULT_MEDIUM_TASK_TYPES);
const lowTaskTypes = getSetFromEnv(process.env.CODEATLAS_LOW_TASK_TYPES, DEFAULT_LOW_TASK_TYPES);

export function routeTask(taskName: string = "unknown", taskType: string = "unknown"): TaskRoute {
  // Convert to lower case for case-insensitive matching. Note that taskName.includes()
  // searches against this lowercased string using low-case default tokens.
  const lower = taskName.toLowerCase();

  if (containsAny(lower, highComplexity)) {
    return { model: "ag/claude-opus-4-6-thinking", effort: "max" };
  }

  if (mediumTaskTypes.has(taskType) || containsAny(lower, mediumComplexity)) {
    return { model: "ag/claude-sonnet-4-6", effort: "medium" };
  }

  if (lowTaskTypes.has(taskType) || containsAny(lower, lowComplexity)) {
    return { model: "ag/claude-sonnet-4-6", effort: "low" };
  }

  return { model: "ag/claude-sonnet-4-6", effort: "medium" };
}
