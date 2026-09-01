# Architecture

## Responsibility boundary

ChatGPT Web plans and reviews; Codex executes. ChatGPT must never edit local files, run shell commands, commit, push, or cause other workspace side effects. The public C2C protocol and state machine do not depend on a particular local bridge implementation.

## Planes and modes

The **Control Plane** carries small machine-readable lifecycle messages. The **Data Plane** gives ChatGPT read-only access to the code context without copying large source trees or diffs through Codex context.

In **LOCAL mode**, Codex sends control messages through Playwright. A future remote MCP endpoint backed by a local read-only bridge provides the data plane and returns `submit_response` events to Codex. Codex does not poll the page for replies. In **GITHUB mode**, the ChatGPT GitHub integration is the data plane and Playwright carries control messages in both directions. Review identity uses immutable base and review commit SHAs, not only branch names.

M0/M1 implements only the shared protocol/state machine and the deterministic browser transport. Mode providers and orchestration remain future milestones.

## Components

- `core`: protocol, state transitions, errors, and atomic bridge checkpoint.
- `browser`: connection abstraction, managed Chromium lifecycle, centralized ChatGPT adapter, response waiter.
- `cli`: small commands that return only status or the requested final payload.
- Future `providers`: LOCAL read-only MCP and GITHUB reference/data-plane implementations.

## Token efficiency

Browser-internal data is not model context. Waiting, selector fallback, streaming detection, and text extraction run in TypeScript. The bridge returns only the current complete control payload. Source and large diffs belong on the relevant data plane; full test logs do not belong on the browser control plane.

## Recovery

M1 atomically records the assistant-message count before send. This makes a later `wait` target the corresponding new response after CLI restart. Full task checkpoints and exactly-once execution belong to M3; browser timeout must never imply that Codex should repeat code modifications.
