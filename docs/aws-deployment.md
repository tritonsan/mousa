# AWS deployment and operating notes

The delivered application runs locally. These deployment files prepare an AWS-hosted review demo; no AWS resource, public URL, subscription change, API key, or paid inference has been created by this document.

## First deployment: one EC2 container

Use one Linux x86-64 EC2 host and one Docker container for the initial controlled review demo. This matches the application's current single Node.js process, serialized job queue, and local job storage. Start behind an HTTPS reverse proxy with reviewer access restricted. The Compose port is deliberately published on the host's `127.0.0.1` only.

This is an engineering choice for the current application, not a claim that Lambda cannot run Kiro. [AWS documents Kiro CLI in a Lambda container with headless authentication](https://aws.amazon.com/blogs/devops/building-a-slack-powered-ai-development-agent-with-kiro-cli-and-headless-authentication/). Normal Lambda functions have a [15-minute invocation limit and invocation-local storage](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html); the current persistent server, queue, and job files would require a different deployment architecture. The image contains Debian's Chromium for the designers' review captures; see [Review captures in the container](#review-captures-in-the-container) before relying on them.

ECS on Fargate is a later option for running the same container. Before adding multiple workers, move job dispatch to SQS and job metadata/artifacts to shared storage such as DynamoDB/S3. The in-process queue is not distributed or durable. Two instances must not share a job directory and independently process the same jobs. Completed job metadata and previews reload after a restart; interrupted jobs are marked failed rather than resumed. Horizontal scaling, an SQS consumer, S3 export, and automatic resumption are not implemented by these files.

## The public site and the live try

The jury's server shows four things:
- the public site: the landing page, the gallery of recorded sessions and the blind vote;
- the live try at `/try/`, open to anyone since October 24 (`TRY_ACCESS=open`, since the hackathon gives jurors no field for a code), with 100 first steps and 10 pairs a day;
- the recorded Studio jobs, readable;
- the Studio itself, whose own paid job runs are closed with `LEGACY_JOBS=off`, the Compose default.

It needs two HTTPS names, one for the app and one for the preview origin the designs play from. Nothing here creates them.

**The host.**
- One x86-64 EC2 instance with an Elastic IP: about 2 vCPU and 8 GB, such as t3.large, on Amazon Linux 2023, with a 40 GB encrypted gp3 volume.
- Administer it through Systems Manager, with an instance role that holds only `AmazonSSMManagedInstanceCore`; no SSH port is opened.
- The container gets 2 CPUs and 6 GB, since a pair runs two Kiro sessions, each with Moûsa's server and its captures, beside up to two first steps.

### One stack: `deploy/aws/mousa-stack.json` (recommended)

The whole server is one CloudFormation stack, made in the console in one form. `scripts/build-aws-stack.mjs` writes the template; `deploy/aws/first-boot.sh` is its user data and `deploy/aws/bootstrap.sh` the first boot.

**What the stack makes.**
- One Ubuntu 24.04 instance, t3.large by default, with an encrypted 60 GB gp3 disk, administered through Session Manager with no SSH key.
- Its Elastic IP, and a security group with one rule: TCP 8787-8788 from CloudFront's origin-facing prefix list, which a small Lambda looks up for the region.
- Two CloudFront distributions, the app (port 8787, all methods) and the preview (port 8788, GET and HEAD), each with its own `cloudfront.net` HTTPS name, `CachingDisabled` and `AllViewer`, and no error kept in the cache.
- Three secrets in Secrets Manager: the Qloo key, the Kiro key and the jury's access code as given, and a generated `SITE_SECRET` and `DEMO_ACCESS_TOKEN`. Only the instance role reads them. They never enter the instance's user data.
- IMDSv2 with one hop, so no container, and no page the model wrote, can reach the instance role.
- A daily snapshot of the disk at 03:00 UTC, the last 14 kept.

**What the first boot does**, logged to `/var/log/mousa-bootstrap.log` without any secret:
1. It waits until the Elastic IP is the instance's address, so no download is cut when the address changes.
2. It clones the repository at the stack's ref.
3. It adds 4 GB of swap, and lets Chromium's sandbox create user namespaces, which Ubuntu 24.04's AppArmor refuses by default.
4. It installs Docker from Docker's repository, with container logs rotating at 5 × 20 MB.
5. It writes `/etc/mousa/demo.env`, mode 600, with `deploy/aws/write-env.py`: the secrets, the two CloudFront names, `TRUST_PROXY=1`, `LEGACY_JOBS=off` and JSON logs.
6. It builds the image. The build stops if the stable channel's Kiro is not major version 2.
7. It imports the data bundle when the stack names one, after checking its SHA-256.
8. It starts the site and waits for `/api/health`.
9. It reports to the stack's wait condition: success with the deep health summary (`deploy/aws/health-summary.py`), or the line it stopped at.

**Before the stack.**
- The repository is public on GitHub, with the commit to deploy pushed.
- The keys at hand: the Qloo hackathon key, a Kiro API key from app.kiro.dev, and an access code for the jury of 12 or more letters and digits.
- Optional, the data bundle, on the machine that holds the recorded runs:

  ```sh
  node scripts/export-hosted-jobs.mjs --out ../hosted --gallery --showcase
  tar -czf mousa-data.tar.gz -C ../hosted .
  ```

  The bundle is put at an https address the instance can download, such as a release asset or a presigned S3 address, and its SHA-256 goes into the stack with it. Without a bundle the site starts with the Studio and the try, and no gallery.

**In the console.**
1. CloudFormation, Create stack, With new resources, Upload a template file: `deploy/aws/mousa-stack.json`.
2. Name the stack, for example `mousa-jury`. Fill in the repository and its ref, the three keys and the code, and choose the region's default VPC and one of its subnets. Leave the rest as it is.
3. On the options page, under Stack failure options, choose "Preserve successfully provisioned resources". A failed first boot then leaves the server running, so its log can be read.
4. Acknowledge that the stack creates IAM roles, and create it.
5. It takes about 25 minutes, most of it CloudFront's. The stack ends with CREATE_COMPLETE once the site runs, or with the bootstrap's reason.

**Its outputs.**
- `AppUrl` is the address for the jury.
- `StudioToken` links to the Secrets Manager page of the token for `/studio` and `/api/health/deep`.
- `SessionManager` opens a shell on the server.
- `Bootstrap` is what the first boot reported: Kiro's version, the captures, the try and the gallery.

**Checks once it runs.**
- `node scripts/verify-site.mjs --app <AppUrl>` from any machine.
- `/api/health/deep` with the token, from two networks: `caller.address` must differ between them.

**Moving the running server to a new commit or bundle,** without a stack update. Systems Manager runs [deploy/aws/redeploy.sh](../deploy/aws/redeploy.sh) as root, because the instance has no SSH. The command checks the ref out first, since a server on an older commit may not hold the script:

```sh
aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript --parameters 'commands=["cd /opt/mousa && git fetch -q --depth 1 origin <ref> && git checkout -q --detach FETCH_HEAD && bash deploy/aws/redeploy.sh <ref> <bundle url> <bundle sha256>"]'
```

- It builds the new image while the site keeps running. A build that fails, for example on Kiro's major-version guard, leaves the site as it was.
- It checks the bundle's SHA-256 before anything stops.
- It replaces only the gallery folder of the volume; the tries, votes and jobs stay.
- It points `MOUSA_COMMIT` at the new commit and waits for the health check. The site is down for about a minute while the container restarts.

The stack's own parameters (`RepositoryRef`, `DataBundleUrl`, `DataBundleSha256`) keep naming what the first boot used. A later first boot, on a replaced instance, would use them. Updating them is a stack update, with two costs:
- The user data changes, so the instance is stopped and started.
- The Ubuntu image comes from the `/current` SSM parameter, so the update may resolve a newer image. That replaces the instance with a fresh disk: the tries and votes are gone, and Kiro is reinstalled at whatever version is then current.

So the running server moves with `redeploy.sh`. The stack is updated only together with a planned rebuild, and never during the judging.

**During the judging,** do not update the stack: a change that replaces the instance builds the image again, with whatever Kiro is then current. **After 16 November,** delete the stack, delete the snapshots the policy made, revoke the Kiro key at app.kiro.dev and rotate the Qloo key.

**Its cost,** on demand in us-east-1, roughly: the t3.large about $60 a month, the disk about $5, the public IPv4 address about $3.60, the secrets $1.20, and the snapshots, CloudFront and the Lambda a little each.

**Where it stands (22 October 2026).** cfn-lint passes the template and `tests/aws-stack.test.mjs` checks it. The first boot's own parts were rehearsed in Docker on Windows: `write-env.py` against a stand-in Secrets Manager, the bundle (11 gallery entries and the showcase, 110 MB) imported into the Compose volume with the bootstrap's commands, the site started, and `verify-site.mjs` passed 21 pages. The same day the stack was created as `mousa-jury` in us-east-1, with the AWS CLI instead of the console: see the [verification record](verification.md#the-jury-server-on-aws--october-22-2026).

### Without a domain: two CloudFront distributions

Promotional credits do not cover domain registration, and Let's Encrypt refuses certificates for the EC2 host names under `amazonaws.com`. CloudFront gives each distribution an HTTPS name of its own under `cloudfront.net`, served with AWS's certificate at no charge for the certificate. CloudFront itself is an AWS service billed by use, within its free tier for traffic this small. Two distributions are two origins, which is what the app and its preview need.
- **The two distributions.** Both have the instance's public DNS name (from its Elastic IP) as a custom origin, HTTP only:
  - **App:** origin port 8787, viewer protocol "Redirect HTTP to HTTPS", all HTTP methods.
  - **Preview:** origin port 8788, GET and HEAD.
- **Their policies.**
  - The cache policy is `CachingDisabled`; the app marks what may be cached itself, and the jury's traffic is small.
  - The origin request policy is `AllViewer`, which forwards the cookies, the query strings, the `Range` header for the game's music and the viewer's `Host`.
  - No Lambda@Edge, function or WAF is needed. Leave CloudFront's standard logs off: a try's URLs carry its id and preview token.
- **The security group.** One inbound rule, TCP 8787-8788, from the managed prefix list `com.amazonaws.global.cloudfront.origin-facing`. The list counts as about 55 rules toward the group's quota, so two separate rules for the two ports may not fit. Nothing else comes in.
- **The environment file.** Fill it with the distributions' names once they exist, then start Compose:
  - `DEMO_BIND=0.0.0.0`, so the ports listen beyond loopback, behind the security group;
  - `PUBLIC_APP_BASE_URL=https://<app>.cloudfront.net` and `PUBLIC_PREVIEW_BASE_URL=https://<preview>.cloudfront.net`;
  - `TRUST_PROXY=1`: CloudFront appends the viewer's address to `X-Forwarded-For`, and the app reads that last entry, not one the client wrote.
- **Health.** An uptime check can watch `https://<app>.cloudfront.net/api/health`, for example a Route 53 health check with a CloudWatch alarm, both AWS services.
- **Between CloudFront and the instance**, requests travel as HTTP, since no certificate can be had for the EC2 name. The security group keeps everyone but CloudFront out.
- **Stronger: a VPC origin.** CloudFront then reaches a private IP and the instance needs no public inbound path. It needs a private subnet and, for the instance's own outbound calls (Qloo, Kiro, packages), a NAT gateway, which costs by the hour.
- **A domain later** needs no change to the server. Add it to both distributions as an alternate name with a free ACM certificate (in us-east-1), and update the two `PUBLIC_*` addresses.

None of this has run on AWS yet.

### With a domain: Caddy on the host

The security group admits 443, and 80 for the certificate's HTTP challenge, and nothing else. Caddy terminates TLS for both names and forwards to the loopback ports:

```
app.example.org {
	reverse_proxy 127.0.0.1:8787
}
preview.example.org {
	reverse_proxy 127.0.0.1:8788
}
```

Caddy sets `X-Forwarded-For`, which the app reads with `TRUST_PROXY=1`, the Compose default, and `PUBLIC_PREVIEW_BASE_URL` is `https://preview.example.org`. Caddy writes no access log unless one is configured, so leave it off. With either proxy, keep the URLs out of logs:
- A try's page and its designs' URLs carry the try's id and preview token.
- The vote's picture URLs carry sealed ballots.

**The private environment file**, such as `/etc/mousa/demo.env` with mode 600, lives outside the checkout. Beyond the Studio's variables, it holds:
- `SITE_SECRET` (`openssl rand -hex 32`), which seals the vote's ballots and signs the try's access cookie;
- `TRY_ACCESS_CODE`, 12 characters or more, given to the jury with the submission;
- `SITE_REPOSITORY_URL` once the repository is public;
- `TRY_ARMS_PARALLEL` and `TRY_QLOO_BUDGET`, if the defaults (on, 24) change;
- `MOUSA_COMMIT=$(git rev-parse --short HEAD)` at build time, so each try records the commit the image was built from.

`SITE_SECRET_FILE` and `TRY_ACCESS_CODE_FILE` read them from mounted files instead.

**The data** in the volume's `DATA_DIR` (`/data/jobs`):

| Folder | Holds | Public |
| --- | --- | --- |
| `gallery/` | The public gallery | Yes |
| `votes/` | The sealed vote records | No |
| `try/<id>/` | One live try: `meta.json` and `project/` with its reports and both arms; `project/.mousa/usage.json` counts every Qloo request the try sent | Only after the juror's consent and a gallery build |
| `try/<id>/kiro/` | Each session's Kiro home | Never |
| `try/<id>/sessions/` | Each session's stream and error log, for the operator | Never |

Each session's agent file names the Qloo key for the arm that measures. The file is removed when its session ends. Still, restrict the volume and its snapshots to the operator.

**Moving the gallery to the server.** Build and scan it on the machine that holds the recorded runs, then export it with the showcase:

```sh
node scripts/build-gallery.mjs --runs D:/mousa-live
node scripts/export-hosted-jobs.mjs --out ../hosted --gallery --showcase
```

`--gallery` scans the gallery again before copying it and stops at any finding. Copy the folder into the volume as shown in [Recorded local work](#recorded-local-work-on-the-hosted-server), then restart the app, which reads the gallery once at start.
- **Tries that become public.** A try whose juror agreed to publish it joins the gallery the next time it is built where its folder is. Either build on the server from `DATA_DIR/try`, or copy the try's folder back first.

**Operating it.**
- **Health.** `/api/health` is public, for an uptime monitor.
- **The detailed check.** `/api/health/deep`, behind `X-Demo-Token: <DEMO_ACCESS_TOKEN>`, says whether the try is open and what it lacks. It also reports Kiro's version and sign-in, the capture browser, the free disk, the try's queues and the gallery's size, and names no secret.
- **Pausing.** `docker compose exec app touch /data/jobs/try/PAUSED` stops new tries without a restart, and removing the file resumes them. Running steps finish.
- **The day's spend.** `/api/health/deep` reports `try.day` (first steps, pairs and metered credits in the last 24 hours) beside `try.limits`. The caps are off by default, as decided for the jury's six members; the numbers are there to read, and a cap can be set later without any other change.
- **The caller's address.** `/api/health/deep` also returns `caller`: the address this request counts as and how many entries `X-Forwarded-For` carried. Check it from two networks before the jury does: behind CloudFront with `TRUST_PROXY=1` the two addresses must differ, or every juror shares one address's limits.
- **Logs.** With `LOG_FORMAT=json` the container writes one object a line: `started`, each `request` (route pattern, status, milliseconds; no id or token), the try's warnings and errors, `unhandled-rejection` and `uncaught-exception`. A collector reads `docker logs`; nothing in it needs redaction after the fact, since the secrets are removed as lines are written.
- **Restarts and the retention.** A restart marks an interrupted step as such and keeps its streams; a finished try older than `TRY_PRIVATE_RETENTION_DAYS` loses its Kiro homes and streams at that start. An uncaught exception ends the process for Compose to start it again; an unhandled promise rejection is logged and the Studio goes on.
- **Restarts.** A restart marks an interrupted step as such. The juror starts it again.
- **The judging period (2 to 16 November).**
  - Build the image once, inspect it, and deploy it by digest. Do not rebuild while judging runs.
  - Take a daily snapshot of the volume.
- **After the judging period:**
  - rotate the Qloo and Kiro keys, `SITE_SECRET`, `TRY_ACCESS_CODE` and `DEMO_ACCESS_TOKEN`;
  - then decide what of the volume to keep.

None of this has run on AWS. The Linux image and the Linux Kiro runtime have not been built or run either; see the checklist below.

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
| `SITE_SECRET` | Seals the vote's ballots and signs the try's access cookie; required by Compose |
| `TRUST_PROXY` | How many proxies in front append to `X-Forwarded-For`: Compose default `1` (CloudFront or Caddy alone), `2` for CloudFront in front of Caddy |
| `PUBLIC_APP_BASE_URL` | The app's public origin behind CloudFront, such as `https://<app>.cloudfront.net`, which forms may post from |
| `DEMO_BIND` | The host address Compose publishes the ports on: `127.0.0.1` for Caddy, `0.0.0.0` behind CloudFront |
| `SITE_REPOSITORY_URL` | The public repository the site links to (https only); optional |
| `TRY_ACCESS_CODE` | The jury's code for `/try/`, 12 characters or more; empty keeps the try closed unless `TRY_ACCESS` is `open` |
| `TRY_ACCESS` | `code` (the default) asks for `TRY_ACCESS_CODE`; `open` asks for no code, as the stack writes it. An open try needs the daily caps below |
| `TRY_ARMS_PARALLEL` | `on` runs a pair's two Kiro sessions at once, `off` one after the other |
| `TRY_QLOO_BUDGET` | Qloo requests one try may send in all; default `24` |
| `TRY_DAILY_RUNS`, `TRY_DAILY_PAIRS`, `TRY_DAILY_CREDITS` | Optional caps on the server's own rolling day for the try, whoever asks: first steps, pairs and Kiro credits as its stream meters them. All off at `0` in Compose; the stack writes `100` first steps and `10` pairs for the open try. A cap that is set refuses a new step with 503 and the recorded sessions stay open. One live pair cost about 87 credits on 14 October 2026, and the open try's first pair 113 on 24 October (70 with Qloo, 43 without); a try's record keeps each session's `credits` and `contextPeak` either way |
| `TRY_PRIVATE_RETENTION_DAYS` | Compose: `14`. At start, a finished try older than this keeps its record, reports and designs; its Kiro homes and session streams are removed. `0` keeps them |
| `MOUSA_CAPTURE_INLINE_SIDE` | The longer side a review capture is scaled to before the model sees it (512-2400). Empty is the engine's choice: 1024 on a hosted server, 1568 locally, since a round of 1568-pixel captures took two live arms to 95% of their context |
| `LOG_FORMAT`, `REQUEST_LOG` | Compose: `json` and `on`: one JSON object a line with the secrets redacted, and a record per request with its route pattern, status and time, never a try's id, a preview token or a ballot. Locally `text` and `off` |
| `LEGACY_JOBS` | Compose: `off`, so the Studio's own job runs take no new work and `/mcp`, the job bridge and workspace changes answer 404 or 403; `on` locally |
| `MOUSA_COMMIT` | Build argument and variable: the commit the image is built from, which each try records |
| `DEMO_PORT` | Compose host port, default `8787`; host mapping stays loopback |
| `DEMO_PREVIEW_PORT` | Compose preview host port, default `8788`; host mapping stays loopback |

Configure retention/queue limits using the server's documented settings. Retention is not a backup policy. Deleting the Compose volume deletes local jobs; do not use `docker compose down -v` to restart the demo.

Each generation mode has its own timeout, which does not count host waits such as captures. Two serialized comparison modes can therefore take up to 30 minutes with the default budget, plus queue waiting and validation. Both modes receive the same configured model and effort. An initial five-minute local baseline timed out before saving every file. A subsequent local-food baseline completed in approximately 3 minutes 57 seconds with a ten-minute budget and `medium` effort. This single Windows run does not establish AWS latency, Qloo-on latency, or a guaranteed generation time. See [local verification](verification.md).

`deploy/demo.env.example` contains empty credential placeholders. Copy it to a private location outside the repository and fill it on the operator's machine. Restrict its permissions to the operator. Never put filled credentials in the image, source control, screenshots, build arguments, prompts, exported ZIPs, or shared command output. Compose can read this file with `--env-file`; do not publish the output of `docker compose config`, because it resolves secret environment values.

The entrypoint also supports optional mounted files through `DEMO_ACCESS_TOKEN_FILE`, `KIRO_API_KEY_FILE`, and `QLOO_API_KEY_FILE`. The base Compose file uses runtime environment injection. File mounts require a separate operator-supplied Compose override. [ECS supports runtime secret injection through Secrets Manager or Systems Manager Parameter Store](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html); use its `secrets` container definition field if moving to ECS. Restrict secret access to the relevant execution role and restart tasks after rotation. Secrets supplied in environment variables remain visible to principals allowed to inspect the container.

Do not give the generation worker an EC2 instance role or task role with provisioning permissions. A role used for image pulls/logging/secret injection should be separate from permissions available to generated tools. The current application does not need AWS CLI credentials to generate a static site.

## Review captures in the container

With the production stages, each designer reviews captures of its saved site (desktop 1440×900 and mobile 390×844) or character before it finishes. The host renders them in headless Chromium, which can reach only a loopback server holding that one design: host names resolve nowhere, other connections go to a closed local proxy, and the browser process gets the server's environment without the variables whose names contain KEY, TOKEN, SECRET or PASSWORD. Kiro opens the PNGs with its own read tool, pointed at the run's review folder: the run's other files are denied to it by name, and a read outside the run's folder fails in the non-interactive run (observed with kiro-cli 2.24.0 and 2.27.1 on Windows).

Chromium isolates each page in its own sandbox, which needs unprivileged user namespaces. Docker's default seccomp profile blocks them. The Studio checks this before any run: at start it captures one test page. When that fails, it leaves the review out of every capability list and says why in its log and in `/api/status` (its sandbox needs user namespaces, which this system blocks). Designs are then planned and checked as before, without a visual review. The Compose file gives Chromium 512 MB of `/dev/shm` and a process limit that fits its threads.

**The Compose file keeps Chromium's sandbox.** It runs the container under `deploy/seccomp-chromium.json`: Docker's default profile with three changes, written by `scripts/build-seccomp.mjs` from moby/profiles' `default.json`.
- `clone` may create namespaces.
- `unshare` and `chroot` are allowed.
- Nothing else changes: `mount`, `setns`, `pivot_root` and every other call keep the default's rules. Inside a new user namespace a mount is still refused.

Licence and changes: `deploy/seccomp-chromium.NOTICE` and `deploy/seccomp-chromium.LICENSE` (Apache 2.0).

On 14 October 2026, on Docker Desktop's Linux engine, the real Compose file started the image under this profile with every capability dropped and `no-new-privileges`. Chromium's test capture passed with its sandbox, and the healthcheck reported healthy. Two conditions remain:
- the host kernel must allow unprivileged user namespaces, as Amazon Linux 2023 does by default;
- an AppArmor or SELinux policy can still refuse them.

Check the start log's `Review captures:` line on the server.

**The trade-off.** The profile lets a process in the container create user namespaces, which widens what the kernel exposes to it: kernel bugs reachable through user namespaces have been used to escalate privileges. In return the captured pages, which the model wrote, stay inside Chromium's own sandbox. Keep the host's kernel updated.

**The other routes**, if the profile cannot be used:
- **Without Chromium's sandbox.** Set `MOUSA_CAPTURE_NO_SANDBOX=1` and remove the `seccomp=` line. The container is then the only boundary around the captured pages. A browser exploit in such a page would run as UID 1000 with this container's access:
  - the volume's jobs and Kiro homes;
  - the server's environment through `/proc`, including `KIRO_API_KEY` and `QLOO_API_KEY`;
  - outbound network, since an exploit is not bound by the browser's own network rules.

  The read-only root filesystem, the dropped capabilities, `no-new-privileges` and the process and memory limits still apply. The test capture passed this way too.
- **No review.** Leave the review out with `MOUSA_CAPTURE=off`, as the Studio does by itself when the sandbox cannot start.

## Recorded local work on the hosted server

Runs recorded locally with Codex pictures can be shown on the hosted Studio, which labels their pictures as recorded with local image generation. `scripts/export-hosted-jobs.mjs` copies completed jobs out of the local `DATA_DIR` with their workspaces, without their Kiro homes, agent configurations or pair work folders, which hold design sessions and per-run bridge tokens. A pair recorded with the command-line runner (`game/runs/<pair-id>`) is first imported into the local Studio with `scripts/import-game-pair.mjs`.

```sh
node scripts/export-hosted-jobs.mjs --list
node scripts/export-hosted-jobs.mjs --out ../hosted-jobs <job-id> <job-id>
node scripts/export-hosted-jobs.mjs --out ../hosted-jobs --showcase
```

`--showcase` adds the [showcase](development-notes.md#showcase) set locally with `scripts/build-showcase.mjs`: `showcase.json`, the jobs it names and the app run's folder, only the files the Studio serves from it. The showcase is public on purpose: anyone who reaches the application reads those records without the access token, with their briefs, cultural context, the Qloo responses they cite, the model's output and their preview links, and plays the app run. Everything else stays behind `DEMO_ACCESS_TOKEN`. Leave `--showcase` out for a server that should show nothing without the token; a server whose `DATA_DIR` has no `showcase.json` has no showcase.

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

On 2026-10-14, for the site and the live try:
- **Compose.** The file was validated again with placeholder values: 2 CPUs, 6 GB, 1,024 processes, a 1 GB `/tmp` and 512 MB of shared memory, `TRUST_PROXY=1` and `LEGACY_JOBS=off`.
- **The image.** It now also copies the try's two folder starters, `examples/mobile-app` and `examples/long-dusk`; the allowlist leaves out their `.kiro` and `.mousa` folders. It records `MOUSA_COMMIT` and checks `/api/health` itself.
- **The imports.** The server's imports reach only `src/`, `plugin/` and `game/`, all three in the allowlist.
- **The entrypoint.** Its syntax checks pass, with LF line endings. It also reads `SITE_SECRET_FILE` and `TRY_ACCESS_CODE_FILE`.
- **Not run at first.** Docker Desktop's engine was not running, so the image was not built then.

Later the same day the image was built locally (Docker Desktop 4.76, engine 29.5.2).
- **The image.** 729 MB. The stable channel installed kiro-cli 2.31.0; the local live try ran 2.24.0.
- **A smoke test.** It started as Compose would, with throwaway secrets and no Kiro or Qloo key:
  - it ran as UID 1000 with a read-only root;
  - Ramble's `data/` was there, with no dot entries in the starters, and `MOUSA_COMMIT` was recorded;
  - `/api/health` answered, and `/api/health/deep` named what the try lacks.
- **The gallery in the container.** It was exported with `--gallery` (10 entries, scanned clean) and copied into the volume. Then:
  - `scripts/verify-site.mjs` passed all 18 pages;
  - a design played from the preview origin under the sandboxed policy;
  - the vote issued a ballot, and `/try/` showed its pending page.
- **Review captures.** By default Chromium's sandbox could not start, as expected. The test capture passed in two other ways:
  - with `MOUSA_CAPTURE_NO_SANDBOX=1`;
  - with Chromium's sandbox kept under `--security-opt seccomp=unconfined`.

  So on this kernel only Docker's default seccomp profile blocks the sandbox. The profile the Compose file now uses, `deploy/seccomp-chromium.json`, passed the test with the sandbox kept. See [Review captures in the container](#review-captures-in-the-container).
- **Not run in the container:** Kiro with an API key, and a try.
