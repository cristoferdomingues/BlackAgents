---
name: time-registration
description: How to teach and replay a company timesheet browser flow in BlackAgents.
---

## Teach the flow

1. Open the **BlackAgents desktop** app.
2. **Settings → Browser** → Enable Playwright MCP → Start recording.
3. In **Assistant**, pick an agent with the `browser` MCP server (or the generic assistant after setup) and coach the clicks, or drive the headed Chromium window via browser tools.
4. Stop recording and save as `time-registration` (creates skill/agent bindings).

Alternatively, coach in chat without recording, then use **Save as browser flow** on the tool trace card.

## Replay

- Manual: chat with **time-registrar** and say "run time-registration".
- Scheduled: **Settings → Browser → Daily bind** (or a workflow with a daily trigger). The desktop app must be open.

## Auth failures

If SSO/cookies expired, open Settings → Browser, start a headed session, log in once, then rerun.
