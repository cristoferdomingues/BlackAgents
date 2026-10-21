interface IgnoreRule {
  negated: boolean
  dirOnly: boolean
  re: RegExp
}

/** Turn one .gitignore line into a rule. Blank lines and comments are skipped. */
export function compileGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    const body = negated ? line.slice(1).trim() : line
    const compiled = compilePattern(body)
    if (compiled) rules.push({ negated, ...compiled })
  }
  return rules
}

export function isIgnored(relPath: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!rel) return false
  let ignored = false
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue
    if (rule.re.test(rel)) ignored = !rule.negated
  }
  return ignored
}

function compilePattern(pattern: string): { dirOnly: boolean; re: RegExp } | null {
  let source = pattern
  if (!source) return null
  let dirOnly = false
  if (source.endsWith("/") && !source.endsWith("\\/")) {
    dirOnly = true
    source = source.slice(0, -1)
  }
  const anchored = source.startsWith("/")
  if (anchored) source = source.slice(1)
  if (!source) return null
  const hasSlash = source.includes("/")
  let body = ""
  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? ""
    if (char === "*" && source[i + 1] === "*") {
      if (source[i + 2] === "/") {
        body += "(?:.*/)?"
        i += 2
      } else {
        body += ".*"
        i += 1
      }
      continue
    }
    if (char === "*") {
      body += "[^/]*"
      continue
    }
    if (char === "?") {
      body += "[^/]"
      continue
    }
    body += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
  }
  const wrapped = hasSlash || anchored ? `^${body}(?:/|$)` : `(?:^|/)${body}(?:/|$)`
  return { dirOnly, re: new RegExp(wrapped) }
}
