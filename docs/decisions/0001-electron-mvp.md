# ADR 0001: Electron MVP Surface

## Status

Accepted for Phase 0 and Phase 1 implementation.

## Decision

Build the MVP as a Windows Electron thin client with React and Fluent UI. Azure CLI authentication and enterprise connector calls remain in the trusted main process. The renderer receives only validated business contracts through a narrow preload API.

## Security Constraints

- Enable context isolation and sandboxing.
- Disable Node.js integration in the renderer.
- Never expose access tokens, raw `ipcRenderer`, or unrestricted channels.
- Validate IPC inputs and sender frames.
- Deny unexpected navigation and new-window requests.
- Keep the MVP read-only and support a visibly distinct sample mode.

## Consequences

Teams is a later channel using SSO and on-behalf-of authentication. Unverified MSX or SharePoint access blocks live mode but does not block fixture-backed Phase 1 development.