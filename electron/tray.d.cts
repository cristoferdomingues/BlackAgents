export function trayIconFileName(platform?: string): string

export function trayIconPath(directory: string, platform?: string): string

export function trayMenuTemplate(
  onOpen: () => void,
  onListen?: () => void
): Array<
  | { label: "Open"; click: () => void }
  | { label: "Start listening"; click: () => void }
  | { type: "separator" }
  | { role: "quit" }
>
