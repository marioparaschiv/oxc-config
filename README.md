# @marioparaschiv/oxc-config

Shared oxlint and oxfmt configuration with custom lint rules, a commitlint config and a Claude Code hook.

## Install

```sh
npm i -D @marioparaschiv/oxc-config oxlint oxlint-tsgolint oxfmt
```

## Lint

Create `.oxlintrc.json`:

```json
{
	"extends": ["./node_modules/@marioparaschiv/oxc-config/base.json"]
}
```

For React or JSDoc projects, add the matching presets after `base.json`:

```json
{
	"extends": [
		"./node_modules/@marioparaschiv/oxc-config/base.json",
		"./node_modules/@marioparaschiv/oxc-config/react.json",
		"./node_modules/@marioparaschiv/oxc-config/jsdoc.json"
	]
}
```

Run oxlint with type information so the type-aware rules apply:

```sh
npx oxlint --type-aware
```

### Ignoring files

oxlint does not inherit `ignorePatterns` through `extends`, so set them in your own `.oxlintrc.json`:

```json
{
	"extends": ["./node_modules/@marioparaschiv/oxc-config/base.json"],
	"ignorePatterns": ["dist", "*.gen.ts"]
}
```

### Toggling rules

Override any rule in `rules`. The custom rules live under the `oxc-config/` prefix:

```json
{
	"extends": ["./node_modules/@marioparaschiv/oxc-config/base.json"],
	"rules": {
		"oxc-config/no-foreach": "off",
		"oxc-config/max-comment-length": "warn"
	}
}
```

Three rules describe your repository layout. They are off in every preset and must be given options when turned on. Directory patterns match anywhere in a file's path, and `*` stands for one path segment, so `apps/*/src` covers the source root of every app.

- `oxc-config/consistent-import-paths` requires `alias` imports instead of `../` inside an alias root, and relative imports inside a relative root.
    - `alias`: the import alias, ending in `/` (for example `@/`).
    - `aliasRoots`: directories the alias resolves from.
    - `relativeRoots` (optional): directories consumed from source by other packages, where the alias must not be used.
- `oxc-config/no-cross-domain-internals` requires other domains to be imported through their index.
    - `domainRoots`: directories whose children are domains.
    - `internals`: module names inside a domain that other domains may not import (for example `repository`).
    - `composable` (optional): internals that a module of the same name may import from another domain.
- `oxc-config/no-raw-database-access` limits `drizzle-orm` and schema imports to the given directories. Type-only imports and test files are allowed everywhere.
    - `schemas`: the module that exports your tables.
    - `allowedIn`: directories where those imports are allowed.

```json
{
	"extends": ["./node_modules/@marioparaschiv/oxc-config/base.json"],
	"rules": {
		"oxc-config/consistent-import-paths": [
			"error",
			{ "alias": "@/", "aliasRoots": ["apps/*/src"], "relativeRoots": ["packages/*/src"] }
		],
		"oxc-config/no-cross-domain-internals": [
			"error",
			{
				"domainRoots": ["apps/api/src/domains"],
				"internals": ["repository", "service"],
				"composable": ["service"]
			}
		],
		"oxc-config/no-raw-database-access": [
			"error",
			{ "schemas": "@acme/db/schema", "allowedIn": ["apps/api/src/repositories"] }
		]
	}
}
```

### Checking for unknown rules

oxlint ignores rule names it does not know, so a typo silently turns a rule off. `oxc-config-check` fails when a config names a rule that does not exist:

```sh
npx oxc-config-check
```

It checks `.oxlintrc.json` by default. Pass other config paths as arguments.

## Format

oxfmt configs cannot extend each other, so copy the reference config into your project:

```sh
cp node_modules/@marioparaschiv/oxc-config/oxfmtrc.json .oxfmtrc.json
```

It formats with tabs (width 4), single quotes, semicolons, trailing commas and a print width of 100. Add `ignorePatterns` to your copy as needed.

## Commit messages

Create `commitlint.config.mjs`:

```js
export { default } from '@marioparaschiv/oxc-config/commitlint';
```

It follows the Angular convention with these types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

## Git hooks

With [lefthook](https://lefthook.dev) installed as a dev dependency and `"prepare": "lefthook install"` in your scripts, this `lefthook.yml` checks formatting before each commit and lints each commit message:

```yaml
pre-commit:
    commands:
        format:
            glob: '*.{js,mjs,ts,tsx,json}'
            run: npx oxfmt --check

commit-msg:
    commands:
        commitlint:
            run: npx commitlint --edit "{1}"
```

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

## Releasing

Publishing runs from GitHub Actions with npm trusted publishing, so no npm token is stored. The package must have this repository and the `release.yml` workflow configured as a trusted publisher on npmjs.com.

```sh
npm version 0.1.0
git push --follow-tags
```

Pushing the `v*` tag runs the tests and publishes the package with provenance.
