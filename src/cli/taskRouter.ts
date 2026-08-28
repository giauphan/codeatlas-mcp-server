/**
 * Port of src/cli/hooks/task-router.sh for MCP clients (Zed, Cursor)
 * that have no Claude-style UserPromptSubmit hooks.
 */

export interface TaskRoute {
  model: string;
  effort: "low" | "medium" | "high" | "max";
}

const HIGH_COMPLEXITY = [
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

const MEDIUM_COMPLEXITY = [
  "implement",
  "add feature",
  "integrate",
  "develop",
  "review",
  "refactor",
];

const LOW_COMPLEXITY = [
  "typo",
  "minor change",
  "read",
  "list",
  "simple",
  "what is",
  "how to",
  "find",
];

const MEDIUM_TASK_TYPES = new Set(["code_generation", "code_editing", "code_review"]);
const LOW_TASK_TYPES = new Set(["qa_response", "documentation", "summarize", "explain"]);

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function routeTask(taskName: string = "unknown", taskType: string = "unknown"): TaskRoute {
  const lower = taskName.toLowerCase();

  if (containsAny(lower, HIGH_COMPLEXITY)) {
    return { model: "ag/claude-opus-4-6-thinking", effort: "max" };
  }

  if (MEDIUM_TASK_TYPES.has(taskType) || containsAny(lower, MEDIUM_COMPLEXITY)) {
    return { model: "ag/claude-sonnet-4-6", effort: "medium" };
  }

  if (LOW_TASK_TYPES.has(taskType) || containsAny(lower, LOW_COMPLEXITY)) {
    return { model: "ag/claude-sonnet-4-6", effort: "low" };
  }

  return { model: "ag/claude-sonnet-4-6", effort: "medium" };
}
