const http = require("node:http")
const net = require("node:net")

function getAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!port) {
          reject(new Error("Could not allocate a local port"))
          return
        }
        resolve(port)
      })
    })
  })
}

function probe(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(Boolean(response.statusCode && response.statusCode < 500))
    })
    request.setTimeout(1_000, () => request.destroy())
    request.once("error", () => resolve(false))
  })
}

async function waitForServer(
  url,
  { timeoutMs = 30_000, intervalMs = 100 } = {}
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(url)) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for the application server at ${url}`)
}

function isSafeExternalUrl(value) {
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

module.exports = {
  getAvailablePort,
  isSafeExternalUrl,
  waitForServer,
}
