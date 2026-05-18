/**
 * PHP file parser that uses regular expressions to extract structure
 * from PHP code: classes, functions, namespaces, use statements,
 * traits, interfaces, and Blade template directives.
 */
export class PhpParser {
  private static readonly phpKeywords = new Set([
    'if', 'else', 'elseif', 'while', 'for', 'foreach', 'switch', 'case',
    'return', 'echo', 'print', 'isset', 'unset', 'empty', 'array',
    'list', 'die', 'exit', 'eval', 'include', 'require',
    'include_once', 'require_once', 'new', 'throw', 'catch', 'try',
    'finally', 'match', 'fn', 'static', 'self', 'parent'
  ]);

  /**
   * Parses PHP code to extract classes, functions, variables, imports (use), and namespace.
   */
  public parseFile(filePath: string, code: string): {
    namespace: string;
    classes: { name: string; parents: string[]; implements: string[]; type: 'class' | 'interface' | 'trait' | 'enum'; line: number }[];
    functions: { name: string; line: number }[];
    variables: { name: string; line: number }[];
    imports: { source: string; alias: string; line: number }[];
    calls: { name: string; line: number }[];
  } {
    let namespace = '';
    const classes: { name: string; parents: string[]; implements: string[]; type: 'class' | 'interface' | 'trait' | 'enum'; line: number }[] = [];
    const functions: { name: string; line: number }[] = [];
    const variables: { name: string; line: number }[] = [];
    const imports: { source: string; alias: string; line: number }[] = [];
    const calls: { name: string; line: number }[] = [];

    const lines = code.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip comments
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('#')) {
        continue;
      }

      // Namespace
      const nsMatch = /^namespace\s+([^;]+);/.exec(line);
      if (nsMatch) {
        namespace = nsMatch[1].trim();
        continue;
      }

      // Use statements (imports)
      const useMatch = /^use\s+([^;]+);/.exec(line);
      if (useMatch) {
        const useStr = useMatch[1].trim();
        // Handle "use App\Models\User as UserModel;"
        const aliasParts = useStr.split(/\s+as\s+/);
        const source = aliasParts[0].trim();
        const alias = aliasParts[1] ? aliasParts[1].trim() : source.split('\\').pop() || source;
        imports.push({ source, alias, line: lineNumber });
        continue;
      }

      // Classes, Interfaces, Traits, Enums
      const classMatch = /^(?:abstract\s+|final\s+)?(?:readonly\s+)?(class|interface|trait|enum)\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+(.+?))?(?:\s*\{|\s*$)/.exec(line);
      if (classMatch) {
        const type = classMatch[1] as 'class' | 'interface' | 'trait' | 'enum';
        const name = classMatch[2];
        const parents = classMatch[3] ? [classMatch[3].split('\\').pop() || classMatch[3]] : [];
        const implementsList = classMatch[4]
          ? classMatch[4].split(',').map(s => {
              const trimmed = s.trim();
              return trimmed.split('\\').pop() || trimmed;
            })
          : [];
        classes.push({ name, parents, implements: implementsList, type, line: lineNumber });
        continue;
      }

      // Functions and methods  
      const funcMatch = /^(?:public|protected|private|static|\s)*function\s+(\w+)\s*\(/.exec(line);
      if (funcMatch) {
        const funcName = funcMatch[1];
        if (funcName !== '__construct' && funcName !== '__destruct') {
          functions.push({ name: funcName, line: lineNumber });
        }
        continue;
      }

      // Class properties (public/protected/private $var)
      const propMatch = /^(?:public|protected|private)\s+(?:static\s+)?(?:readonly\s+)?(?:\?\w+\s+|\w+\s+)?(\$\w+)/.exec(line);
      if (propMatch) {
        variables.push({ name: propMatch[1].replace('$', ''), line: lineNumber });
        continue;
      }

      // Constants
      const constMatch = /^(?:public|protected|private)?\s*const\s+(\w+)\s*=/.exec(line);
      if (constMatch) {
        variables.push({ name: constMatch[1], line: lineNumber });
        continue;
      }

      // Static/instance method calls: ClassName::method() or $this->method()
      const callRegex = /(?:(\w+)::(\w+)|->(\w+))\s*\(/g;
      let callMatch;
      while ((callMatch = callRegex.exec(line)) !== null) {
        const callName = callMatch[2] || callMatch[3];
        if (callName && !PhpParser.phpKeywords.has(callName)) {
          calls.push({ name: callName, line: lineNumber });
        }
      }

      // Standalone function calls: func_name()
      const standaloneCallRegex = /\b(\w+)\s*\(/g;
      let scMatch;
      while ((scMatch = standaloneCallRegex.exec(line)) !== null) {
        const name = scMatch[1];
        if (!PhpParser.phpKeywords.has(name) && 
            !['function', 'class', 'interface', 'trait', 'enum', 'namespace', 'use'].includes(name) &&
            name !== name.toLowerCase().replace(/[^a-z]/g, '')) {
          // Only capture PascalCase or camelCase calls (likely class/method calls)
        }
      }
    }

    return { namespace, classes, functions, variables, imports, calls };
  }

  /**
   * Parses Blade template to extract directives: @extends, @include, @component, @section, @yield
   */
  public parseBladeFile(filePath: string, code: string): {
    extends: string[];
    includes: string[];
    components: string[];
    sections: string[];
    yields: string[];
  } {
    const extendsArr: string[] = [];
    const includes: string[] = [];
    const components: string[] = [];
    const sections: string[] = [];
    const yields: string[] = [];

    const lines = code.split(/\r?\n/);

    for (const line of lines) {
      // @extends('layout.app')
      const extendsMatch = /@extends\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      if (extendsMatch) extendsArr.push(extendsMatch[1]);

      // @include('partials.header')
      const includeMatch = /@include\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      if (includeMatch) includes.push(includeMatch[1]);

      // @component('components.alert') or <x-alert>
      const componentMatch = /@component\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      if (componentMatch) components.push(componentMatch[1]);

      // <x-component-name>
      const xComponentMatch = /<x-([\w.-]+)/.exec(line);
      if (xComponentMatch) components.push(xComponentMatch[1]);

      // @section('content')
      const sectionMatch = /@section\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      if (sectionMatch) sections.push(sectionMatch[1]);

      // @yield('content')
      const yieldMatch = /@yield\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      if (yieldMatch) yields.push(yieldMatch[1]);
    }

    return { extends: extendsArr, includes, components, sections, yields };
  }
}
