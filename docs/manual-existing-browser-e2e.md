# Native existing-browser manual E2E

## Extension

1. Install the official Playwright Extension in everyday Chrome and Edge.
2. Log in to ChatGPT normally and leave a ChatGPT tab open.
3. Run `chatbridge browser doctor`, then `chatbridge browser attach`.
4. Verify mode is `existing-extension`, no second profile/browser is created, and no browser download occurs.
5. Run `chatbridge send --message-file <file>` and `chatbridge wait`; verify only the final payload prints.
6. Run `chatbridge browser detach`; verify browser and tabs remain open.

## Channel CDP

1. In normal Chrome/Edge visit `chrome://inspect/#remote-debugging` and authorize remote debugging.
2. Attach with `--transport cdp --browser chrome` or `msedge`.
3. Repeat send/wait/detach without a command-line browser restart.

For final M1 acceptance, keep multiple ChatGPT tabs open, select the intended conversation, and complete two consecutive `send -> wait` rounds. Inspect `.chatbridge/session.json` only for schema validation: it must be version 2 and contain `conversationUrl`, `outgoingUserMessageId`, optional `previousAssistantMessageId`, and `sentAt`; it must not contain message text. Each wait must print only the exact final response.

M1 acceptance completed on Windows 10 using the normal Chrome profile and official Playwright CLI Channel CDP transport. Two consecutive rounds returned the exact expected payloads, the version-2 checkpoints contained metadata only, and detach preserved Chrome, all tabs, and login state. The first attach may require interactive Chrome remote-debugging approval and return unavailable; retry after approval is expected UX.

### CLI sandbox baseline

The official Playwright CLI `run-code` sandbox is a restricted execution environment, not web-page JavaScript and not complete Node.js. Native Channel CDP probing established this compatibility baseline:

| Capability                                        | Observed    |
| ------------------------------------------------- | ----------- |
| `Date`, `Promise`, `JSON`, `Math`                 | available   |
| `encodeURIComponent`, `decodeURIComponent`        | available   |
| `page.waitForTimeout`                             | available   |
| `URL`                                             | unavailable |
| `setTimeout`, `clearTimeout`                      | unavailable |
| `TextEncoder`, `Buffer`, `process`, `performance` | unavailable |

Generated production operations use the supplied Playwright `page`, its reachable Page APIs, and only the verified sandbox primitives. Node normalizes configured origins before generation, sandbox matching uses exact origin boundaries, and every delay uses `page.waitForTimeout`.

For a compatibility investigation, capability `typeof` values may be recorded as manual diagnostics. Submitted source, tab lists, snapshots, and DOM output must never be emitted by the normal control plane.

Assistant DOM count is not a checkpoint: virtualization can replace `A B C` with `B C D` while the count remains three. Stable `data-message-id` is the response identity. `data-testid="conversation-turn-N"` may help manual diagnostics but is not a causal or sequential identity.

## Security

Keep an unrelated tab open, navigate the selected ChatGPT tab away during streaming, and verify `ORIGIN_DENIED` with no foreign DOM or text returned.
