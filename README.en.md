# Kafedra Planner

[Русский](README.md) · [English](README.en.md)

[![CI](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml)
[![Release gate](https://github.com/f2re/kafedra-planner/actions/workflows/release-gate.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/release-gate.yml)
[![GitHub Release](https://img.shields.io/github/v/release/f2re/kafedra-planner?display_name=tag&sort=semver)](https://github.com/f2re/kafedra-planner/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Kafedra Planner is an offline-first daily work system for an academic department: calendar, annual plans, assignments, documents, meetings, reporting, research activity, grade sheets, and auditable evidence.

> Current milestone: **`0.4.3`**, SQLite schema **31**. Core workflows do not require Internet access, Docker, an LLM, Docomator, or cloud services. The project remains a release candidate until the real Astra Linux/Debian installation, upgrade, restoration, and rollback acceptance in [TARGET_ACCEPTANCE.md](docs/TARGET_ACCEPTANCE.md) and issue #27 is complete.

Patch release `0.4.3` adds annual multi-file protocol intake, independent per-file processing, persistent `ready / review / failed / processing` status, and review-by-exception editing without destroying raw extraction or source evidence. The release pipeline now uses one universal gate and publishes the same offline artifact that passed install, update, and forced rollback verification.

**[Download an offline bundle](https://github.com/f2re/kafedra-planner/releases)** · **[Install guide](docs/GITHUB_RELEASES.md)** · **[Security policy](SECURITY.md)** · **[Russian documentation](README.md#эксплуатация-и-документация)**

Published releases are immutable. `v0.4.1` and `v0.4.2` remain historical bundles; annual protocol intake and the simplified universal release pipeline are delivered in `v0.4.3`.

## Operating model

An uploaded file is never replaced by recognised text or an AI result. Every extracted fact retains its source and locator; manual corrections retain their reason and history. A failing document, row, optional converter, Docomator endpoint, or LLM must not block unrelated data or the core daily workflow.

Main areas include calendar, immutable documents, imported and manual plans, direct task completion, plan/fact reporting, meetings and versioned DOCX templates, research records, academic grade sheets, PIN access, object ACL, backup/restore, and optional local `llama.cpp` assistance.

## Annual meeting protocols

Open **Meetings**, select a calendar year and choose multiple DOCX, ODT, PDF, or TXT protocols at once. Each file is persisted as an immutable document version before interpretation. Safe facts materialise immediately; a bad or ambiguous file does not roll back the others.

The annual summary is reconstructed from durable document, extraction, meeting, and review state after reload. A questionable protocol number, date, agenda item, decision, responsible person, or due date opens the exact meeting and original source for correction. Manual changes update working meeting/decision/calendar/search projections but keep the machine result, source locator, blob, and SHA-256 intact.

See [MEETINGS.md](docs/MEETINGS.md).

## Docomator employee import

Open **Settings → Department structure → Import from Docomator** and paste the address that opens in a browser, for example:

```text
http://192.168.1.50:8080
https://docomator.local
http://[fd00::25]:8080/api/v1
```

There is no separate protocol, port, or API-version control. Known `/api/v1`, `/healthz`, `/readyz`, and `/api/v1/system/*` suffixes are reduced to the service origin. Credentials, query parameters, fragments, unsupported schemes, and unrelated paths are rejected before a network request.

Select **Connect**, enter the optional four-digit Docomator access code for the current request, choose a space, group, and remote fields, review the employee preview, and import. The access code is not stored. Current Docomator readiness `status: ok` and the legacy `ready` value are both accepted.

Planner performs remote requests from the Planner server, not from the browser. Therefore a DNS name must resolve on that server. An IP address can be pasted directly where local DNS is unavailable. DNS failure, refused port, timeout, TLS failure, wrong service, not-ready state, denied code, and incompatible API are reported separately.

Synchronization is idempotent by remote employee ID. A single malformed remote profile is skipped without rolling back successful rows. Local plans, assignments, materials, appointments, and history are not deleted, and the local directory remains usable while Docomator is unavailable. See [DOCOMATOR_PEOPLE_IMPORT.md](docs/DOCOMATOR_PEOPLE_IMPORT.md).

## Installation and update

Download one release archive, its checksum, the installer wrapper, `README-INSTALL.txt`, and `SHA256SUMS` into any readable ordinary user directory, then run:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

The download directory and source archive do not need to be owned by root. The wrapper verifies the external digest and internal manifest, extracts into a private root staging directory, creates and verifies a backup, switches `/opt/kafedra-planner/current` atomically, and rolls back a failed update.

Installed executable releases remain `root:root` and non-writable by the service account. Runtime data remains owned by `kafedra-planner:kafedra-planner`; the source user directory is left unchanged. Active required UI files are compared with the selected bundle, and HTML/JavaScript/CSS use `Cache-Control: no-store` so a successful update does not leave the old interface cached.

Verify the selected release:

```bash
cat /opt/kafedra-planner/current/VERSION
readlink -f /opt/kafedra-planner/current
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

## Restart and diagnostics

```bash
sudo systemctl restart kafedra-planner-api.service kafedra-planner-worker.service
sudo systemctl status --no-pager -l kafedra-planner-api.service kafedra-planner-worker.service
sudo journalctl -u kafedra-planner-api.service -u kafedra-planner-worker.service -n 100 --no-pager
```

Restart `kafedra-planner-llama.service` separately only when the managed local LLM is enabled.

## Development and release validation

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
```

Normal pull requests use risk-based project CI. The heavy version-neutral **Release gate** runs on `main` before publication. The publisher does not repeat that test suite: it builds one offline bundle, verifies install/update/forced rollback on that exact artifact, then uploads the same archive and derived Project Control package.

See the primary engineering contracts: [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [User workflows](docs/UX_FLOWS.md), [Release candidate](docs/RELEASE_CANDIDATE.md), and [Target acceptance](docs/TARGET_ACCEPTANCE.md).
