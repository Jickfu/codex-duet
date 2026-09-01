# Architecture

## Responsibility boundary

ChatGPT Web plans and reviews; Codex executes. ChatGPT must never edit local files, run shell commands, commit, push, or cause other workspace side effects. The public C2C protocol and state machine do not depend on a particular local bridge implementation.

## Planes and modes

The **Control Plane** carries small machine-readable lifecycle messages. The **Data Plane** gives ChatGPT read-only access to the code context without copying large source trees or diffs through Codex context.

In **LOCAL mode**, Codex sends control messages through Playwright. A future remote MCP endpoint backed by a local read-only bridge provides the data plane and returns `submit_response` events to Codex. Codex does not poll the page for replies. In **GITHUB mode**, the ChatGPT GitHub integration is the data plane and Playwright carries control messages in both directions. Review identity uses immutable base and review commit SHAs, not only branch names.

M0/M1 implements the shared protocol/state machine and deterministic browser transport. M2 adds the GitHub code provider; orchestration remains a future milestone.

## Components

- `core`: shared task/test domain, mode-aware protocol and checkpoints, state transitions, and errors. Core never imports the GitHub implementation layer.
- `browser`: connection abstraction, managed Chromium lifecycle, centralized ChatGPT adapter, response waiter.
- `cli`: small commands that return only status or the requested final payload.
- `providers`: mode-aware `CodeProvider` contracts expressed as LOCAL/GITHUB discriminated unions.
- `github`: `GitHubCodeProvider`, GitHub remote parsing, immutable review-envelope construction, and deterministic `GitRunner` integration.

## Code provider and capability layers

`CodeProvider` prepares a mode-specific code context and review target. `GitHubCodeProvider` implements this contract for M2; a minimal LOCAL type reserves the discriminator without implementing Local MCP or guessing its future workspace fields.

The provider layers are:

```text
core shared domain
        ↑
CodeProvider contract
        ↑
GitHubCodeProvider
        ↓
GitRunner / git CLI
```

`GitRunner` and the system Git CLI remain authoritative for correctness-critical local repository state and Git transport: status, HEAD, branches, ancestry, push, and remote-SHA verification.

GitHub Platform capabilities are a separate future boundary for PRs, checks, workflows, comments, and platform metadata. Possible future backends include a structured Codex GitHub plugin, `gh`, or GitHub REST. None is selected or implemented in M2. A natural-language LLM interaction whose output must be parsed is not a deterministic infrastructure primitive and cannot replace Local Git.

## Token efficiency

Browser-internal data is not model context. Waiting, selector fallback, streaming detection, and text extraction run in TypeScript. The bridge returns only the current complete control payload. Source and large diffs belong on the relevant data plane; full test logs do not belong on the browser control plane.

## Recovery

M1 atomically records the assistant-message count before send. This makes a later `wait` target the corresponding new response after CLI restart. Full task checkpoints and exactly-once execution belong to M3; browser timeout must never imply that Codex should repeat code modifications.

## M1.2 transport-independent automation

`BrowserAutomationSession` is consumed by send/wait. `LibraryChatGPTSession` and `PlaywrightCliChatGPTSession` implement it; `BrowserContext` remains internal to the Library transport. Shared `chatgpt-rules` is the single source of selector, streaming, target-message, composer, and origin semantics.

Auto selection is Extension Chrome, Extension Edge, channel-CDP Chrome, channel-CDP Edge, explicit raw CDP, installed Chrome, installed Edge, then already-installed bundled Chromium. No browser download occurs automatically.
