---
'overlock': minor
---

Add an MCP server: `overlock mcp`.

Agents can now discover overlock as a tool instead of needing a human to wire a
bash command into a config first. Two tools — `overlock_check` and
`overlock_report` — over stdio.

`overlock_check` returns the compact report, and the full JSON only when there
is something to act on, so a clean run costs one line rather than a serialised
empty report. A tool that cannot run reports the failure inside the result
rather than as a protocol error, so the agent can read it and react.

The server is implemented directly rather than through
`@modelcontextprotocol/sdk`: this package has zero runtime dependencies on
purpose, and MCP over stdio is newline-delimited JSON-RPC 2.0 with five methods.
Protocol version strings are taken from the official SDK's own constants, and
negotiation echoes the client's version when it is one overlock knows.
