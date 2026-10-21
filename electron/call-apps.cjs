const CALL_APPS = [
  { name: "Zoom", pattern: /zoom\.us|zoom\.exe|zoom meeting|\bcpthost\b/i },
  { name: "Teams", pattern: /microsoft teams|msteams|teams\.exe/i },
  { name: "Skype", pattern: /skype/i },
  { name: "FaceTime", pattern: /facetime/i },
  { name: "Webex", pattern: /webex/i },
  { name: "Google Meet", pattern: /google meet|meet - [a-z]{3}-[a-z]{4}-[a-z]{3}/i },
]

/** The first known call app in a process list or window titles. */
function detectCallApp(lines) {
  const text = Array.isArray(lines) ? lines.join("\n") : ""
  const found = CALL_APPS.find((app) => app.pattern.test(text))
  return found ? found.name : null
}

module.exports = { detectCallApp }
