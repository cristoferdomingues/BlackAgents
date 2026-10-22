/** What the microphone reported when a listen session ends. */
export type VoiceStopReason = "transcript" | "empty" | "error" | "cancelled"

/**
 * After the microphone stops during Talk mode: retry when nobody spoke,
 * leave Talk mode on a real error, and ignore a normal transcript or a cancel
 * (those are handled by the caller).
 */
export function listenFollowUp(reason: VoiceStopReason): "retry" | "stop" | "ignore" {
  if (reason === "empty") return "retry"
  if (reason === "error") return "stop"
  return "ignore"
}
