import type { McpTransportType } from "@/lib/mcp/types"

/** Plain-language help for Settings (safe for the browser). */

export const SETTINGS_INTRO_STORAGE_KEY = "black-agents:settings-intro-dismissed"

export const SETTINGS_INTRO =
  "Pick a workspace folder, then connect tools and AI options for that folder."

export const HOW_IT_WORKS_TITLE = "How Settings works"

export const HOW_IT_WORKS_STEPS: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: "1. Choose a folder",
    text: "Create a new workspace, or open a folder you already have. That folder is the one this app reads and writes.",
  },
  {
    title: "2. Connect tools",
    text: "Add MCP servers or the browser for that folder. Tokens stay in your secrets file, not in the project.",
  },
  {
    title: "3. You choose what to save",
    text: "Edit a server, set how much you trust it, and save AI options. Nothing is written until you save.",
  },
]

export const TAB_INTRO = {
  create: "Make a new folder and fill it with a starter kit so your agents have a place to work.",
  open: "Add a folder that is already on your computer, and make it the active workspace.",
  mcp: "MCP (Model Context Protocol) lets an agent call tools on another program. Servers here belong to the active folder.",
  browser: "Record steps in a browser, then run those steps again later.",
  ai: "Set how the assistant writes files, and the optional Jev helper.",
} as const

export const TAB_TOOLTIP = {
  create: "New folder with a starter kit",
  open: "Use a folder you already have",
  mcp: "Tools from other programs",
  browser: "Record and replay a browser",
  ai: "Assistant limits and Jev",
} as const

export const TERM_MCP =
  "MCP means Model Context Protocol. It is a way for an agent to call tools on another program."

export const TERM_SSE =
  "SSE (Server-Sent Events) is an older live connection. It opens the URL with GET. Prefer HTTP when the server supports it."

export const TERM_HTTP =
  "Uses HTTP POST. The address should end with the MCP path, like /api/mcp."

export const TERM_COMMAND =
  "Command starts a program on this computer. Use it for local tools such as npx."

export const TERM_JEV =
  "Jev is an optional helper. It picks which notes and files go into a chat, and what the Brain should learn. When it is off, chats still work."

export const TERM_TRUST =
  "Trust controls when a server's tools must ask you. Trusted runs without asking. Ask checks first unless file writes are already allowed. Risky asks every time."

export const TRUST_LEVELS = [
  { value: "trusted", label: "Trusted", hint: "Calls run without asking" },
  { value: "ask", label: "Ask", hint: "Asks unless file writes are allowed" },
  { value: "risky", label: "Risky", hint: "Asks for every call" },
] as const

export const MCP_WHERE =
  "Saved in .black-agents/mcp.json. Tokens stay in ~/.black-agents/secrets.json."

export const ENV_SECRET_HELP =
  "Environment variables for the command, such as an API key. Values are saved as secrets. Only a ${secret:…} placeholder is written to .black-agents/mcp.json."

export const HEADER_SECRET_HELP =
  "For GitHub, use the header name Authorization and a value like Bearer ghp_…. Values are saved as secrets. Only a ${secret:…} placeholder is written to .black-agents/mcp.json."

export const SECRET_KEEP_HELP =
  "Leave a secret blank to keep the stored value. Type a new value to replace it. Remove the row to drop it from this server."

export const NAME_FIXED_HELP = "The name stays the same. To use a new name, delete this server and add it again."

export const UNSAVED_CHANGES = "Unsaved changes"

export const SAVE_OR_CANCEL = "Save or cancel your changes first."

export const ACTION = {
  createWorkspace: "Create makes this folder and sets it as the active workspace.",
  openWorkspace: "Open adds this folder to Saved workspaces and makes it active.",
  setActive: "Set active switches BlackAgents to this folder.",
  removeWorkspace: "Remove takes this folder off the list. Files stay on disk.",
  testAndSave:
    "Test & Save checks the connection, then writes the server into .black-agents/mcp.json.",
  saveChanges:
    "Save changes checks the connection, then updates this server. A blank secret keeps the stored value.",
  cancelEdit: "Cancel drops these edits. The saved server stays as it is.",
  cancelAdd: "Cancel clears this form. Nothing is saved.",
  enableBrowser:
    "Enable Playwright MCP adds the browser server to this workspace. Trust starts as Risky, so each call asks you first.",
  startRecording: "Start recording keeps successful browser steps so you can save them as a flow.",
  stopAndSave:
    "Stop & save writes the flow under .black-agents/browser-flows/ and can create a skill and an agent.",
  dailyBind: "Daily bind creates a workflow that runs this flow at the time you set, while the desktop app is open.",
  saveTurns: "Save stores this limit for assistant replies.",
  testJev: "Test connection calls Jev with the saved key. It does not change settings.",
} as const

export const EMPTY = {
  mcpTitle: "No MCP servers yet",
  mcpText:
    "Add one in the form below. After it connects, agents can call its tools in chat. The list is stored in .black-agents/mcp.json.",
  mcpAction: "Add a server",
  workspacesTitle: "No workspaces yet",
  workspacesText: "Create a new folder, or open one you already have. The active workspace is the folder this app reads and writes.",
  flowsTitle: "No saved flows yet",
  flowsText:
    "Record a flow above, then use the Assistant with the browser tools. Stop & save stores it in .black-agents/browser-flows/.",
  secretsTitle: "No flow secrets yet",
  secretsText:
    "When you save a flow that fills a password, the secret name shows up here. The value is stored outside the flow file.",
  noWorkspaceMcp: "Create or open a workspace first. MCP servers belong to the active folder.",
  noWorkspaceBrowser: "Create or open a workspace first. Browser settings belong to the active folder.",
} as const

export const MCP_LOAD_ERROR = "Could not load MCP servers."
export const BROWSER_LOAD_ERROR = "Could not load browser settings."

export const FILE_WRITES_LABEL = "Allow file writes without asking"
export const FILE_WRITES_DIALOG_TITLE = "Allow file writes without asking?"
export const FILE_WRITES_DIALOG_BODY =
  "The assistant can create and change files in your workspace without asking you. It can overwrite a file you did not want to change. Check the files after each chat. Writes into config folders still ask."
export const FILE_WRITES_ALERT =
  "File writes run with no approval. The assistant can create and overwrite files in your workspace, including files you did not mean to change. Check the files after a chat. Writes into config folders still ask."
export const FILE_WRITES_OFF =
  "Off: each file write asks you to deny it, allow it for that message, or allow it for the chat."

export function transportHelp(transport: McpTransportType): string {
  if (transport === "http") return TERM_HTTP
  if (transport === "sse") return TERM_SSE
  return TERM_COMMAND
}

export function editServerLabel(name: string): string {
  return `Edit ${name}`
}

export function deleteServerLabel(name: string): string {
  return `Delete ${name}`
}

export function deleteServerTitle(name: string): string {
  return `Delete ${name}?`
}

export function deleteServerEffect(name: string): string {
  return `Delete removes ${name} from this workspace and deletes its saved tokens.`
}

export function keptSecretPlaceholder(last4: string | undefined): string {
  return last4 ? `Saved ••••${last4}. Blank keeps it.` : "Blank keeps the saved secret"
}

export function mcpConnectionMessage(input: {
  status: "connected" | "error" | "disabled"
  toolCount: number
  error?: string
}): string {
  if (input.status === "connected") {
    return input.toolCount === 1 ? "Connected. 1 tool ready." : `Connected. ${input.toolCount} tools ready.`
  }
  if (input.status === "disabled") return "Saved. This server is turned off."
  return input.error ? `Not connected. ${input.error}` : "Not connected."
}

export function mcpSaveFeedback(input: {
  status: "connected" | "error" | "disabled"
  toolCount: number
  error?: string
}): { tone: "ok" | "error"; detail: string; toast: string } {
  const detail = mcpConnectionMessage(input)
  if (input.status === "error") {
    const rest = detail.charAt(0).toLowerCase() + detail.slice(1)
    return { tone: "error", detail, toast: `Saved, but ${rest}` }
  }
  return { tone: "ok", detail, toast: detail }
}
