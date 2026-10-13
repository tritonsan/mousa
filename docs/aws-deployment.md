# AWS deployment and operating notes

The delivered application runs locally. These deployment files prepare an AWS-hosted review demo; no AWS resource, public URL, subscription change, API key, or paid inference has been created by this document.

## First deployment: one EC2 container

Use one Linux x86-64 EC2 host and one Docker container for the initial controlled review demo. This matches the application's current single Node.js process, serialized job queue, and local job storage. Start behind an HTTPS reverse proxy with reviewer access restricted. The Compose port is deliberately published on the host's `127.0.0.1` only.

This is an engineering choice for the current application, not a claim that Lambda cannot run Kiro. [AWS documents Kiro CLI in a Lambda container with headless authentication](https://aws.amazon.com/blogs/devops/building-a-slack-powered-ai-development-agent-with-kiro-cli-and-headless-authentication/). Normal Lambda functions have a [15-minute invocation limit and invocation-local storage](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html); the current persistent server, queue, and job files would require a different deployment architecture. The image contains Debian's Chromium for the designers' review captures; see [Review captures in the container](#review-captures-in-the-container) before relying on them.

ECS on Fargate is a later option for running the same container. Before adding multiple workers, move job dispatch to SQS and job metadata/artifacts to shared storage such as DynamoDB/S3. The in-process queue is not distributed or durable. Two instances must not share a job directory and independently process the same jobs. Completed job metadata and previews reload after a restart; interrupted jobs are marked failed rather than resumed. Horizontal scaling, an SQS consumer, S3 export, and automatic resumption are not implemented by these files.

## Runtime boundary

- Node.js 22 starts `src/server.mjs`; the application has no npm runtime dependencies.
- The Linux image includes Kiro CLI and runs as UID/GID 1000 rather than root.
- Application source and the container root filesystem are read-only in Compose. `/data` is the persistent writable job volume; `/tmp` is a limited temporary filesystem.
- The container's default home is `/data/kiro-home`. The application is responsible for giving each Kiro job its own home/configuration and job-scoped MCP bridge. An undocumented Kiro environment variable is not used as a substitute for this boundary.
- Kiro receives static-site work through approved job-scoped tools. Generated sites use HTML/CSS/JavaScript; arbitrary generated npm installs, shell commands, and build scripts are outside this runtime contract.
- Generated previews are untrusted content. The application must keep its iframe sandbox, preview capability tokens, and generated-content CSP enabled. A preview capability is separate from the review account token. Do not turn generated pages into scripts on the control UI's origin.
- The image carries the game's pages and harness (`game/`, without its recorded runs and tests) and the font, photo and music libraries (`library/`), which the Studio serves and the character pairs use.
- The container is a hosted environment (`MOUSA_ENVIRONMENT=hosted`). It has no Codex, so no image generator is offered: both designers of a comparison read the same capability list, plan imagery with methods that need no generator (such as inline SVG, CSS art or a starter's library photos), and a study cannot require generated images. Work recorded locally with Codex pictures can still be shown; see [Recorded local work](#recorded-local-work-on-the-hosted-server).

Preview URLs use `/preview/{job}/{mode}/{48-hex-character-capability}/index.html`. The capability is in the path so relative CSS/JavaScript requests retain the same grant. Treat the whole URL as private review access; do not publish it in logs or analytics. The reverse proxy must preserve this path when forwarding preview requests. Disable or redact preview request-path logging rather than assuming that removing query strings removes the capability.

Container hardening helps contain accidents; it is not isolation between jobs inside the same worker. The [Kiro MCP security documentation](https://kiro.dev/docs/mcp/security/) states that stdio MCP servers run with the agent's privileges and are not sandboxed by Kiro. Do not add general shell/AWS/browser MCP tools to the review worker or mount a personal home directory, Docker socket, host filesystem, browser profile, or AWS credentials into it.

## Kiro installation and reproducibility

`deploy/Dockerfile` downloads the [official Linux installer](https://cli.kiro.dev/install) during image build. The installer verifies its downloaded package against the official SHA-256 manifest. Only installation and `kiro-cli --version` run at build time; the image build does not log in or invoke a model.

The installer currently accepts `--channel`, not a version flag. `KIRO_RELEASE_CHANNEL=stable` therefore selects the stable release available at build time. `KIRO_EXPECTED_VERSION` is an optional build-time drift guard: it fails the build if the reported version does not match the requested string. It does not fetch a historical version. The observed version is saved at `/opt/kiro/version.txt` and printed in the build log. On 2026-10-01 the public stable manifest reported 2.26.1; the inspected local Windows installation was 2.24.0. Neither fact establishes that this Linux image has been built successfully.

For a repeatable AWS demo, build once, inspect the version record, and deploy that image by its ECR digest. Do not rebuild against a moving release channel immediately before judging. A fully pinned installer/package and base-image digest can be added after the first Linux build is verified. Kiro's [Linux requirements](https://kiro.dev/docs/getting-started/installation/) and download packaging may change; review installer changes before an upgrade.

## Configuration and secrets

| Variable | Purpose / default |
| --- | --- |
| `PORT` | Node HTTP port; local default `8787` |
| `PREVIEW_PORT` | Separate preview HTTP origin; default `8788` |
| `PUBLIC_PREVIEW_BASE_URL` | Explicit browser-reachable preview origin for a non-loopback bind; Compose localhost example `http://127.0.0.1:8788` |
| `HOST` | Local default `127.0.0.1`; container binds `0.0.0.0` |
| `DEMO_ACCESS_TOKEN` | At least 24 characters for a non-loopback server bind; private reviewer access |
| `KIRO_CLI_PATH` | Container: `/opt/kiro/bin/kiro-cli` |
| `KIRO_API_KEY` | Account-backed headless authentication; kept outside the image |
| `KIRO_MODEL` | Optional configured Kiro model identifier |
| `KIRO_EFFORT` | `medium`; applied equally to Qloo-on and Qloo-off runs |
| `QLOO_API_KEY` | Qloo API authentication; required for live Qloo-enabled work |
| `QLOO_API_BASE_URL` | `https://hackathon.api.qloo.com` |
| `DATA_DIR` | Container: `/data/jobs`; contains generated job artifacts |
| `KIRO_RUN_TIMEOUT_MS` | `900000` (15 minutes per mode) with the production stages, `600000` without; maximum accepted value `1800000` (30 minutes) |
| `MAX_JOBS` | Stored jobs, finished ones included; default `30`, maximum `200`. Recorded jobs copied into the volume count toward it |
| `MOUSA_ENVIRONMENT` | Container: `hosted`, so no image generator is offered whatever is installed |
| `PRODUCTION_STAGES` | `on`: each designer reads its taste input, plans every DNA device's method from the shared capability list and reviews captures of its saved site; `off` keeps the taste-led protocol alone |
| `MOUSA_CAPTURE` | `auto` uses the image's Chromium once it has captured a test page at start; `off` leaves the review out |
| `MOUSA_BROWSER` | Container: `/usr/bin/chromium` |
| `MOUSA_CAPTURE_NO_SANDBOX` | Empty by default. `1` runs Chromium without its own sandbox; read [Review captures in the container](#review-captures-in-the-container) first |
| `DEMO_PORT` | Compose host port, default `8787`; host mapping stays loopback |
| `DEMO_PREVIEW_PORT` | Compose preview host port, default `8788`; host mapping stays loopback |

Configure retention/queue limits using the server's documented settings. Retention is not a backup policy. Deleting the Compose volume deletes local jobs; do not use `docker compose down -v` to restart the demo.

Each generation mode has its own timeout, which does not count host waits such as captures. Two serialized comparison modes can therefore take up to 30 minutes with the default budget, plus queue waiting and validation. Both modes receive the same configured model and effort. An initial five-minute local baseline timed out before saving every file. A subsequent local-food baseline completed in approximately 3 minutes 57 seconds with a ten-minute budget and `medium` effort. This single Windows run does not establish AWS latency, Qloo-on latency, or a guaranteed generation time. See [local verification](verification.md).

`deploy/demo.env.example` contains empty credential placeholders. Copy it to a private location outside the repository and fill it on the operator's machine. Restrict its permissions to the operator. Never put filled credentials in the image, source control, screenshots, build arguments, prompts, exported ZIPs, or shared command output. Compose can read this file with `--env-file`; do not publish the output of `docker compose config`, because it resolves secret environment values.

The entrypoint also supports optional mounted files through `DEMO_ACCESS_TOKEN_FILE`, `KIRO_API_KEY_FILE`, and `QLOO_API_KEY_FILE`. The base Compose file uses runtime environment injection. File mounts require a separate operator-supplied Compose override. [ECS supports runtime secret injection through Secrets Manager or Systems Manager Parameter Store](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html); use its `secrets` container definition field if moving to ECS. Restrict secret access to the relevant execution role and restart tasks after rotation. Secrets supplied in environment variables remain visible to principals allowed to inspect the container.

Do not give the generation worker an EC2 instance role or task role with provisioning permissions. A role used for image pulls/logging/secret injection should be separate from permissions available to generated tools. The current application does not need AWS CLI credentials to generate a static site.

## Review captures in the container

With the production stages, each designer reviews captures of its saved site (desktop 1440×900 and mobile 390×844) or character before it finishes. The host renders them in headless Chromium, which can reach only a loopback server holding that one design: host names resolve nowhere, other connections go to a closed local proxy, and the browser process gets the server's environment without the variables whose names contain KEY, TOKEN, SECRET or PASSWORD. Kiro opens the PNGs with its own read tool, pointed at the run's review folder: the run's other files are denied to it by name, and a read outside the run's folder fails in the non-interactive run (observed with kiro-cli 2.24.0 and 2.27.1 on Windows).

Chromium isolates each page in its own sandbox, which needs unprivileged user namespaces. Docker's default seccomp profile blocks them, so in this Compose setup the browser is expected to stop as it starts. The Studio finds this out before any run: at start it captures one test page, and when that fails it leaves the review out of every capability list and says why in its log and in `/api/status` (here: its sandbox needs user namespaces, which this system blocks). Designs are then planned and checked as before, without a visual review. The Compose file already gives Chromium a 256 MB `/dev/shm` and a process limit that fits its threads.

Three ways to run the review on the server:

- Keep Chromium's sandbox: give this container a seccomp profile that also allows the namespace calls the sandbox makes (`unshare`, and `clone` with namespace flags), referenced with `security_opt: [seccomp=<file>]`. The host kernel must allow unprivileged user namespaces, and an AppArmor policy can still block them. This route has not been verified here.
- Set `MOUSA_CAPTURE_NO_SANDBOX=1`. Chromium then runs without its sandbox, and the container is the only boundary around the captured pages, which the model wrote from reviewers' briefs. A browser exploit in such a page would run as UID 1000 with this container's access: the volume's jobs and Kiro home, the server's environment through `/proc` (including `KIRO_API_KEY` and `QLOO_API_KEY`), and outbound network, because an exploit is not bound by the browser's own network rules. The read-only root filesystem, dropped capabilities, `no-new-privileges` and the process and memory limits still apply. Consider it only for a gated jury demo, and rebuild the image to take Debian's Chromium security updates.
- Leave the review out with `MOUSA_CAPTURE=off`, or as the default does when the sandbox cannot start.

## Recorded local work on the hosted server

Runs recorded locally with Codex pictures can be shown on the hosted Studio, which labels their pictures as recorded with local image generation. `scripts/export-hosted-jobs.mjs` copies completed jobs out of the local `DATA_DIR` with their workspaces, without their Kiro homes, agent configurations or pair work folders, which hold design sessions and per-run bridge tokens. A pair recorded with the command-line runner (`game/runs/<pair-id>`) is first imported into the local Studio with `scripts/import-game-pair.mjs`.

```sh
node scripts/export-hosted-jobs.mjs --list
node scripts/export-hosted-jobs.mjs --out ../hosted-jobs <job-id> <job-id>
node scripts/export-hosted-jobs.mjs --out ../hosted-jobs --showcase
```

`--showcase` adds the [showcase](../README.md#showcase) set locally with `scripts/build-showcase.mjs`: `showcase.json`, the jobs it names and the app run's folder, only the files the Studio serves from it. The showcase is public on purpose: anyone who reaches the application reads those records without the access token, with their briefs, cultural context, the Qloo responses they cite, the model's output and their preview links, and plays the app run. Everything else stays behind `DEMO_ACCESS_TOKEN`. Leave `--showcase` out for a server that should show nothing without the token; a server whose `DATA_DIR` has no `showcase.json` has no showcase.

Review the exported folder before uploading it: the job records keep the briefs, cultural context and model output of those runs. Then copy it into the volume as UID 1000 and restart the app, for example:

```sh
docker compose --env-file /private/path/demo.env -f deploy/docker-compose.yml stop app
docker run --rm --user 1000:1000 --entrypoint sh -v qloo-design-demo_demo-data:/data -v "$PWD/../hosted-jobs:/import:ro" qloo-design-demo:local -c 'cp -R /import/. /data/jobs/'
docker compose --env-file /private/path/demo.env -f deploy/docker-compose.yml start app
```

The volume name follows the Compose project name. These copy commands have not been run here. Copied jobs count toward `MAX_JOBS`, and their preview links keep the capability tokens they were recorded with.

## Account and credit boundary

Kiro headless mode uses `KIRO_API_KEY`; [authentication documentation](https://kiro.dev/docs/getting-started/authentication/) lists paid plans that can generate these keys and states that usage consumes the same account's subscription credits. Local development can use the operator's existing Kiro sign-in. The deployed container uses an empty dedicated home and an API key; do not copy local browser credentials into it. Kiro headless API-key availability for this user's account has not been checked, and no such key has been generated here. Local Qloo entity lookup and selected insights requests have been verified; no Qloo credential has been deployed to an AWS resource.

The [Kiro pricing FAQ](https://kiro.dev/pricing/) permits native Kiro interfaces and software-development automation, requires each developer to have their own subscription, and limits third-party harnesses that route requests outside native interfaces. A controlled judge demo and an unrestricted public multi-user design service are different operating scopes. The latter's subscription authorization and concurrency limits have not been verified. Do not advertise unrestricted public service access as a confirmed property of this deployment.

Kiro subscription credits, Qloo access, and AWS infrastructure credits are separate accounts/allocations. Use only the AWS services and credit eligibility already confirmed by the user. These files do not purchase add-on credits, enable overages, upgrade subscriptions, or claim that Kiro usage is covered by an AWS infrastructure credit balance. Keep reviewer access gated and cap work through the application's queue/run limits.

## Concrete deployment sequence

These steps are for the operator after local validation and authorization to publish. They do not provision resources automatically.

1. Validate the app locally and inspect the generated files. Verify Qloo-on/off behavior using actual credentials only when live runs are authorized. Establish which Kiro model and CLI version worked.
2. Prepare a supported Linux x86-64 EC2 host with Docker/Compose, encrypted storage, and enough disk for the installer/image/job volume. Begin with one worker; resource sizing needs measurement. Use Systems Manager or restricted SSH for administration.
3. Place the private environment file outside the checkout. Set a strong, unique `DEMO_ACCESS_TOKEN`. Set `PUBLIC_PREVIEW_BASE_URL` to the browser-reachable preview origin: use the loopback example for local container testing, then the separate HTTPS preview origin for AWS. Supply the required Kiro/Qloo credentials through runtime secret injection. Keep their values out of shell history and chat.
4. From the repository root, build and start the container. Building downloads software; it is not a generation test:

   ```sh
   docker compose --env-file /private/path/demo.env -f deploy/docker-compose.yml up --build -d
   ```

5. Inspect the build's Kiro version record and container logs. Do not paste logs containing prompt content, tokens, or private artifact URLs into public channels. Test through `http://127.0.0.1:8787` on the host or an authenticated SSH tunnel first.
6. Put an HTTPS reverse proxy in front of the loopback application port and a separate preview origin in front of the preview port. Allow inbound HTTPS only from the intended reviewer access path; do not open ports 8787/8788 publicly. Confirm that the application's emitted preview URL points to the publicly reachable HTTPS preview origin; proxying only the application port is insufficient. Forward the access header/cookie used by the application, and avoid logging authorization tokens or preview capabilities. Keep normal polling requests short; generation runs as background jobs.
7. Test a browser review session from a separate device. Confirm that missing/wrong review tokens reject protected operations and that a preview can neither access the control UI's storage nor make external network requests. Check responsive previews in an up-to-date browser; do not hardcode one developer's Chrome version as a deployment prerequisite.
8. Once an actual live run passes, record the image digest, CLI/model identifiers, timeout, and time to a usable artifact. Preserve a known-good image and restrict concurrent jobs. Share the gated HTTPS review link only after it is verified.

For ECR, tag/push the verified image using the operator's approved AWS account/region, then deploy by digest. No account ID, region, domain, certificate, VPC, repository, instance, or role is invented in these files. Those values come from the user's selected deployment environment.

## Operations and verification checklist

- Build/parser checks need no account credentials. A real generation run consumes Kiro credits and Qloo API usage.
- Verify the Linux image boots as UID 1000, the source is read-only, and `/data` remains writable after restart.
- Read the start log's `Generated images` and `Review captures` lines (or `/api/status`): images are off with the hosted reason, and the review is on with Chromium or off with the reason its test capture failed.
- Start without a review token and confirm the non-loopback bind is rejected. Do not use a placeholder review token for an internet-facing demo.
- Verify failure behavior for missing keys, Qloo failure, MCP startup failure, Kiro timeout, invalid generated files, and queue capacity. Failed work must be visibly marked rather than presented as a successful cultural design.
- Verify static previews and exports do not carry Kiro/Qloo/review tokens. Reviewer-generated content is still untrusted content.
- Keep run duration/queue/job count/disk usage observable without logging credentials. Job directories can contain user prompts and generated content; restrict volume and backup access.
- The initial process serializes generation. A worker restart may interrupt its active job; do not assume the in-memory queue survives it. Wait for the current job to finish before a planned restart.
- Use `docker compose ... stop` to stop generation and preserve the volume. Remove resources only after exporting any results the user needs. Expired job cleanup and account-key revocation are separate actions.

Verification status for the deployment files: Compose configuration validation and entrypoint shell syntax checks passed; the entrypoint uses LF line endings. Docker Desktop's Linux engine was unavailable during these checks, so the image build and Linux Kiro runtime have not been executed. These deployment checks performed no inference, account authentication, AWS provisioning, or public deployment. Local application generation is a separate verification step and does not establish that the Linux deployment works.

On 2026-10-06 the Compose file was validated again with placeholder values, and the files the image copies (by the `.dockerignore` allowlist) were started on Windows as a hosted Studio without Kiro, a Qloo key or `.env`: it reported no image generator with the hosted reason, captured its test page with Edge, and served two exported recorded jobs (a website comparison with 14 Codex pictures and a character pair with 2 portraits), their previews, pictures and game pages, with the recorded-pictures labels. The earlier allowlist lacked `game/` and `library/`, which the server imports and serves; it would not have started. Chromium in the Linux container, its sandbox failure and the test capture that detects it, and the three routes above have not been run here.
