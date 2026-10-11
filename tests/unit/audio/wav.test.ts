import { describe, expect, it } from "vitest"

import { bytesToBase64, encodeWav, WAV_SAMPLE_RATE } from "@/lib/audio/wav"

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]))
    const view = new DataView(wav.buffer)
    expect(wav.length).toBe(44 + 8)
    expect(ascii(wav, 0, 4)).toBe("RIFF")
    expect(ascii(wav, 8, 4)).toBe("WAVE")
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(WAV_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
  })

  it("clamps samples to the 16-bit range", () => {
    const wav = encodeWav(new Float32Array([2, -2]))
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })
})

describe("bytesToBase64", () => {
  it("matches Buffer encoding, also for large input", () => {
    const small = new Uint8Array([104, 105])
    expect(bytesToBase64(small)).toBe("aGk=")
    const large = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(bytesToBase64(large)).toBe(Buffer.from(large).toString("base64"))
  })
})
