const ALLOWED_PERMISSIONS = new Set([
  "media",
  "microphone",
  "audioCapture",
  "display-capture",
  // navigator.clipboard.writeText() asks for this in Electron. Allow writes
  // (the copy buttons) but keep clipboard reads denied.
  "clipboard-sanitized-write",
])

/**
 * Permissions the app may request. Meeting capture needs the media entries;
 * the Assistant's copy buttons need sanitized clipboard writes. Everything
 * else (including clipboard reads) stays denied.
 */
function allowsAppPermission(permission) {
  return ALLOWED_PERMISSIONS.has(permission)
}

/**
 * How the desktop app hears the other people.
 * Windows can capture computer sound. macOS cannot, in this Electron version.
 * Other systems fall back to the system share picker.
 */
function systemAudioMode(platform) {
  if (platform === "win32") return "loopback"
  if (platform === "darwin") return "unavailable"
  return "picker"
}

module.exports = {
  allowsAppPermission,
  systemAudioMode,
}
