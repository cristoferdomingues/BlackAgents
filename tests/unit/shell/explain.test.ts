import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { APP_VERSION } from "@/lib/app-version"
import { agentToolkitLabel } from "@/lib/shell/explain"

describe("sidebar toolkit label", () => {
  it("places the app version beside Agent toolkit", () => {
    expect(agentToolkitLabel("0.8.0")).toBe("Agent toolkit - 0.8.0")
  })

  it("uses the version from package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
    expect(agentToolkitLabel(APP_VERSION)).toBe(`Agent toolkit - ${pkg.version}`)
  })
})
