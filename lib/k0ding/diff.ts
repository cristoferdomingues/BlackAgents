export interface DiffLine {
  kind: "same" | "add" | "del"
  text: string
}

const MAX_LINES = 800
const MAX_CELLS = 250_000

/** Line diff for the review panel. Large files return `truncated` so the UI can still apply them. */
export function lineDiff(before: string, after: string): { lines: DiffLine[]; truncated: boolean } {
  const left = before.split("\n")
  const right = after.split("\n")
  if (left.length > MAX_LINES || right.length > MAX_LINES || left.length * right.length > MAX_CELLS) {
    return { lines: [], truncated: true }
  }
  const rows = left.length + 1
  const cols = right.length + 1
  const scores = new Uint32Array(rows * cols)
  const at = (row: number, col: number): number => row * cols + col
  for (let row = left.length - 1; row >= 0; row--) {
    for (let col = right.length - 1; col >= 0; col--) {
      const same = left[row] === right[col]
      const next = same ? (scores[at(row + 1, col + 1)] ?? 0) + 1 : 0
      const down = scores[at(row + 1, col)] ?? 0
      const across = scores[at(row, col + 1)] ?? 0
      scores[at(row, col)] = same ? next : Math.max(down, across)
    }
  }
  const lines: DiffLine[] = []
  let row = 0
  let col = 0
  while (row < left.length && col < right.length) {
    if (left[row] === right[col]) {
      lines.push({ kind: "same", text: left[row] ?? "" })
      row += 1
      col += 1
    } else if ((scores[at(row + 1, col)] ?? 0) >= (scores[at(row, col + 1)] ?? 0)) {
      lines.push({ kind: "del", text: left[row] ?? "" })
      row += 1
    } else {
      lines.push({ kind: "add", text: right[col] ?? "" })
      col += 1
    }
  }
  while (row < left.length) {
    lines.push({ kind: "del", text: left[row] ?? "" })
    row += 1
  }
  while (col < right.length) {
    lines.push({ kind: "add", text: right[col] ?? "" })
    col += 1
  }
  return { lines, truncated: false }
}

export function diffCounts(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "del").length,
  }
}
