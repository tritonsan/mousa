# Build from the repository root: docker build -f deploy/Dockerfile -t qloo-design-demo .
FROM node:22-bookworm-slim

ARG KIRO_RELEASE_CHANNEL=stable
# Optional drift guard, not an installer version selector. See docs/aws-deployment.md.
ARG KIRO_EXPECTED_VERSION=""
# The major version the live try was tested with. The installer takes a channel, not a version, so an image built
# after CLI 3.0 reaches the stable channel would get its new engine untested; the build stops instead. Empty allows any.
ARG KIRO_EXPECTED_MAJOR="2"

USER root
# Chromium captures each design for the designing model's self-review. Its sandbox needs user namespaces, which
# Docker's default seccomp profile blocks; the Compose file runs the container under deploy/seccomp-chromium.json,
# which allows them. Without it the Studio's one test capture at start fails and the review is left out. See
# docs/aws-deployment.md before enabling MOUSA_CAPTURE_NO_SANDBOX instead.
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
    && actual_version="$(cat /opt/kiro/version.txt)" \
    && if [ -n "$KIRO_EXPECTED_VERSION" ]; then \
         test "${actual_version##* }" = "$KIRO_EXPECTED_VERSION"; \
       fi \
    && version_number="${actual_version##* }" \
    && if [ -n "$KIRO_EXPECTED_MAJOR" ] && [ "${version_number%%.*}" != "$KIRO_EXPECTED_MAJOR" ]; then \
         echo "kiro-cli $version_number is not major version $KIRO_EXPECTED_MAJOR, the one the live try was tested with. Build with KIRO_EXPECTED_MAJOR= to accept it." >&2; \
         exit 1; \
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
# The live try's two starters that are copied from a folder (Wax & Wane starts from an empty one); their .kiro stays out.
COPY --chown=root:root examples/mobile-app/ ./examples/mobile-app/
COPY --chown=root:root examples/long-dusk/ ./examples/long-dusk/
COPY --chown=root:root deploy/entrypoint.sh /usr/local/bin/qloo-demo-entrypoint
RUN chmod 0555 /usr/local/bin/qloo-demo-entrypoint

# The commit the image is built from (git rev-parse --short HEAD), which each live try records: the image has no git.
# It is declared here, after the system packages and Kiro: every RUN after an ARG depends on its value, so declared at
# the top a new commit rebuilt those layers and fetched Kiro's stable channel again on each redeploy (23 October 2026).
ARG MOUSA_COMMIT=""
# A hosted server has no Codex: no image generator is offered, and plans make imagery without one.
# Kiro's launcher finds kiro-cli-chat on PATH; without /opt/kiro/bin there, every session stopped at once with
# "failed to launch kiro-cli-chat" (22 October 2026). Each try session also puts Kiro's folder on its own PATH.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PREVIEW_PORT=8788 \
    DATA_DIR=/data/jobs \
    HOME=/data/kiro-home \
    KIRO_CLI_PATH=/opt/kiro/bin/kiro-cli \
    PATH=/opt/kiro/bin:$PATH \
    KIRO_RUN_TIMEOUT_MS=900000 \
    KIRO_EFFORT=medium \
    QLOO_API_BASE_URL=https://hackathon.api.qloo.com \
    MOUSA_ENVIRONMENT=hosted \
    MOUSA_BROWSER=/usr/bin/chromium \
    MOUSA_COMMIT=$MOUSA_COMMIT

USER node
EXPOSE 8787 8788
VOLUME ["/data"]
# The public health route answers once the Studio listens; /api/health/deep, behind the access token, says more.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/qloo-demo-entrypoint"]
CMD ["node", "src/server.mjs"]
