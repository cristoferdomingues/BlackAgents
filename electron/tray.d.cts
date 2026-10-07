export function trayIconFileName(platform?: string): string

export function trayIconPath(directory: string, platform?: string): string

export function trayMenuTemplate(onOpen: () => void): Array<
  | { label: "Open"; click: () => void }
  | { type: "separator" }
  | { role: "quit" }
>
