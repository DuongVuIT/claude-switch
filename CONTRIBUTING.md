# Contributing

Use macOS with Node.js and Xcode Command Line Tools. Follow the README build steps, then run `npm test` and `npm run test:ui` before submitting changes.

- Keep account authentication, transcript storage and UI concerns separate.
- Never add token extraction, permission bypasses or automatic force-kill behavior.
- Use temporary fixtures for profile switching tests. Do not run CI against personal Claude data.
- Include a regression test for changes to backups, transfer, permissions or recovery.
- UI changes must remain usable without WebGL, with Reduce Motion, by keyboard, and at the minimum 820px window width. Dispose Three.js GPU resources when leaving the view.
- Screenshots committed under `docs/images` must contain synthetic data only.
- Explain the problem, user-visible change and validation in the PR. Keep unrelated changes separate.

Contributions are provided under the project's MIT license. Please report security issues as described in SECURITY.md.
