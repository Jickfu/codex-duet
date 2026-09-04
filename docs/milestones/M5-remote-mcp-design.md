# M5 remote MCP access — design proposal

Status: **LOCAL VALIDATION PASSED / LIVE NETWORK AND CHATGPT ACCEPTANCE PENDING**, 2026-09-04.

Baseline: `ee76d03`, the integrated M4 local-scope freeze. The user accepted temporary-address development with local authorization. This record does not claim real ChatGPT acceptance. See [implementation and setup](../remote-local-mode.md).

## Verified starting point

`LocalMcpServer` binds loopback only, rejects foreign Host/Origin headers and exposes eight immutable-snapshot read tools. Reads have no remote authentication boundary. The optional `submit_response` capability authorizes one exact task/control response; it does not authorize remote snapshot reads. Directly tunnelling the M4 listener is prohibited by `docs/security.md`.

The M4 freeze records 497 passing tests and one platform skip; these are historical gate results, not a new M5 test run. Its acceptance uses Browser fixtures. Current documentation also records the user's replacement of external development review with implementation and self-review; no independent ChatGPT approval is claimed.

## Proposed first delivery

Keep cloudflared as LOCAL transport and add a separate authenticated remote service boundary. Preserve M4 loopback behavior, snapshot authority, Browser control and GITHUB semantics.

1. Establish a canonical HTTPS resource identity and an OAuth authorization server. The user has confirmed that no fixed domain or existing identity provider is available and approved the infrastructure-free development direction below.
2. Add protected-resource discovery and authentication before MCP dispatch. Validate token authenticity, issuer, audience, expiry and scope. Bind authorized access to the explicitly selected workspace/task; a valid identity alone must not authorize arbitrary task IDs or historical snapshots.
3. Expose only the existing eight bounded read tools initially. Keep `submit_response` disabled on the remote surface; existing Browser response ingress supports the initial end-to-end path. Remote return capabilities require a later explicit delivery design.
4. Manage the authenticated listener and cloudflared as one owned foreground lifetime. Validate configuration before launching, use structured process arguments, keep credentials out of logs, and close owned resources on startup failure, termination or tunnel loss. Do not adopt or terminate processes solely by a stored PID. Restart must not resend Browser controls or grant execution authority.
5. Verify authentication, task isolation, request bounds and lifecycle with local fixtures before a real ChatGPT test. Then prove selected-task snapshot reads, planning, execution, review and shutdown against a dedicated non-sensitive acceptance workspace.

These requirements define the development direction. The implementation and its verification limits are recorded below; live interoperability is not inferred from local tests.

## Official compatibility evidence

Checked on 2026-09-04:

- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode) documents streaming HTTP and OAuth support, including configured OAuth clients. It does not establish an arbitrary static HTTP bearer-token setup for this project.
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth) documents protected-resource discovery, authorization-code flow with PKCE, resource binding and per-request token validation. Use the exact redirect URI displayed for the connection. Client registration and authorization-server compatibility need verification against the chosen deployment.

The proposal selects authenticated access because LOCAL snapshots can contain private code. Public no-auth access or a hard-to-guess URL is not a substitute for this boundary. No claim is made that Cloudflare Access login or service-token headers alone satisfy ChatGPT's OAuth flow.

## Infrastructure-free development proposal

User input on 2026-09-04: no fixed domain and no existing OAuth/OIDC identity provider.

The accepted direction is a single-user development mode with a Cloudflare Quick Tunnel and a narrowly scoped local OAuth authorization service. No account registration, password database, third-party identity tenant or purchased domain is required by this design. The user explicitly approved the additional narrow OAuth implementation.

- Quick Tunnel assigns a temporary HTTPS hostname. Pin that identity for one foreground service lifetime; reject data access until the identity is established. A new hostname requires a new ChatGPT connection/configuration and authorization; do not silently replace an existing resource identity.
- Cloudflare documents that Quick Tunnels are for development, have no uptime guarantee and do not support SSE. Use the Streamable HTTP JSON-response form for the proposed remote listener, with no standalone SSE stream. The installed MCP SDK exposes `enableJsonResponse`; keep frozen M4 defaults unchanged. MCP protocol support does not prove that the real ChatGPT/Quick Tunnel combination works: test that combination before expanding the implementation.
- Authenticate the operator through a local-only approval command for the exact pending OAuth request, showing the client, resource and selected task. Public authorization requests alone cannot issue codes or tokens. Do not put local approval secrets in public pages, Browser controls or tool inputs. No web-accessible auto-approve endpoint.
- Use authorization code plus S256 PKCE, exact configured ChatGPT redirect URI/client binding, short-lived one-use codes and short-lived opaque access tokens. Bind grants to this service lifetime and task. Initially omit refresh tokens; stopping or restarting invalidates all grants and requires authorization again.
- Keep pending authorizations bounded and expiring. Reject redirect substitution, code replay, wrong verifier/client/resource, expired tokens and cross-task reads. Local approval must be explicit human action; normal planning/review rounds within a valid grant do not need new login.
- Expose read tools only. Continue returning control responses through the existing Browser provider.

Sources checked on 2026-09-04: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) and [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). The latter permits JSON POST responses and HTTP 405 for an unsupported standalone SSE GET stream. This is a proposed development route, not production readiness or confirmed live interoperability.

## Accepted decision

The user explicitly agreed to temporary-address, local-approval development mode, including reconnecting after service restarts and the narrow OAuth implementation. Continue implementation and self-review under this direction. No domain purchase or third-party identity provisioning is needed for this stage. Human approval of a real OAuth request remains an operational step, not another architecture decision.

## Acceptance gates after that decision

- Unauthenticated, expired, wrong-audience and insufficient-scope requests cannot access snapshot tools; configured discovery exposes no repository data.
- Authenticated requests cannot select another workspace/task or widen the granted snapshot surface.
- Streaming/chunked and oversized requests remain bounded; forwarded headers cannot redefine the configured public identity.
- Startup failure, disconnect and explicit stop close owned resources; no automatic public fallback, task replay or unrelated process termination occurs.
- Existing local/GITHUB regression passes; live remote evidence is recorded separately from fixture results.
- A real ChatGPT LOCAL exchange succeeds without bulk code on the Browser Control Plane or workspace writes through MCP.

## Implementation and verification record

The additive `local remote-serve` command composes a separate authenticated JSON MCP listener, ephemeral OAuth authority, formal task/snapshot/iteration grants and an IPC supervisor for cloudflared. M4 loopback behavior and frozen Browser/GITHUB/core schemas remain unchanged. Remote `submit_response` remains disabled by omission.

Final local gates passed: typecheck, lint, build, touched-file formatting and whitespace checks. The final full serial suite passed **53 files, 527 tests, one platform skip** (528 total). Source/tests were fixed during this final run. An earlier run overlapped a refinement of the evidence-iteration grant; its mixed-version failure is superseded by the subsequent focused pass and this complete rerun.

New coverage includes local OAuth approval/denial, PKCE and redirect/resource/client substitution, expiration and replay, actual loopback JSON MCP dispatch, foreign task/unpublished snapshot rejection, real Git formal-review grants, bounded tunnel output parsing and forced parent-process termination with supervised child cleanup. These are local tests, not real ChatGPT acceptance.

cloudflared `2026.8.3` was obtained from the official Cloudflare GitHub release and its Windows amd64 executable matched published SHA-256 `83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae`. It is kept only in gitignored local tooling, not installed globally or committed.

Actual Quick Tunnel attempts produced temporary hostnames, but HTTPS discovery from this machine failed with `ECONNRESET` in Node; a separate Windows HTTP probe failed with `WebException`. No authenticated public MCP round trip was established. The external web probe declined to open the temporary URL, so it supplies no independent reachability evidence. Only synthetic non-repository data was configured for these probes, with no real ChatGPT account grant. Each probe closed its service/tunnel. Results remain in gitignored local smoke records.

Remaining gate: establish a usable network path, then verify the real ChatGPT connection, human local authorization and LOCAL planning/review loop against a non-sensitive acceptance task. Do not freeze M5 or integrate it as a completed remote milestone before that evidence exists.
