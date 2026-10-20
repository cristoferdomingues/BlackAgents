import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

test("recent artifacts show the name above the description", async ({ page }) => {
  await stubWorkspace(page, [
    {
      name: "cca-f-study-coach",
      type: "agent",
      description:
        "Quizzes Cristofer with exam-style CCA-F scenario questions drawn from the cca-f-study-plan knowledge.",
    },
  ])

  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto("/")

  const row = page.getByRole("link", { name: /cca-f-study-coach/ })
  await expect(row).toBeVisible()
  const name = row.getByText("cca-f-study-coach", { exact: true })
  const description = row.getByText(/Quizzes Cristofer/)
  const nameBox = await name.boundingBox()
  const descriptionBox = await description.boundingBox()
  expect(nameBox).not.toBeNull()
  expect(descriptionBox).not.toBeNull()
  expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(descriptionBox!.y + 1)
  expect(Math.abs(nameBox!.x - descriptionBox!.x)).toBeLessThan(2)
})
