# MineLink NeoForge Mod

Target:

- Minecraft `1.21.1`
- NeoForge `21.1.233`
- Java 21
- ModDevGradle `2.0.141`

This directory is a real NeoForge project skeleton, but the local automated acceptance currently uses the TypeScript mock runtime because Minecraft server startup requires Java 21 and an explicit EULA step.

To build on a Java 21 machine, install a Gradle wrapper or run the project from a Gradle-capable IDE:

```bash
cd mod/neoforge
gradle wrapper
./gradlew build
```

To run the dev server:

```bash
mkdir -p run
# Read and accept Minecraft EULA yourself before setting this:
printf 'eula=true\n' > run/eula.txt
./gradlew runServer
```

Create adapter development should enable the commented dependencies in `build.gradle` using the official Create 1.21.1 coordinates in `gradle.properties`.
