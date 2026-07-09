---
name: design-system
description: Reference for the BlackAgents design system — shadcn/ui inventory, Tailwind tokens, layout templates, UX state patterns, theming, and accessibility. Read when building or reviewing UI components and layouts.
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
- **Editor page**: form (`ArtifactEditor`) with CodeMirror body + live `react-markdown` preview, standards hints, and a sticky action row (Save + assistant buttons).

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

Reference-only. The persona and workflow live in the **uiux-designer** agent; the hard guardrails live in the `design-system` rule. Use this file to look up the primitive, token, layout template, or state pattern, then build with `components/ui/`. When a view needs new server data, coordinate with the **feature-developer** agent and cover it with the **tester** agent.
