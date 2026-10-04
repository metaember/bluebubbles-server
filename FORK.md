# Contact freshness fork

Based on upstream v1.9.9 (`ba31cd1cf6c03e154c18ffa2cd6da47a934c3be1`).
`release/1.9.9` is the unchanged baseline; `fix/contact-freshness` is the candidate.
This is a narrow server patch, not a replacement messaging protocol or a public API service.

## Fix

- Patch the locked `node-mac-contacts@1.7.2` dependency before native compilation.
  All contact-store notifications invalidate, including notifications with empty
  `userInfo`. An atomic dirty flag avoids manipulating JavaScript references on
  the Cocoa notification thread.
- Expose native cache invalidation. Bound the server cache to 60 seconds using a
  monotonic clock, and keep the change listener subscribed across multiple events.
- `GET /api/v1/contact?refresh=true` and the existing UI contact refresh invalidate
  before reading. Existing response schemas and authentication stay unchanged.
- Rehydrate optional properties after every invalidation. Permission failures
  and native module load failures must not masquerade as empty successful snapshots.
- No contact creation/editing, note writeback, or message-history migrations.

## Side-by-side candidate

The ordinary production lifecycle starts services with side effects. The candidate
therefore has a **separate entrypoint** and reuses the actual contact/message read
controllers and repositories, without starting that lifecycle.

| Property | Candidate |
| --- | --- |
| Bundle | `BlueBubbles Candidate.app` |
| Bundle ID | `dev.metaember.bluebubbles.candidate` |
| State | `~/Library/Application Support/bluebubbles-candidate` |
| Logs | Inside the candidate state directory |
| Listener | `127.0.0.1:1235` only; header bearer authentication |
| Credential | New random 0600 `shadow-token`; never copied from production |
| Messages database | Native database opened read-only |
| Contacts | Native read permission; no write endpoints |
| Other services | No sockets, sends, FCM, webhooks, proxies, updater, private API, login item, or scheduler |

No production config/database is copied. The candidate does not read `~/bluebubbles.yml`.
Do not connect live ingestion or agent traffic to it until acceptance is complete.
An occupied candidate port is a startup failure, never a reason to kill its owner.

### Build on macOS

Use a project-local Node 20.11.x/npm 10 toolchain as expected by this upstream release;
do not downgrade system Node. Node 20 and Electron 25 are legacy build/runtime dependencies
inherited from upstream; this fork does not claim to modernize them. Keep the candidate
loopback-only. A dependency modernization review is separate from this contact fix.

```sh
npm ci --workspace=@bluebubbles/server --include-workspace-root --ignore-scripts --no-audit --no-fund
./script/build_and_run.sh --build-only
./script/build_and_run.sh --verify
node script/check_candidate.cjs
```

Set `BB_BUILD_NODE_BIN` to the project-local Node directory if it is not on PATH.
The script stops **only** the exact candidate executable before rebuilding, never the
production app. It runs tests, applies the native patch, rebuilds native modules for
Electron, type-checks/bundles, packages an x64 candidate, ad-hoc signs, and optionally
launches via Launch Services. The Run action is macOS-only.

The new app identity may need interactive Contacts and Full Disk Access approval.
We do not copy TCC entries, reset production permissions, disable SIP, or inherit
production's signing identity. A permission-blocked candidate stays explicit in
`/shadow/status`. Relaunch **only the candidate** after changing Full Disk Access.

### Acceptance gates

1. Automated cache regression and candidate boundary tests pass.
2. Packaged native module loads; both permission statuses are ready.
3. Candidate returns previously missing contacts, without restarting production.
4. `check_candidate.cjs` compares native message IDs/text/attachment IDs and recent
   chat reads without printing personal data. Optional name arguments check presence
   but report only counts. Exit 2 means permissions remain blocked.
5. With user approval, add/edit a test contact outside the candidate; verify both
   explicit refresh and the 60-second missed-notification fallback in one running
   process. Unit fixtures alone do **not** establish live iCloud change propagation.
6. Observe side by side before replacing production. The read-only candidate does
   **not** validate sending, push, webhooks, private APIs, or the full production UI.

Replacement/restart and cutover are separate actions. Keep the original app and data
untouched for rollback; do not let either build update the other automatically.
