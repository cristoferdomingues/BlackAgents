import { describe, expect, it } from "vitest"

import { fillLoginFields, findLoginFields } from "@/lib/browser/fill-login"

const SNAPSHOT = `
- textbox "Email" [ref=e2]
- textbox "Password" [ref=e3]
- button "Sign in" [ref=e4]
`

describe("findLoginFields", () => {
  it("reads username, password, and submit refs from a snapshot", () => {
    expect(findLoginFields(SNAPSHOT)).toEqual({
      usernameRef: "e2",
      usernameLabel: "Email",
      passwordRef: "e3",
      passwordLabel: "Password",
      submitRef: "e4",
      submitLabel: "Sign in",
    })
  })
})

describe("fillLoginFields", () => {
  it("types both fields and clicks sign in without putting the password in the error", async () => {
    const calls: string[] = []
    const filled = await fillLoginFields({
      username: "ada",
      password: "secret-pass",
      fields: findLoginFields(SNAPSHOT),
      typeText: async (ref, text) => {
        calls.push(`${ref}:${text}`)
        return undefined
      },
      click: async (ref) => {
        calls.push(`click:${ref}`)
        return undefined
      },
    })
    expect(filled).toEqual({ ok: true })
    expect(calls).toEqual(["e2:ada", "e3:secret-pass", "click:e4"])
  })

  it("asks for the login page when the fields are missing", async () => {
    const filled = await fillLoginFields({
      username: "ada",
      password: "secret-pass",
      fields: {},
      typeText: async () => undefined,
      click: async () => undefined,
    })
    expect(filled).toEqual({
      ok: false,
      error:
        "LOGIN_REQUIRED: the page has no username and password fields yet. Open the login page, then try again.",
    })
  })
})
