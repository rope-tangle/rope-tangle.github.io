# Agent instructions

## `docs/superpowers/` is historical

The specs, plans and notes in `docs/superpowers/` record the development they were written for. Once that development is done, treat them as historical documentation:

- Never update an existing file there, even when a later change makes it stale.
- If new development needs a spec and/or a plan, create a new file for it.
- If it doesn't need one, create nothing.

## Stored data is trusted

Everything in localStorage is written by this app on the player's own device, and nothing can be shared between players. A hand-crafted record can only affect the person who made it.

- Don't flag, and don't add, checks against hand-crafted or malicious records.
- Validate stored data only for what real data can contain: older or newer formats, corruption, or values the app itself could produce.
- A check that could reject a real board or saved game costs the player their game. It is worse than no check.

## Check for orphaned test workers after an interrupted run

After any interrupted or timed-out test run, check for orphaned vitest workers:

```
ps -Ao pid,ppid,%cpu,etime,command | awk '$2==1 && /vitest/'
```

Kill any whose command line points into this repo's `node_modules/vitest`.

A worker stuck in a synchronous loop survives `pkill -f 'vitest run …'`: that pattern matches only the parent, and the worker never notices it has gone. In a sibling repo one spun for three days and exhausted the machine's memory. To stop a hung run, stop the whole background task or process group, not a pattern match. The watchdog in `tests/helpers/vitest-setup.ts` kills such workers within a second or two, but check anyway: it can't help if it never started.
