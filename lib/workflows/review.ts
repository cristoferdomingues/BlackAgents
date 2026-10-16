export type ReviewVerdict = "approve" | "reject"

const VERDICT_LINE = /^\s*\**\s*verdict\s*\**\s*:\s*\**\s*(approve|approved|reject|rejected)\b/i

export const REVIEW_INSTRUCTION =
  "## Review\n\nYou review the work in the handoff. If it is not good enough, list each reason clearly so the author can fix it. End your reply with exactly one line: `VERDICT: approve` or `VERDICT: reject`."

/** The last `VERDICT:` line in a review step's output, or null when there is none. */
export function parseReviewVerdict(output: string): ReviewVerdict | null {
  const lines = output.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(VERDICT_LINE)
    if (match) return match[1].toLowerCase().startsWith("approve") ? "approve" : "reject"
  }
  return null
}

/** The review text without its verdict line(s), for use as feedback. */
export function reviewReasons(output: string): string {
  return output
    .split("\n")
    .filter((line) => !VERDICT_LINE.test(line))
    .join("\n")
    .trim()
}
