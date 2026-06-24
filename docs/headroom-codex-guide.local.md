# Headroom + Codex macOS app

User-facing guide for using [Headroom](https://github.com/chopratejas/headroom) with Codex when primary workflow uses macOS app, not CLI.

## Executive summary

For Codex macOS app, Headroom currently fits in **MCP mode**, not guaranteed full transport-proxy mode.

- Good fit now: global Headroom MCP server in `~/.codex/config.toml`
- Not confirmed from current app config surface: custom upstream model base URL for all app traffic
- Result: manual/on-demand compression tools inside every future Codex app session

If OpenAI later exposes custom provider endpoint / proxy URL in app config, then `headroom proxy` becomes viable for true all-traffic routing.

## What changed from CLI recommendation

CLI-first recommendation:

- `headroom wrap codex`

App-first reality:

- app launch does not go through shell alias/function/wrapper
- `headroom wrap codex` therefore irrelevant for normal Dock/Finder/open-app workflow
- best supported integration is MCP registration

## Current local conclusion

I inspected local Codex app config surface.

Visible config supports:

- MCP servers
- plugins
- desktop prefs

Visible config does **not** expose:

- custom OpenAI-compatible base URL
- custom upstream proxy URL for model traffic
- documented app-level Headroom transport hook

So today:

- **automatic all-request Headroom proxying from macOS app: not currently justified**
- **Headroom MCP in all future app sessions: yes**

## What I configured

Added global Headroom MCP server to:

- `~/.codex/config.toml`

Inserted block:

```toml
[mcp_servers.headroom]
command = "headroom"
args = ["mcp", "serve"]
enabled = true
startup_timeout_sec = 20.0
```

Effect:

- future Codex app sessions should load Headroom MCP tools if `headroom` binary is installed and on PATH visible to app runtime

## Install Headroom globally

### 1. Verify Python

```bash
python3 --version
```

Need `3.10+`.

### 2. Install Headroom

Best default:

```bash
pipx install --python python3.13 "headroom-ai[all]"
```

Fallback:

```bash
python3 -m pip install --user "headroom-ai[all]"
```

### 3. Verify binary

```bash
headroom --help
headroom mcp serve --help
which headroom
```

Important:

- Codex app must be able to resolve `headroom`
- if installed after app already running, restart Codex app

## Verify MCP inside Codex app

Start a **new** Codex session after install/config change.

Ask Codex something explicit, e.g.:

```text
List available MCP tools. Check whether headroom_compress, headroom_retrieve, headroom_stats are available.
```

If available, integration working.

If not:

1. confirm `headroom` resolves in terminal
2. restart Codex app
3. re-open new session
4. inspect `~/.codex/config.toml` for syntax errors

## What Headroom MCP gives you

Three core tools:

- `headroom_compress`
- `headroom_retrieve`
- `headroom_stats`

Meaning:

- compress large content manually/on-demand
- recover original later by hash
- inspect savings stats

What MCP mode does **not** give:

- automatic compression of every user prompt/model request
- automatic interception of app transport

## Exact in-session usage

This section matters most.

Headroom MCP works best when you deliberately hand large content to Codex and tell it to compress before reasoning over it.

### Pattern 1. Large logs

Use when:

- failing CI logs
- stack traces
- verbose build output
- crawler output

Prompt:

```text
Before analyzing, use headroom_compress on this log. Then reason from compressed form. If needed later, retrieve original by hash.
```

Then paste/attach log.

Good follow-up:

```text
Use headroom_retrieve only if compressed result drops details needed for root cause.
```

### Pattern 2. Large diffs

Use when:

- wide git diff
- generated snapshots
- large config churn

Prompt:

```text
Use headroom_compress on this diff first. Focus review on behavioral risk, regressions, missing validation, and conflicts.
```

### Pattern 3. Search result floods

Use when:

- huge `rg` output
- repo-wide symbol matches
- many API payload samples

Prompt:

```text
Compress these search results with headroom_compress, then identify only clusters relevant to <topic>.
```

### Pattern 4. Multi-doc comparisons

Use when:

- several docs / specs / JSON blobs
- upstream docs + local config + logs

Prompt:

```text
Compress each artifact if useful, compare them, preserve hashes, and retrieve originals only for mismatches that matter.
```

### Pattern 5. Long-running investigation

At some point ask:

```text
Show headroom_stats and tell me whether compression is materially helping this session.
```

Useful when deciding whether MCP flow worth continued use.

## Effective prompting patterns

Best prompts are explicit.

### Good

```text
Use headroom_compress on pasted log before analysis.
```

```text
Compress this diff first. Retrieve original only if exact lines become necessary.
```

```text
Check headroom_stats after this investigation.
```

### Weak

```text
Use Headroom if needed.
```

Too ambiguous. Agent may skip it.

## Exact workflow examples

### Example: build failure

1. Paste log
2. Prompt:

```text
Use headroom_compress on this build log. Summarize root cause candidates. Retrieve original only if compressed output hides exact file/line/error text.
```

3. If diagnosis fuzzy:

```text
Use headroom_retrieve for hash <hash> and inspect exact failing section only.
```

### Example: PR review

1. Paste diff / ask for review
2. Prompt:

```text
Use headroom_compress on diff if large. Review for bugs, regressions, boundary violations, and missing tests. Retrieve original only for suspicious hunks.
```

### Example: noisy repo search

1. Paste `rg` output or ask agent after tool output appears
2. Prompt:

```text
Compress search output, cluster by subsystem, then focus only on pricing query construction path.
```

## Best practices

- use Headroom on **large intermediate artifacts**, not tiny prompts
- ask explicitly for compression before reasoning
- retrieve original only when exact evidence matters
- ask for stats occasionally to validate usefulness
- keep prompts deterministic: tell agent when to compress, when to retrieve

## RTK interaction

RTK and Headroom mostly complement each other.

- RTK: compresses/summarizes shell output
- Headroom MCP: compresses content inside agent workflow

Good stack:

1. use `rtk` to avoid flooding session with raw terminal output
2. use Headroom MCP when pasted/tool-returned content still large

## RTK caveats

Main risk: double abstraction.

- RTK may summarize command output
- Headroom may compress that summarized output again

Possible consequence:

- exact error wording lost
- whitespace-sensitive content obscured
- byte-for-byte evidence harder to inspect

### Safe RTK practice

For evidence-critical output:

```bash
rtk proxy <command>
```

Examples:

```bash
rtk proxy git diff --word-diff
rtk proxy cat /path/to/file
rtk proxy jq . huge.json
```

Then, inside Codex session, ask for Headroom compression only if output still too large.

## Warnings / caveats

- MCP mode != full transport proxy mode
- future app sessions only; existing sessions may not load new MCP config
- app restart may be required after installing `headroom`
- if PATH differs between terminal and GUI app, Codex app may fail to launch `headroom`
- Headroom stores retrievable content locally for TTL window
- retrieval entries expire
- overuse on already-small content adds little value
- exact forensic debugging may require raw, uncompressed source

## Troubleshooting

### Headroom tools do not appear

Check:

```bash
which headroom
headroom mcp serve --help
```

Then:

1. restart Codex app
2. start new session
3. ask Codex to list MCP tools

### Headroom tools appear but retrieval fails

Likely:

- TTL expired
- wrong hash
- original never stored due failed tool run

### Compression hurts diagnosis quality

Use retrieval immediately:

```text
Retrieve original for this hash and inspect exact section around <issue>.
```

## If true all-traffic routing becomes available later

Desired future shape:

1. run persistent proxy

```bash
headroom proxy --port 8787
```

2. point Codex app model traffic to:

```text
http://127.0.0.1:8787/v1
```

Current local app config surface does not show this as supported.

## Source links

- GitHub repo: https://github.com/chopratejas/headroom
- Install docs: https://headroom-docs.vercel.app/docs/installation
- MCP docs: https://headroom-docs.vercel.app/docs/mcp
- Proxy docs: https://headroom-docs.vercel.app/docs/proxy
