import { createServer } from "node:http"
import { afterEach, describe, expect, it } from "vitest"

import {
  getAvailablePort,
  isSafeExternalUrl,
  waitForServer,
} from "../../../electron/server-utils.cjs"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

describe("Electron server utilities", () => {
  it("allocates a port that can be bound locally", async () => {
    const port = await getAvailablePort()
    const server = createServer()
    servers.push(server)

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolve)
    })

    expect(server.address()).toMatchObject({ port })
  })

  it("waits until the local application server responds", async () => {
    const port = await getAvailablePort()
    const server = createServer((_request, response) => {
      response.writeHead(200)
      response.end("ready")
    })
    servers.push(server)
    server.listen(port, "127.0.0.1")

    await expect(
      waitForServer(`http://127.0.0.1:${port}`, {
        timeoutMs: 1_000,
        intervalMs: 10,
      })
    ).resolves.toBeUndefined()
  })

  it("allows only HTTP links to leave the desktop shell", () => {
    expect(isSafeExternalUrl("https://example.com/docs")).toBe(true)
    expect(isSafeExternalUrl("http://localhost:11434")).toBe(true)
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false)
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeExternalUrl("not a url")).toBe(false)
  })
})
