---
title: Web dashboard
description: The supervisor hosts a built-in web dashboard for all your cities.
---

The Gas City supervisor hosts a built-in web dashboard. It is a single-page app
compiled into the `gc` binary and served by the supervisor on its own listener,
so there is nothing extra to install or run.

## Open it

The dashboard is live as soon as `gc init` (or `gc start`) has started a city.
`gc dashboard` opens it in your browser and prints the URL:

```bash
gc dashboard
# Opened the dashboard in your browser: http://127.0.0.1:8372
```

Pass `--no-open` to print the URL without launching a browser (useful over SSH
or in scripts):

```bash
gc dashboard --no-open
# The dashboard is served by the gc supervisor at http://127.0.0.1:8372
```

`gc dashboard` does not start a server — it points your browser at the running
supervisor. The supervisor is the host, and one supervisor serves every
registered city. Pick the city you want from the switcher in the dashboard
header. If the supervisor is not running, `gc dashboard` prints how to start it
instead of opening a (dead) URL.

## What it shows

The dashboard reads the supervisor's typed API directly (same origin), so it
reflects live state: agents and their sessions, beads, mail, formula runs, and a
health view (system, local tools, per-rig store health, and the dolt store
trend).

## Security posture

The dashboard is served on the supervisor's bind address, which defaults to
loopback (`127.0.0.1`). It is intended for local, single-operator use:

- It is same-origin with the API; browser mutations carry the supervisor's
  `X-GC-Request` CSRF header.
- When the supervisor binds a non-localhost address without
  `allow_mutations`, it runs read-only and the dashboard disables its mutating
  controls.

## Serve it from a folder

To ship an interface change without rebuilding `gc` or restarting the
supervisor, name a folder in `$GC_HOME/supervisor.toml`:

```toml
[supervisor]
dashboard_dir = "/Users/me/.gc/dashboard-ui"   # absolute path
```

The supervisor reads this key once, at start; `gc supervisor reload` does not
re-read it. The folder itself is read on every request, so switching versions
needs no restart:

```text
dashboard-ui/
├── current                      # "embedded" or a 40-hex version name
└── versions/
    └── <sha40>/                 # a built dashboard (the contents of dist/)
        ├── index.html
        ├── gc-ui-release.json   # written last: marks the version complete
        └── assets/…
```

Gas City never writes to this folder. It serves the version `current` names
only when the folder, `versions/` and that version are owned by the
supervisor's user and not group- or world-writable, and it never follows a
symlink inside them. On any other state it serves the built-in dashboard
instead; no value of `dashboard_dir` stops the supervisor from starting.

Every dashboard response says which interface answered, in the
`X-GC-Dashboard-UI` header: `dir <sha40>`, `embedded`, or
`embedded; fallback=<reason>`, where the reason is one of `root-missing`,
`root-perms`, `no-current`, `bad-current`, `version-missing`,
`version-perms`, `no-index` or `incomplete`:

```bash
curl -sI http://127.0.0.1:8372/ | grep -i x-gc-dashboard-ui
# X-GC-Dashboard-UI: dir 0123456789abcdef0123456789abcdef01234567
```

An unknown `/assets/…` path answers 404, not the app shell.

## Turn it off

Set `GC_SUPERVISOR_DASHBOARD=0` before starting the supervisor to run a
typed-API-only supervisor with no embedded dashboard.
