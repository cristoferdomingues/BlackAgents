/** Plain-language copy for the K0ding screen. */

export const K0DING_TITLE = "K0ding"

export const K0DING_INTRO =
  "Open a code project, read the files, and ask the model to change them. Nothing is written until you approve."

export const K0DING_STEPS = [
  {
    title: "1. Open a folder",
    text: "Pick the project you are building, for example an MCP server. You see its files.",
  },
  {
    title: "2. Read and ask",
    text: "Open a file, pin it, and say what to build. The model can look through the rest of the project.",
  },
  {
    title: "3. You approve",
    text: "Each change is a diff. Apply the files you want. The rest stay unwritten.",
  },
] as const

export const OPEN_EFFECT = "Saves this folder for the current project. The files stay where they are."

export const SEND_EFFECT =
  "Sends your text and the pinned files to the model. It can stage changes. It cannot write them."

export const APPLY_EFFECT = "Writes the approved files into the code folder."

export const DISCARD_EFFECT = "Drops these changes. The files on disk stay as they are."

export const SECRET_NOTE = "This file stays on this computer. It is not sent to the model."

export const CODING_MODEL_HELP =
  "Runs K0ding. When this is empty, K0ding uses the Assistant model."

export const RUN_EFFECT = "Runs this command in the code folder. You see the output here."

export const CHECK_EFFECT =
  "After Apply all, this command runs. If it fails, the output goes back to the model."

export const EDIT_EFFECT = "Saves your edit. If the file changed on disk, it is not overwritten."

export const GIT_NOTE = "Git is read only here. K0ding does not commit, push, or change branches."
