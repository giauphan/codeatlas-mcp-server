import { AnalysisResult, GraphNode } from "./analyzer/types.js";
import * as path from "path";

export interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  type: string;
  message: string;
  filePath: string;
  line: number | null;
  snippet?: string;
}

export class SecurityScanner {
  /**
   * Scan an analyzed project for security vulnerabilities
   */
  static scan(analysis: AnalysisResult): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    const nodes = analysis.graph.nodes;

    const secretKeywords = ["api_key", "secret", "password", "token", "private_key", "access_key"];
    const unsafeFuncs = ["eval", "exec", "system", "child_process", "spawn", "shell_exec"];

    // Helper to identify test, mock or diagnostic files
    const isTestOrMockFile = (filePath: string): boolean => {
      const fp = filePath.toLowerCase().replace(/\\/g, "/");
      return (
        fp.includes("/tests/") ||
        fp.includes("/test/") ||
        fp.includes("/__tests__/") ||
        fp.includes(".test.") ||
        fp.includes(".spec.") ||
        fp.includes("/mocks/") ||
        fp.includes("/mock/") ||
        fp.includes("/scratch/") ||
        fp.includes("/diagnostic/")
      );
    };

    nodes.forEach((node: GraphNode) => {
      const filePath = node.filePath;
      if (filePath && isTestOrMockFile(filePath)) {
        return;
      }

      const labelLower = node.label.toLowerCase();

      // 1. Detect Hardcoded Secrets
      if (node.type === "variable") {
        if (secretKeywords.some(k => labelLower.includes(k))) {
          findings.push({
            severity: "HIGH",
            type: "HARDCODED_SECRET",
            message: `Potential hardcoded secret found in variable: ${node.label}`,
            filePath: filePath || "unknown",
            line: node.line || null
          });
        }
      }

      // 2. Detect Unsafe Functions (eval, exec, etc.)
      else if (node.type === "function") {
        if (unsafeFuncs.includes(labelLower)) {
          findings.push({
            severity: "CRITICAL",
            type: "UNSAFE_FUNCTION",
            message: `Use of potentially dangerous function: ${node.label}`,
            filePath: filePath || "unknown",
            line: node.line || null
          });
        }

        // 3. Detect Potential SQL Injection
        if (
          (node.label.includes("Query") || node.label.includes("execute")) &&
          node.label !== "execute" &&
          !node.label.endsWith("UseCase")
        ) {
          findings.push({
            severity: "MEDIUM",
            type: "SQL_INJECTION_RISK",
            message: `Potential SQL Injection risk in database call: ${node.label}. Ensure parameterized queries are used.`,
            filePath: filePath || "unknown",
            line: node.line || null
          });
        }
      }
    });

    return findings;
  }

  /**
   * AI-powered deep scan using DeepSeek V4 Pro (or configured LLM).
   * Analyzes findings + code context for deeper issues.
   * Configure via: CODEATLAS_SCAN_AI_URL, CODEATLAS_SCAN_AI_KEY, CODEATLAS_SCAN_AI_MODEL
   */
  static async aiScan(findings: SecurityFinding[], analysis: AnalysisResult): Promise<SecurityFinding[]> {
    const aiUrl = process.env.CODEATLAS_SCAN_AI_URL || process.env.OPENCODE_BASE_URL || "";
    const aiKey = process.env.CODEATLAS_SCAN_AI_KEY || process.env.OPENCODE_API_KEY || "";
    const aiModel = process.env.CODEATLAS_SCAN_AI_MODEL || "deepseek-v4-pro";

    if (!aiUrl || !aiKey) {
      return findings;
    }

    try {
      const criticalFindings = findings.filter(f => f.severity === "CRITICAL" || f.severity === "HIGH").slice(0, 5);
      const codeContext = criticalFindings.map(f => {
        const node = analysis.graph.nodes.find(n => n.filePath === f.filePath);
        return "[" + f.severity + "] " + f.type + ": " + f.message + " (" + f.filePath + ":" + f.line + ")";
      }).join("\n");

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + aiKey },
        body: JSON.stringify({
          model: aiModel,
          messages: [{
            role: "system",
            content: "You are a security code analyzer. Analyze findings and provide deeper insights. Respond ONLY with valid JSON array: [{\"severity\":\"...\",\"type\":\"...\",\"message\":\"...\",\"filePath\":\"...\",\"line\":0}]. Empty array if no issues."
          }, {
            role: "user",
            content: "Static analysis found these issues:\n" + codeContext + "\n\nIdentify deeper issues: logic bugs, race conditions, architectural smells."
          }],
          temperature: 0.1,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        console.warn("[SecurityScanner] AI scan API returned", response.status);
        return findings;
      }

      const data = await response.json();
      const aiFindings = data.choices?.[0]?.message?.content
        ? JSON.parse(data.choices[0].message.content.replace(/```json|```/g, "").trim())
        : [];

      return [...findings, ...aiFindings];
    } catch (err) {
      console.warn("[SecurityScanner] AI scan failed:", err instanceof Error ? err.message : String(err));
      return findings;
    }
  }
}
