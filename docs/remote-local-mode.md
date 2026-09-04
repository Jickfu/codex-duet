# LOCAL remote development mode (M5)

Status: local validation passed; public round-trip and real ChatGPT acceptance remain pending. This single-user development path needs no domain or external identity provider. It uses a temporary Cloudflare Quick Tunnel, JSON MCP responses and a local OAuth approval step. See the [validation and network probe record](milestones/M5-remote-mcp-design.md#implementation-and-verification-record).

## Start and connect

Build codex-duet and install cloudflared from its official distribution. The CLI does not download or install executables. Run from the root of an **existing initialized LOCAL task**, in an interactive terminal:

```text
chatbridge local remote-serve --task demo --cloudflared <path-to-cloudflared>
```

The foreground service prints a temporary HTTPS `/mcp` URL. Create a ChatGPT developer-mode connection with that URL, OAuth and dynamic client registration. The implemented token endpoint authentication method is `none` (a public OAuth client using PKCE, not anonymous MCP access). No client secret or refresh token is issued. This client configuration still needs live ChatGPT verification.

The default callback is `https://chatgpt.com/connector_platform_oauth_redirect`, with issuer identification enabled. Check the callback shown by ChatGPT. If different, restart with `--redirect-uri <exact-uri>` and use the new tunnel URL. Only the stable ChatGPT callback or an exact `https://chatgpt.com/connector/oauth/<id>` is accepted; no wildcard redirects or automatic callback changes.

When connecting, the authorization page shows a request ID. Match it with the request shown in the foreground terminal, including the client, resource and task. Type `approve <request-id>` there, or `deny <request-id>`. A web request cannot approve itself. Approve only a connection you initiated; never approve a request merely because it appears in the terminal. The page polls until the decision, then redirects to ChatGPT with a one-use authorization code.

The same authorization serves normal reads for one hour. Codes expire after 60 seconds, pending requests after three minutes. Expiration requires another authorization; stopping or restarting invalidates all clients, codes and tokens. A changed temporary URL requires a new connection. Type `stop`, press Ctrl+C or close the terminal to end exposure. Run edits and lifecycle commands in a separate terminal while the service is running.

## Exact access boundary

The service opens no GitHub path and sends no Browser control. It does not initialize/reset the named task, capture new source, publish a review, run tests, execute a plan or write workspace content. Existing Browser confirmation and response-ingress gates still own the development loop.

The eight existing read tools are exposed after OAuth authentication. A grant is tied to one workspace/task and permits its baseline plus current and previous **formally prepared** review snapshots. An ordinary dirty capture does not widen access. Test/execution evidence additionally requires the corresponding current/previous formal review iteration. Older review snapshots and unrelated tasks are refused, even if their IDs are known. When a current snapshot is identical to an earlier snapshot, identical captured bytes retain the same content identity.

`submit_response` is absent from this remote surface. Return planning/review control through the selected Browser provider. The M4 loopback listener remains separate and must not be directly tunnelled.

## Transport, process ownership and limits

The authenticated listener binds `127.0.0.1` on an ephemeral port. Until a Quick Tunnel hostname is pinned, all requests return 503. Host and Origin are validated against explicit authority; forwarded headers never set the public identity. JSON Streamable HTTP avoids the Quick Tunnel SSE limitation; standalone SSE GET requests receive 405 after authentication.

The CLI owns an IPC supervisor that owns cloudflared. Losing the CLI's IPC connection, including a forced parent-process termination, tells the supervisor to terminate cloudflared. Normal shutdown revokes grants and closes the listener before ending the tunnel. A tunnel process exit or different reported hostname ends the service; no new tunnel, Browser resend or PID adoption is attempted. Temporary network interruptions inside a still-running cloudflared process may be retried by cloudflared itself; those do not rotate the pinned identity or grant new authority. Simultaneous forced termination of the supervisor and parent is outside this cleanup guarantee.

Development bounds: 32 TCP connections, eight active requests, 120 requests per minute across the endpoint, 8 KiB headers/URL, 64 KiB actual body bytes, 15-second request handling deadline and the existing 256 KiB read-result bound. Chunked bodies are measured while reading. Oversize streams can be closed instead of returning a body. OAuth stores are memory-only and bounded to eight pending requests and 32 clients/codes/tokens each. Client registrations live until shutdown; exhaustion fails closed and requires an explicit restart. These local bounds do not provide a public availability guarantee.

Tokens and code lookup keys are digested in memory. No OAuth payloads, cloudflared logs, source bodies or credentials are logged by this service. The authorization-result ticket is only a retrieval handle, not local approval authority; responses use no-store and no-referrer policies. Existing snapshot filename/location exclusions still apply and are not a general content secret scanner.

## Acceptance still required

Local tests cover the OAuth and JSON MCP exchange, isolation, immutable real-Git reads and supervisor cleanup. They cannot prove that the user's ChatGPT account accepts this client configuration or that the selected network carries the tunnel. Real acceptance must use a non-sensitive fixture task and verify ChatGPT tool discovery/reads, the Browser planning/review loop and explicit shutdown. Do not mark M5 frozen before that evidence exists.

Sources checked on 2026-09-04: [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Cloudflare Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
