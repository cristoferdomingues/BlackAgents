/** Secret ids for a workflow step that signs in. Values live in secrets.json. */
export function loginSecretIds(
  workflow: string,
  stepId: string
): { username: string; password: string } {
  return {
    username: `browser.${workflow}.${stepId}.username`,
    password: `browser.${workflow}.${stepId}.password`,
  }
}

/** Instruction for the agent. It names secret ids, never the password. */
export function loginStepNote(workflow: string, stepId: string): string {
  const ids = loginSecretIds(workflow, stepId)
  return [
    "## Login",
    "",
    "This step signs in to a website.",
    `Call browser_fill_login with usernameSecretId "${ids.username}" and passwordSecretId "${ids.password}".`,
    "Never print, invent, or ask the user to repeat the password.",
  ].join("\n")
}

export function alreadyLoggedInNote(): string {
  return [
    "## Login",
    "",
    "The user already signed in in the browser window.",
    "Continue the task. Do not fill the login form again and do not ask for the password.",
  ].join("\n")
}
