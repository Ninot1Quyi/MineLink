# MineLink Security Notes

MineLink treats the Minecraft server runtime as the final authority. Host-side validation and SDK helpers are usability layers, not security boundaries.

Security invariants:

- Do not store GitHub tokens, admission tokens, Microsoft credentials, or server secrets in this repository.
- Do not accept Minecraft EULA automatically from automation.
- `online-mode=true` servers return `unsupported_online_auth` in MVP.
- Runtime actions must validate refs, reachability, visibility, cooldown, capability, queue pressure, and owner/admission state.
- Agent-local skill code never executes in the Minecraft JVM.
- Public endpoints require admission policy, rate limits, and audit before production exposure.
