# ADR-005: No private ChatGPT API

Status: Accepted

## Decision

Automation uses the supported user-visible website through Playwright. It does not call or reverse-engineer private endpoints or extract authentication state.

## Consequences

Users log in manually and UI changes may require adapter maintenance. Authentication material stays inside the isolated browser profile.
