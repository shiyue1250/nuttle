# nuttle-mcp

MCP server for [Nuttle](https://nuttle.dev/en/): lets Claude Desktop and any MCP client that launches local commands query the posts, full comment trees and videos you've browsed (Reddit, X and more), saved on your own computer by the Nuttle desktop app.

It's a small stdio bridge to the app's local server (`http://127.0.0.1:8787/mcp`). Nothing leaves your machine.

## Setup

1. Install [Nuttle for Windows](https://nuttle.dev/download/windows?src=npm) (free) and keep it open.
2. Add this to your client's MCP config — for Claude Desktop, `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nuttle": {
      "command": "npx",
      "args": ["-y", "nuttle-mcp"]
    }
  }
}
```

If Nuttle isn't running, the server still starts and tells the agent to ask you to open it. Once the app is up, the tools appear on their own.

Clients that speak streamable HTTP (Claude Code, Cursor, Codex) can connect to `http://127.0.0.1:8787/mcp` directly — see the [guide](https://nuttle.dev/en/claude-code-mcp/).

## What the agent can do

32 tools: read a post with its whole comment tree in one call, wait for new data while you scroll, read raw captures from any site and map fields without code, download the media you watched, and run comment-insight jobs whose quotes are checked word for word against the captured comments.

## Options

- `NUTTLE_MCP_URL` — upstream address, default `http://127.0.0.1:8787/mcp`.
