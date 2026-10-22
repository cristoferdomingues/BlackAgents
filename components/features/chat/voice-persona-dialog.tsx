"use client"

import * as React from "react"

import {
  VOICE_BUTTON,
  VOICE_DEFAULT,
  VOICE_GREETING_HINT,
  VOICE_GREETING_LABEL,
  VOICE_INTRO,
  VOICE_NAME_HINT,
  VOICE_NAME_LABEL,
  VOICE_PICK_LABEL,
  VOICE_STYLE_FULL,
  VOICE_STYLE_FULL_HINT,
  VOICE_STYLE_LABEL,
  VOICE_STYLE_SHORT,
  VOICE_STYLE_SHORT_HINT,
  VOICE_TITLE,
} from "@/lib/chat/explain"
import { talkGreeting, type VoicePersona, type VoiceStyle } from "@/lib/chat/voice-persona"
import { useBrowserVoices } from "@/hooks/use-speaker"
import { useVoicePersona } from "@/hooks/use-voice-persona"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Edit the voice, name, greeting, and speaking style of the open persona. */
export function VoicePersonaButton({ agentName }: { agentName?: string }): React.ReactElement {
  const [persona, setPersona] = useVoicePersona(agentName)
  const voices = useBrowserVoices()
  const greeting = talkGreeting(persona, agentName)

  function patch(partial: Partial<VoicePersona>): void {
    setPersona({ ...persona, ...partial })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {VOICE_BUTTON}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{VOICE_TITLE}</DialogTitle>
          <DialogDescription>{VOICE_INTRO}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="voice-persona-name">{VOICE_NAME_LABEL}</Label>
            <Input
              id="voice-persona-name"
              value={persona.name}
              maxLength={40}
              placeholder={agentName?.trim() || "Assistant"}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{VOICE_NAME_HINT}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voice-persona-voice">{VOICE_PICK_LABEL}</Label>
            <Select
              value={persona.voiceURI || "default"}
              onValueChange={(value) => patch({ voiceURI: value === "default" ? "" : value })}
            >
              <SelectTrigger id="voice-persona-voice" aria-label={VOICE_PICK_LABEL}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{VOICE_DEFAULT}</SelectItem>
                {voices.map((voice) => (
                  <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voice-persona-greeting">{VOICE_GREETING_LABEL}</Label>
            <Input
              id="voice-persona-greeting"
              value={persona.greeting}
              maxLength={200}
              placeholder={greeting}
              onChange={(event) => patch({ greeting: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{VOICE_GREETING_HINT}</p>
            <p className="text-xs text-muted-foreground">Talk starts with: {greeting}</p>
          </div>
          <div className="space-y-2" role="radiogroup" aria-label={VOICE_STYLE_LABEL}>
            <p className="text-sm font-medium">{VOICE_STYLE_LABEL}</p>
            <StyleChoice
              value="short"
              current={persona.style}
              label={VOICE_STYLE_SHORT}
              hint={VOICE_STYLE_SHORT_HINT}
              onPick={(style) => patch({ style })}
            />
            <StyleChoice
              value="normal"
              current={persona.style}
              label={VOICE_STYLE_FULL}
              hint={VOICE_STYLE_FULL_HINT}
              onPick={(style) => patch({ style })}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StyleChoice({
  value,
  current,
  label,
  hint,
  onPick,
}: {
  value: VoiceStyle
  current: VoiceStyle
  label: string
  hint: string
  onPick: (style: VoiceStyle) => void
}): React.ReactElement {
  const selected = value === current
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(value)}
      className={cn(
        "w-full rounded-md border px-3 py-2 text-left",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted"
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </button>
  )
}
