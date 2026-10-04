# @marioparaschiv/oxc-config

## Claude Code hook

`oxc-config-hook` formats each file Claude edits with oxfmt. When Claude finishes, it formats every file git reports as changed since the session started, runs `oxlint --type-aware --fix` on them and sends the remaining errors back to Claude. Files matched by the `ignorePatterns` in your `.oxlintrc.json` are skipped.

Add both hooks to `.claude/settings.json`:

```json
{
	"hooks": {
		"PostToolUse": [
			{
				"matcher": "Edit|Write|MultiEdit",
				"hooks": [{ "type": "command", "command": "npx oxc-config-hook" }]
			}
		],
		"Stop": [
			{
				"hooks": [{ "type": "command", "command": "npx oxc-config-hook" }]
			}
		]
	}
}
```

To lint session changes against a stricter config than the rest of the repository, pass it to the Stop hook with `npx oxc-config-hook --ratchet .oxlint/ratchet.json`. The path is relative to the repository root.
