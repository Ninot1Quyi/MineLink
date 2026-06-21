FROM eclipse-temurin:21-jdk AS jdk

FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm AS base

USER root

ENV DEBIAN_FRONTEND=noninteractive
ENV JAVA_HOME=/usr/local/openjdk-21
ENV PATH="${JAVA_HOME}/bin:${PATH}"
ENV GRADLE_USER_HOME=/home/node/.gradle

COPY --from=jdk /opt/java/openjdk /usr/local/openjdk-21

RUN ln -sf /usr/local/openjdk-21/bin/java /usr/local/bin/java \
  && ln -sf /usr/local/openjdk-21/bin/javac /usr/local/bin/javac \
  && ln -sf /usr/local/openjdk-21/bin/jar /usr/local/bin/jar

RUN mkdir -p -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    gh \
    git \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN node --version \
  && npm --version \
  && python3 --version \
  && java -version \
  && gh --version \
  && ffmpeg -version

USER node
WORKDIR /tmp/minelink-prewarm

FROM base AS prewarm

ARG MINELINK_PREWARM_GRADLE=1

COPY --chown=node:node package.json package-lock.json tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node mod/neoforge/build.gradle mod/neoforge/settings.gradle mod/neoforge/gradle.properties mod/neoforge/gradlew mod/neoforge/gradlew.bat ./mod/neoforge/
COPY --chown=node:node mod/neoforge/gradle ./mod/neoforge/gradle
COPY --chown=node:node mod/neoforge/src ./mod/neoforge/src

RUN npm ci \
  && npm run build \
  && npm run typecheck

RUN chmod +x mod/neoforge/gradlew \
  && if [ "${MINELINK_PREWARM_GRADLE}" = "1" ]; then \
    cd mod/neoforge && ./gradlew --no-daemon build; \
  else \
    echo "MINELINK_PREWARM_GRADLE=${MINELINK_PREWARM_GRADLE}; skipping Gradle cache prewarm"; \
  fi

FROM base AS runtime

ENV JAVA_HOME=/usr/local/openjdk-21
ENV PATH="${JAVA_HOME}/bin:${PATH}"

LABEL org.opencontainers.image.title="MineLink prewarmed devcontainer"
LABEL org.opencontainers.image.description="Node 22, Java 21, ffmpeg, GitHub CLI, npm cache, and Gradle user-home cache for Ona/Codex development."
LABEL org.opencontainers.image.source="https://github.com/Ninot1Quyi/MineLink"

COPY --from=prewarm --chown=node:node /home/node/.npm /home/node/.npm
COPY --from=prewarm --chown=node:node /home/node/.gradle /home/node/.gradle

RUN java -version \
  && test -d /home/node/.npm \
  && test -d /home/node/.gradle/caches/modules-2

USER node
WORKDIR /workspaces/MineLink
