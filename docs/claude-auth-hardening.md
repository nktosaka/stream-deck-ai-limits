# Claude usage cards: authentication hardening and statusLine bridge

## Incident and causal certainty (2026-10-24, Windows)

Both Claude cards showed Unauthorized. The OAuth usage API replied HTTP 401 when
called with the token currently held in Claude Code's credentials file. After
Claude Code /login, the same API returned 200 and both cards recovered.

This establishes that the usage endpoint rejected the previous access token.
It does **not** prove whether the trigger was routine expiration, failed refresh,
or a race between the CLI and the plugin.

The SDK in this branch is @lenadweb/ai-limits@1.2.0. Its default Claude
autoRefresh writes refreshed OAuth tokens back into Claude Code's credential
store. This patch disables that behavior *only for Claude*.

## Data sources and limitations

1. **Preferred:** Claude Code's documented statusLine rate_limits.five_hour and
   rate_limits.seven_day fields. Each contains used_percentage (0-100) and
   resets_at (Unix seconds). The bridge stores only these fields and a local
   capture time in ~/.stream-deck-ai-limits/claude-statusline.json.
2. **Fallback:** read-only use of the existing /api/oauth/usage endpoint through
   the SDK (autoRefresh=false). This is an undocumented endpoint, so it can
   change; token expiration may still require Claude Code to renew the login.
3. If both sources fail, the tile shows an error. After login or renewed
   statusLine data, the normal 5-minute polling and key-press refresh recover.

statusLine is emitted by an active Claude Code session, normally after its
first API response; it does not continuously monitor Claude web activity or
devices running independently. It can omit individual windows, and no cached
window is trusted after its reset timestamp. The bridge also expires snapshots
after 5 minutes. Missing usage is never displayed as fresh 100% remaining.
The bridge does NOT call Anthropic APIs, refresh OAuth, or touch credentials.

Official reference: https://code.claude.com/docs/en/statusline

## Windows installation: opt-in only

**Do not change a working Stream Deck installation until CI, review and local
acceptance pass.** This code is for a Draft PR until then.

1. On the local Windows machine, back up:
   - %APPDATA%/Elgato/StreamDeck/Plugins/com.len.limits.sdPlugin
   - %USERPROFILE%/.claude/settings.json (if present)
2. Inspect the existing statusLine setting in settings.json. If already present,
   do NOT overwrite it; integrate quota capture into the existing statusLine
   script or preserve/chain its output after an explicit local review.
3. Copy scripts/claude-statusline-bridge.mjs from this repo to the local
   %USERPROFILE%/.stream-deck-ai-limits/ directory. This must be a stable path.
4. If no existing statusLine is configured, add the following statusLine value
   to the existing settings.json object (keep all other settings intact):

       "statusLine": {
         "type": "command",
         "command": "node C:/Users/YOUR_USERNAME/.stream-deck-ai-limits/claude-statusline-bridge.mjs"
       }

   Use forward slashes in Windows paths as Anthropic documents for Git Bash.
   Substitute the actual Windows username. The script prints a small Claude
   status line, which is a normal UI change; it only writes quota information.
5. Start Claude Code and run an ordinary request (the first statusLine event
   can arrive without limits). Confirm local cache has only version, capturedAt,
   windows.five_hour and windows.seven_day; **never paste Claude tokens or full
   statusLine input into logs/issues**.
6. From the repo on Windows: npm ci, npm test and npm run build. In Stream Deck,
   install the built plugin by copying the folder, not via streamdeck link:
   the existing repo README reports a junction-related start failure on Windows.
7. Validate Claude 5h and weekly **remaining** cards, JST reset times, Codex
   and other provider cards, auth failure/recovery, and missing/stale cache.

This setup is optional. Without it, Claude uses the read-only API fallback, which
does *not* guarantee indefinite operation without manual reauthentication.

## Rollback

Stop Stream Deck; restore the backed-up plugin folder; restore the original
settings.json statusLine configuration. Relaunch Stream Deck and verify the
cards. The quota-only cache can be deleted; do not delete or edit
~/.claude/.credentials.json. Existing profile and tile settings are unchanged.

## Acceptance gates

- Regression tests and build on the exact SHA, including Windows CI.
- No OAuth refresh or credential-file writes initiated by Stream Deck.
- No accessToken, refreshToken, Authorization header, session/transcript
  content in local quota cache, log output, commits or CI artifacts.
- 401 -> explanatory re-login display; regenerated credentials or fresh
  statusLine data -> recover without requiring Stream Deck restart.
- 429/network errors and expired/missing statusLine cache never display
  stale numbers as fresh.
- Test 5h + weekly on the user's Windows machine, plus Codex regression.
- Current production plugin untouched until explicit acceptance.
