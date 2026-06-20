# MineLink NeoForge Mod

Target:

- Minecraft `1.21.1`
- NeoForge `21.1.233`
- Java 21
- ModDevGradle `2.0.141`

This directory is a real NeoForge project with a MineLink loopback protocol
endpoint used by local and GitHub smoke tests. The fast TypeScript mock runtime
still runs first in CI, but product acceptance also exercises the real NeoForge
dedicated server for `mine_tree`, `create_smoke`, `craft_smoke`,
`craft_negative`, `guard_boundaries`, and `portal_coop`.

To build on a Java 21 machine:

```bash
cd mod/neoforge
./gradlew build
```

To run the dev server directly:

```bash
mkdir -p run
printf 'eula=true\n' > run/eula.txt
./gradlew runServer
```

The repository dev harness automates local validation setup, including
`eula=true`, `online-mode=false`, and per-scenario server ports:

```bash
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 bash scripts/dev/e2e.sh craft_negative
```

Create adapter development is opt-in so the core Mod build does not require
Create:

```bash
MINELINK_RUNTIME=neoforge MINELINK_ACCEPT_EULA=1 MINELINK_ENABLE_CREATE=1 bash scripts/dev/e2e.sh create_smoke
./gradlew --no-daemon -PenableCreateAdapter=true build
```

The adapter profile uses the official Create 1.21.1 coordinates in
`gradle.properties`.
