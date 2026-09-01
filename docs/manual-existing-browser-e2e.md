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

### CLI sandbox baseline

The official Playwright CLI `run-code` sandbox has been observed to report both `typeof URL` and `typeof globalThis.URL` as `"undefined"`. Generated production operations therefore use only the supplied Playwright `page` object and ordinary ECMAScript primitives; they must not assume Node globals or a complete browser-global environment. Node normalizes configured origins before generating an operation, and sandbox matching uses exact origin boundaries.

For a compatibility investigation, record `typeof URL` and `typeof globalThis.URL` as manual diagnostics. These values, submitted source, tab lists, snapshots, and DOM output must never be emitted by the normal control plane.

Assistant DOM count is not a checkpoint: virtualization can replace `A B C` with `B C D` while the count remains three. Stable `data-message-id` is the response identity. `data-testid="conversation-turn-N"` may help manual diagnostics but is not a causal or sequential identity.

## Security

Keep an unrelated tab open, navigate the selected ChatGPT tab away during streaming, and verify `ORIGIN_DENIED` with no foreign DOM or text returned.
