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
