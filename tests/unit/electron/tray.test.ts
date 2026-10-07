import { existsSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  trayIconFileName,
  trayIconPath,
  trayMenuTemplate,
} from "../../../electron/tray.cjs"

const electronDirectory = path.join(__dirname, "../../../electron")

describe("desktop tray", () => {
  it("uses a template icon on macOS and a color icon elsewhere", () => {
    expect(trayIconFileName("darwin")).toBe("trayTemplate.png")
    expect(trayIconFileName("win32")).toBe("tray.png")
    expect(trayIconFileName("linux")).toBe("tray.png")
    expect(trayIconPath("/app", "darwin")).toBe(path.join("/app", "trayTemplate.png"))
  })

  it("ships the menu-bar icons", () => {
    expect(existsSync(path.join(electronDirectory, "trayTemplate.png"))).toBe(true)
    expect(existsSync(path.join(electronDirectory, "trayTemplate@2x.png"))).toBe(true)
    expect(existsSync(path.join(electronDirectory, "tray.png"))).toBe(true)
  })

  it("offers Open and Quit", () => {
    const calls: string[] = []
    const menu = trayMenuTemplate(() => {
      calls.push("open")
    })

    expect(
      menu.map((item) => {
        if ("label" in item) return item.label
        if ("type" in item) return item.type
        return item.role
      })
    ).toEqual(["Open", "separator", "quit"])

    const open = menu[0]
    if (open && "click" in open) open.click()
    expect(calls).toEqual(["open"])
  })
})
