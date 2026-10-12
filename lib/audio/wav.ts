/**
 * Recorded voice clips (webm / ogg / mp4 from MediaRecorder) are converted to
 * 16 kHz mono 16-bit WAV before upload: every transcription backend accepts
 * WAV, and the clip stays small.
 */

export const WAV_SAMPLE_RATE = 16_000

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, "data")
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Browser only: decode a recorded clip and return it as base64 WAV. */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const encoded = await blob.arrayBuffer()
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(encoded)
  } finally {
    void ctx.close().catch(() => {})
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return bytesToBase64(encodeWav(rendered.getChannelData(0)))
}
