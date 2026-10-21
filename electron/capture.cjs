const MEDIA_PERMISSIONS = new Set(["media", "microphone", "audioCapture", "display-capture"])

/** Media permissions the meeting listener may ask for. */
function allowsMeetingPermission(permission) {
  return MEDIA_PERMISSIONS.has(permission)
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
  allowsMeetingPermission,
  systemAudioMode,
}
