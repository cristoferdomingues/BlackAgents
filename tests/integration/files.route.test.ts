import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DELETE, GET as GET_ONE, PATCH } from "@/app/api/files/[name]/route"
import { GET, POST } from "@/app/api/files/route"
import type { WorkspaceFile } from "@/lib/files"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

const named = (name: string) => ({ params: Promise.resolve({ name }) })

async function json<T>(res: Response): Promise<{ status: number; body: { success: boolean; data?: T; error?: string } }> {
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: T; error?: string } }
}

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

describe("/api/files routes", () => {
  it("uploads, lists, reads metadata, serves raw preview, updates, and deletes a file", async () => {
    const content = Buffer.from("name,amount\nCoffee,4.50\n", "utf8").toString("base64")
    const created = await json<{ file: WorkspaceFile }>(
      await POST(
        jsonRequest("http://t/api/files", "POST", {
          originalName: "Expenses_Oct.csv",
          mimeType: "text/csv",
          data: content,
          description: "Monthly expenses table",
        })
      )
    )
    expect(created.status).toBe(201)
    expect(created.body.data?.file).toMatchObject({
      name: "expenses-oct",
      originalName: "Expenses_Oct.csv",
      kind: "text",
      description: "Monthly expenses table",
    })

    const listed = await json<{ files: WorkspaceFile[] }>(await GET())
    expect(listed.status).toBe(200)
    expect(listed.body.data?.files).toHaveLength(1)

    const meta = await json<{ file: WorkspaceFile }>(
      await GET_ONE(new Request("http://t/api/files/expenses-oct"), named("expenses-oct"))
    )
    expect(meta.status).toBe(200)
    expect(meta.body.data?.file.originalName).toBe("Expenses_Oct.csv")

    const rawRes = await GET_ONE(new Request("http://t/api/files/expenses-oct?raw=1"), named("expenses-oct"))
    expect(rawRes.status).toBe(200)
    expect(rawRes.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(await rawRes.text()).toBe("name,amount\nCoffee,4.50\n")

    const patched = await json<{ file: WorkspaceFile }>(
      await PATCH(
        jsonRequest("http://t/api/files/expenses-oct", "PATCH", {
          description: "Updated October CSV",
        }),
        named("expenses-oct")
      )
    )
    expect(patched.status).toBe(200)
    expect(patched.body.data?.file.description).toBe("Updated October CSV")

    const removed = await json<{ deleted: boolean }>(
      await DELETE(new Request("http://t/api/files/expenses-oct"), named("expenses-oct"))
    )
    expect(removed.status).toBe(200)
    expect((await json(await GET_ONE(new Request("http://t/api/files/expenses-oct"), named("expenses-oct")))).status).toBe(404)
  })

  it("rejects invalid file names and bad update bodies", async () => {
    expect((await json(await GET_ONE(new Request("http://t/api/files/Bad"), named("Bad Name")))).status).toBe(400)
    expect(
      (
        await json(
          await PATCH(jsonRequest("http://t/api/files/expenses-oct", "PATCH", {}), named("expenses-oct"))
        )
      ).status
    ).toBe(400)
  })
})
