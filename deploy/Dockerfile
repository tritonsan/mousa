# Build from the repository root: docker build -f deploy/Dockerfile -t qloo-design-demo .
FROM node:22-bookworm-slim

ARG KIRO_RELEASE_CHANNEL=stable
# Optional drift guard, not an installer version selector. See docs/aws-deployment.md.
ARG KIRO_EXPECTED_VERSION=""

USER root
# Chromium captures each design for the designing model's self-review. Its sandbox needs user namespaces, which the
# default container profile blocks; the Studio then checks one test capture at start and leaves the review out. See
# docs/aws-deployment.md before enabling MOUSA_CAPTURE_NO_SANDBOX.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash ca-certificates curl unzip \
       libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
       libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
       libnss3 libnspr4 libxtst6 libx11-6 libglib2.0-0 \
       chromium fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/kiro/bin /data/jobs /data/kiro-home /app \
    && chown -R node:node /data

# The official installer verifies the package against its published SHA-256 manifest.
# Only installation and --version run during the build; there is no login/inference.
RUN curl --fail --silent --show-error --location https://cli.kiro.dev/install -o /tmp/kiro-install.sh \
    && KIRO_CLI_SKIP_SETUP=1 bash /tmp/kiro-install.sh --channel "$KIRO_RELEASE_CHANNEL" \
    && cp /root/.local/bin/kiro-cli* /opt/kiro/bin/ \
    && chmod -R a+rX /opt/kiro \
    && /opt/kiro/bin/kiro-cli --version > /opt/kiro/version.txt \
    && cat /opt/kiro/version.txt \
    && if [ -n "$KIRO_EXPECTED_VERSION" ]; then \
         actual_version="$(cat /opt/kiro/version.txt)"; \
         test "${actual_version##* }" = "$KIRO_EXPECTED_VERSION"; \
       fi \
    && rm -f /tmp/kiro-install.sh

WORKDIR /app
# An explicit allowlist keeps local credentials and generated jobs out of the image.
COPY --chown=root:root package.json ./
COPY --chown=root:root src/ ./src/
COPY --chown=root:root web/ ./web/
COPY --chown=root:root plugin/ ./plugin/
# The game's pages and harness (its recorded runs and tests stay out) and the font, photo and music libraries.
COPY --chown=root:root game/ ./game/
COPY --chown=root:root library/ ./library/
COPY --chown=root:root deploy/entrypoint.sh /usr/local/bin/qloo-demo-entrypoint
RUN chmod 0555 /usr/local/bin/qloo-demo-entrypoint

# A hosted server has no Codex: no image generator is offered, and plans make imagery without one.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PREVIEW_PORT=8788 \
    DATA_DIR=/data/jobs \
    HOME=/data/kiro-home \
    KIRO_CLI_PATH=/opt/kiro/bin/kiro-cli \
    KIRO_RUN_TIMEOUT_MS=900000 \
    KIRO_EFFORT=medium \
    QLOO_API_BASE_URL=https://hackathon.api.qloo.com \
    MOUSA_ENVIRONMENT=hosted \
    MOUSA_BROWSER=/usr/bin/chromium

USER node
EXPOSE 8787 8788
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/qloo-demo-entrypoint"]
CMD ["node", "src/server.mjs"]
