export interface LoginFieldRefs {
  usernameRef?: string
  usernameLabel?: string
  passwordRef?: string
  passwordLabel?: string
  submitRef?: string
  submitLabel?: string
}

const CONTROL_RE = /(textbox|button)\s+"([^"]*)"[^\n]*\[ref=([A-Za-z0-9_-]+)\]/gi

function isPassword(label: string): boolean {
  return /pass(?:word)?|passwd|senha|pwd/i.test(label)
}

function isUsername(label: string): boolean {
  return /user|e-?mail|login|account|usu[aá]rio/i.test(label) && !isPassword(label)
}

function isSubmit(label: string): boolean {
  return /sign\s*in|log\s*in|login|submit|continue|entrar|acessar/i.test(label)
}

/** Find username, password, and submit controls in a Playwright accessibility snapshot. */
export function findLoginFields(snapshot: string): LoginFieldRefs {
  const found: LoginFieldRefs = {}
  for (const match of snapshot.matchAll(CONTROL_RE)) {
    const kind = match[1]?.toLowerCase()
    const label = match[2] ?? ""
    const ref = match[3]
    if (!ref) continue
    if (kind === "textbox" && isPassword(label) && !found.passwordRef) {
      found.passwordRef = ref
      found.passwordLabel = label
    } else if (kind === "textbox" && isUsername(label) && !found.usernameRef) {
      found.usernameRef = ref
      found.usernameLabel = label
    } else if (kind === "button" && isSubmit(label) && !found.submitRef) {
      found.submitRef = ref
      found.submitLabel = label
    }
  }
  return found
}

export interface FillLoginDeps {
  username: string
  password: string
  fields: LoginFieldRefs
  typeText: (ref: string, text: string, element: string, submit: boolean) => Promise<string | undefined>
  click: (ref: string, element: string) => Promise<string | undefined>
}

/** Type the saved login into fields that were already found. Never includes the password in errors. */
export async function fillLoginFields(
  deps: FillLoginDeps
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { fields } = deps
  if (!fields.usernameRef || !fields.passwordRef) {
    return {
      ok: false,
      error:
        "LOGIN_REQUIRED: the page has no username and password fields yet. Open the login page, then try again.",
    }
  }
  const userError = await deps.typeText(
    fields.usernameRef,
    deps.username,
    fields.usernameLabel || "Username",
    false
  )
  if (userError) return { ok: false, error: "Could not type the username." }
  const submitWithPassword = !fields.submitRef
  const passError = await deps.typeText(
    fields.passwordRef,
    deps.password,
    fields.passwordLabel || "Password",
    submitWithPassword
  )
  if (passError) return { ok: false, error: "Could not type the password." }
  if (fields.submitRef) {
    const clickError = await deps.click(fields.submitRef, fields.submitLabel || "Sign in")
    if (clickError) return { ok: false, error: "Could not click the sign-in button." }
  }
  return { ok: true }
}
