---
name: design-system
description: >-
  Reference for the BlackAgents design system — shadcn/ui inventory, Tailwind
  tokens, layout templates, UX state patterns, theming, and accessibility. Read
  when building or reviewing UI components and layouts.
---

# BlackAgents Design System

## When to Apply

Read this when building or reviewing anything under `app/**` or `components/features/**`: a new screen, a shared component, a form, or a layout change. Hard constraints live in the `design-system` rule; this file is the lookup reference for *how*.

## Stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 16 App Router, React 19 |
| Styling | Tailwind CSS 3, `darkMode: "class"` |
| Primitives | shadcn/ui (Radix + CVA) in `components/ui/` |
| Theming | `next-themes` (dark default, set in `app/layout.tsx`) |
| Icons | `lucide-react` |
| Forms | `react-hook-form` + `zod` via `@hookform/resolvers` |
| Editor | CodeMirror (`@uiw/react-codemirror`) — Markdown + YAML |
| Preview | `react-markdown` + `remark-gfm` |
| Toasts | `sonner` |
| Tables | `@tanstack/react-table` |
| Fonts | Inter (`next/font/google`) |

## Tokens (use semantic classes, not hex)

- Surfaces: `bg-background`, `bg-card`, `bg-muted`, `bg-popover`.
- Text: `text-foreground`, `text-muted-foreground`, `text-primary`.
- Borders/rings: `border`, `border-input`, `ring-ring`.
- Intent: `text-destructive` / `bg-destructive` for errors and destructive actions.
- Radii/spacing follow the Tailwind scale; avoid arbitrary values like `w-[437px]`.

## Component Library

Prefer these existing primitives before writing anything custom: `Button`, `Input`, `Textarea`, `Label`, `Select`, `Checkbox`, `Switch`, `Dialog`, `DropdownMenu`, `Tabs`, `Card`, `Badge`, `Tooltip`, `Skeleton`, `Table`, `ScrollArea`, `Separator`. Add a missing primitive with the shadcn/ui generator pattern rather than hand-rolling styles.

## Layout Templates

- **App shell**: persistent sidebar (`components/layout/`) + header, content in the main column. New routes slot into this shell.
- **List page** (`/agents`, `/rules`, …): page header + action button (`New <Type>`) + a `@tanstack/react-table` list. Row click opens `/<type>/[name]`.
- **Editor page** (`ArtifactEditor`): a calm header (title, "Unsaved changes" mark, a `More` dropdown for secondary actions, one primary `Save` with ⌘S); one main column of numbered `EditorSection`s; a sticky side panel (summary, live checks, exact file preview, tips, "Try in chat"). New items open on a start step (`StartPicker`: describe it / template / blank).
- **Module page** (`/brain`, …): page header + "How it works" explainer + `Tabs`, where each tab opens with a one-line intro.

## Self-explaining UX

A user who opens a module for the first time must understand it without docs. For every new or changed screen:

- **Name things in plain words.** Short, simple sentences for non-native English readers. Explain internal terms (Jev, memory, globs, MCP) on the screen where they appear.
- **Explain a complex module once.** Add a "How it works" panel (3 numbered steps: input → what the app does → what the user decides). Show it on the first visit, close it with "Got it", remember that in `localStorage` (read it with `useSyncExternalStore`, not `setState` in an effect), and keep a "How it works" button to reopen it.
- **Introduce each tab or section** with one line: what it holds and why it matters (`TabIntro`, `EditorSection` description).
- **Tooltips for labels, not for key facts.** Put definitions of badges, kinds and tabs in a `Tooltip`; anything the user needs to decide stays visible text.
- **Say what an action will do** next to the button ("Approve adds this note to the memory of the coder agent."), and where data comes from ("From your thumbs down in the Assistant. Jev picked it (88% sure).").
- **Show where data lives** (file path) and how to change it.
- **Empty states teach**: a title, a sentence on how it gets filled, links/buttons to the place that fills it, and examples when the content is abstract.
- **Show limits** with a progress bar and what happens when full (e.g. memory budget).
- **Keep copy in an isomorphic `lib/<domain>/explain.ts`** (labels, help, effect sentences) with unit tests, so the same words are reused and checked.

## Form & Editor Patterns

- **Choices over switches**: group raw flags into a few named levels shown as `role="radio"` cards with a one-line summary and a risk dot (`bg-skill` low, `bg-amber-500` medium, `bg-destructive` high); keep a "Custom" escape hatch. Show what is included automatically as locked chips.
- **One question, one control**: replace a switch + free text combo with one radio choice that reveals its detail field ("When does it apply?" → file patterns).
- **Chips from real data** instead of comma-separated inputs (e.g. MCP servers from `/api/mcp`), with "All" as the default and missing items flagged.
- **Live checks**: a checklist with a passed/total count and a hint for each failed item; compute it with an isomorphic helper.
- **Preview the real output** through a server route that uses the same code as save (e.g. `/api/artifacts/preview`) — never re-implement serialization on the client.
- **Try before save** when behavior matters (chat with the unsaved draft); label it "Uses your unsaved changes. Nothing is saved."
- **Protect work**: "Unsaved changes" mark, ⌘S, and a `beforeunload` warning when dirty.
- Fix input while typing when the format is strict (kebab-case names), and suggest values (name from a description).

## Layout Pitfalls

- Scroll containers that hold `sr-only` or other absolutely positioned elements need `relative`, or those elements escape and make the whole page scroll.
- Sticky side panels: `lg:sticky lg:top-6 lg:self-start` with a `max-h-[calc(100vh-…)]` that fits under the app and page headers.

## UX State Patterns

Every data-driven view implements four states:

```tsx
if (isLoading) return <Skeleton className="h-24 w-full" />
if (error) return <ErrorState onRetry={refetch} />        // message + retry
if (items.length === 0) return <EmptyState />             // guidance + primary action
return <List items={items} />                             // success
```

Use `sonner` for the result of an action (`toast.success("Saved")`, `toast.error(err.message)`), not for passive page state.

## Dark Mode

`next-themes` toggles the `class` on `<html>`. Because dark is the default, always check a screen in **both** themes. Never assume a light background — use `bg-background`/`bg-card` so surfaces follow the theme.

## Accessibility

- Every interactive element has an accessible name (visible label, `aria-label`, or `sr-only` text) — icon-only buttons need one.
- Keep `react-hook-form` errors wired to their inputs so messages are announced.
- Ensure keyboard reachability for Dialog, DropdownMenu, and Tabs (Radix handles focus if you don't bypass it).
- Maintain contrast by using foreground/background token pairs rather than custom colors.

## How to Use

Reference-only. The persona and workflow live in the **uiux-designer** agent; the hard guardrails live in the `design-system` rule; `/ux-review` audits a screen against the checklists above. Use this file to look up the primitive, token, layout template, or state pattern, then build with `components/ui/`. When a view needs new server data, coordinate with the **feature-developer** agent and cover it with the **tester** agent.
