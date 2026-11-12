# Verification and compatibility

## Version 1.3.0

This release changes the UI, documentation, warning text and metadata symlink guard. Automated transfer tests use temporary fixtures; they do not sign in, switch a real account, or send model prompts.

| Area | Verification |
| --- | --- |
| CLI profile isolation | Shared transcripts/subagents retained, separate profile configuration, redacted metadata |
| Transcript reader | Messages/tool names, malformed input, pagination and UUID deduplication |
| Resume command | Shell quoting, account selection, exact session ID, authentication mismatch guard |
| CLI backup | SHA-256, permissions, symlink inventory, recursive destination rejection |
| Desktop rotation | Both directions, exact original bytes, canceled quit, rename failure, crash journal recovery |
| Session preparation | Matching transcript IDs, missing/conflicting transcript rejection, existing entries preserved, missing project warnings |
| Transfer safety | Source auth/grants omitted, permission reset, symlink rejection, cleanup after failed preparation |
| Electron UI | Real IPC with fake desktop bridge, creation/switching, transfer both directions, search, preview, backup, navigation, escaping and renderer isolation |
| Three.js | Canvas rendered, pause persists across rerender, Reduce Motion hides animation control, context loss leaves a static fallback |
| Layout | Screenshots at 1400×920 and 820×720; no horizontal document overflow |
| Packaged app | Source parity and local assets checked; read-only live metadata check does not quit or switch official Claude |

Commands:

```sh
npm test
npm run test:ui
```

`test:ui` needs a graphical macOS session. Generated screenshots are in `.local/qa`; screenshots committed to `docs/images` use fixture accounts only.

## Previous real-account check

During 1.2.0 development, on Claude desktop 5.1231.2, 38 local session metadata entries were prepared for a second saved account. An existing conversation opened and returned a minimal test reply in the same session under the destination account. Three project directories were missing and reported as warnings. Original profile data was retained.

That is one observed configuration, not proof of universal compatibility. The 1.3.0 review does not repeat a paid prompt or switch the user's real account automatically. It does not validate every model, connector, attachment or organization.

## Manual checks

- `node tests/desktop-live-read.mjs`: opens and closes Claude Switch, reads live desktop metadata, checks that official Claude process IDs do not change, and writes a local report/screenshot. Assumes an existing profile with history. Does not switch Claude.
- `node tests/live-smoke.mjs`: reads real CLI sessions; may create a backup if none exists. Read the script before using it.
- Real transfer: use two authorized prepared accounts, finish running tasks, make separate backups, switch, verify the destination identity and send a harmless no-tools prompt. Verify a reverse switch separately when needed.

Not validated: first-time onboarding when existing history blocks an empty profile, Intel builds, Windows/Linux, cross-machine restore, large-scale transcript sets, all future Claude releases, and Apple notarization.
