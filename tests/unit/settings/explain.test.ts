import { describe, expect, it } from "vitest"

import {
  ACTION,
  deleteServerEffect,
  deleteServerLabel,
  deleteServerTitle,
  editServerLabel,
  EMPTY,
  FILE_WRITES_ALERT,
  FILE_WRITES_DIALOG_BODY,
  HOW_IT_WORKS_STEPS,
  keptSecretPlaceholder,
  mcpConnectionMessage,
  mcpSaveFeedback,
  NAME_FIXED_HELP,
  SAVE_OR_CANCEL,
  SECRET_KEEP_HELP,
  SETTINGS_INTRO,
  SETTINGS_INTRO_STORAGE_KEY,
  TERM_COMMAND,
  TERM_HTTP,
  TERM_JEV,
  TERM_MCP,
  TERM_SSE,
  TERM_TRUST,
  transportHelp,
  TRUST_LEVELS,
  UNSAVED_CHANGES,
  WORKSPACE_DIALOG,
} from "@/lib/settings/explain"

describe("settings explain copy", () => {
  it("explains the module in three steps", () => {
    expect(HOW_IT_WORKS_STEPS).toHaveLength(3)
    expect(HOW_IT_WORKS_STEPS.map((step) => step.title).join(" ")).toMatch(/1\..+2\..+3\./s)
    expect(SETTINGS_INTRO_STORAGE_KEY).toContain("settings-intro")
  })

  it("says where to create or open a workspace", () => {
    expect(HOW_IT_WORKS_STEPS[0]?.text).toMatch(/workspace menu at the top/)
    expect(WORKSPACE_DIALOG.createTitle).toBe("Create a workspace")
    expect(WORKSPACE_DIALOG.openText).toMatch(/\.cursor or \.claude/)
  })

  it("explains MCP, SSE, Jev, and trust in plain words", () => {
    expect(TERM_MCP).toMatch(/Model Context Protocol/)
    expect(TERM_SSE).toMatch(/GET/)
    expect(TERM_JEV).toMatch(/optional/i)
    expect(TERM_TRUST).toMatch(/Risky/)
    expect(transportHelp("http")).toBe(TERM_HTTP)
    expect(TERM_HTTP).toContain("Uses HTTP POST.")
    expect(TRUST_LEVELS.map((level) => level.value)).toEqual(["trusted", "ask", "risky"])
  })

  it("keeps the file-write warning text the screen already shows", () => {
    expect(FILE_WRITES_DIALOG_BODY).toContain("overwrite a file")
    expect(FILE_WRITES_ALERT).toContain("File writes run with no approval")
  })

  it("names edit and delete by the server", () => {
    expect(editServerLabel("github")).toBe("Edit github")
    expect(deleteServerLabel("github")).toBe("Delete github")
    expect(deleteServerEffect("github")).toContain("github")
    expect(ACTION.testAndSave).toMatch(/\.black-agents\/mcp\.json/)
    expect(ACTION.saveChanges).toMatch(/blank secret/i)
  })

  it("describes connection results", () => {
    expect(mcpConnectionMessage({ status: "connected", toolCount: 1 })).toBe("Connected. 1 tool ready.")
    expect(mcpConnectionMessage({ status: "connected", toolCount: 2 })).toBe("Connected. 2 tools ready.")
    expect(mcpConnectionMessage({ status: "disabled", toolCount: 0 })).toMatch(/turned off/)
    expect(mcpConnectionMessage({ status: "error", toolCount: 0, error: "down" })).toBe("Not connected. down")
    expect(mcpSaveFeedback({ status: "error", toolCount: 0, error: "down" }).toast).toBe(
      "Saved, but not connected. down"
    )
  })

  it("tells the user a blank secret keeps the saved value", () => {
    expect(keptSecretPlaceholder(undefined)).toMatch(/Blank keeps/)
    expect(keptSecretPlaceholder("cret")).toContain("••••cret")
    expect(SECRET_KEEP_HELP).toMatch(/blank/i)
    expect(NAME_FIXED_HELP).toMatch(/name stays the same/i)
  })

  it("teaches the empty MCP list and the unsaved-edit state", () => {
    expect(SETTINGS_INTRO).toMatch(/section on the left/i)
    expect(EMPTY.mcpTitle).toBe("No MCP servers yet")
    expect(EMPTY.mcpAction).toBe("Add a server")
    expect(EMPTY.mcpText).toMatch(/\.black-agents\/mcp\.json/)
    expect(UNSAVED_CHANGES).toBe("Unsaved changes")
    expect(SAVE_OR_CANCEL).toBe("Save or cancel your changes first.")
    expect(deleteServerTitle("github")).toBe("Delete github?")
    expect(ACTION.cancelEdit).toMatch(/drops these edits/i)
    expect(ACTION.cancelAdd).toMatch(/Nothing is saved/)
  })

  it("picks transport help and a successful save message", () => {
    expect(transportHelp("sse")).toBe(TERM_SSE)
    expect(transportHelp("stdio")).toBe(TERM_COMMAND)
    const saved = mcpSaveFeedback({ status: "connected", toolCount: 2 })
    expect(saved).toEqual({
      tone: "ok",
      detail: "Connected. 2 tools ready.",
      toast: "Connected. 2 tools ready.",
    })
    expect(mcpSaveFeedback({ status: "disabled", toolCount: 0 }).tone).toBe("ok")
    expect(mcpConnectionMessage({ status: "error", toolCount: 0 })).toBe("Not connected.")
  })
})
