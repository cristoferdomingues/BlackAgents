// Fails the build when electron-builder did not include the shell's runtime
// dependencies in the packaged archive.
//
// electron-builder packages `electron/` as the app directory. If
// `electron/node_modules` is absent it silently falls back to the web app's
// node_modules, producing an installer that crashes with
// "Cannot find module 'electron-log/main'" on launch. This check runs after the
// archive is written so every packaging path (local or CI) is covered.

const path = require("node:path")
const { listPackage } = require("@electron/asar")

const { dependencies = {} } = require("./package.json")

function resourcesDirectory(context) {
  if (context.electronPlatformName !== "darwin") {
    return path.join(context.appOutDir, "resources")
  }
  const bundle = `${context.packager.appInfo.productFilename}.app`
  return path.join(context.appOutDir, bundle, "Contents", "Resources")
}

exports.default = async function verifyPackagedDeps(context) {
  const asarPath = path.join(resourcesDirectory(context), "app.asar")
  const entries = new Set(listPackage(asarPath).map((entry) => entry.replaceAll("\\", "/")))

  const missing = Object.keys(dependencies).filter(
    (name) => !entries.has(`/node_modules/${name}/package.json`)
  )
  if (missing.length === 0) return

  throw new Error(
    `The packaged app is missing main-process dependencies: ${missing.join(", ")}.\n` +
      "Install them with `npm run desktop:deps` (or `npm ci --prefix electron`) and package again.\n" +
      "Without `electron/node_modules`, electron-builder bundles the web app's node_modules instead."
  )
}
