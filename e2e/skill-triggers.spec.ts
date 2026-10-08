import { expect, test } from "@playwright/test"

import { stubVerifiedProvider, stubWorkspace } from "./support/stubs"

test.describe("skill triggers", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [
      {
        name: "code-review",
        type: "skill",
        description: "Use when the user asks for a code review.",
      },
    ])
    await stubVerifiedProvider(page)
  })

  test("suggests a skill for a task", async ({ page }) => {
    await page.route("**/api/skills/suggest", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: { kind: "picked", name: "code-review", confidence: 0.93, model: "jev-test", elapsedMs: 12, candidates: 1 },
        },
      })
    )
    await page.goto("/skills")
    await page.getByLabel("Task to match with a skill").fill("review this pull request")
    await page.getByRole("button", { name: "Suggest" }).click()
    const result = page.getByRole("region", { name: "Which skill fits?" })
    await expect(result.getByText("code-review")).toBeVisible()
    await expect(result.getByText("93%")).toBeVisible()
  })

  test("checks a new skill before it is saved", async ({ page }) => {
    await page.route("**/api/skills/eval", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            skill: "code-review",
            verdict: "too-broad",
            summary: "This description is too wide. Unrelated requests may open this skill.",
            warning: "Add “Use when …” so Jev knows when to open this skill.",
            counts: { passed: 1, total: 2, truePositives: 1, trueNegatives: 0, falsePositives: 1, falseNegatives: 0 },
            probes: [
              { prompt: "review this", expect: "trigger", picked: "code-review", confidence: 0.9, pass: true },
              { prompt: "write tests", expect: "skip", picked: "code-review", confidence: 0.9, pass: false },
            ],
          },
        },
      })
    )
    await page.goto("/skills/new")
    await page.getByLabel("Name").fill("code-review")
    await page.getByLabel("Description").fill("Helps with anything.")
    await page.getByRole("button", { name: "Check trigger" }).click()
    await expect(page.getByText("This description is too wide.")).toBeVisible()
    await expect(page.getByText("Add “Use when …”")).toBeVisible()
    await expect(page.getByText("write tests")).toBeVisible()
  })
})
