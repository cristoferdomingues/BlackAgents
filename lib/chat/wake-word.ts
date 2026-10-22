/** The phrase that starts Talk. Matched loosely so a speech model can miss a space. */
export const WAKE_PHRASE = "Hello BlackAgents"

const HELLO = /^(?:hello|hey)$/
const BLACK_AGENT = /^blackagents?$/
const AGENT = /^agents?$/

/**
 * True when the text contains the wake phrase, with extra words allowed.
 * "hello black agenda" does not count.
 */
export function wakePhraseHeard(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? ""
    if (BLACK_AGENT.test(word) && HELLO.test(words[index - 1] ?? "")) return true
    if (word === "black" && HELLO.test(words[index - 1] ?? "") && AGENT.test(words[index + 1] ?? "")) return true
    if (/^(?:hello|hey)blackagents?$/.test(word)) return true
  }
  return false
}

/** A plain message for a microphone failure while listening for the wake phrase. */
export function wakeMicMessage(errorName: string): string {
  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError" || errorName === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser settings."
  }
  if (errorName === "NotFoundError") return "No microphone was found."
  return "The wake word could not start. Your voice was not sent. Turn it off and on to try again."
}
