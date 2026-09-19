# Kafedra Planner

[Русский](README.md) · [English](README.en.md)

[![CI](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml)
[![Release](https://github.com/f2re/kafedra-planner/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/f2re/kafedra-planner?display_name=tag&sort=semver)](https://github.com/f2re/kafedra-planner/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Kafedra Planner is an offline-first daily work system for an academic department: calendar, annual plans, assignments, documents, meetings, reporting, research activity, grade sheets, and auditable evidence.

> Current milestone: **`0.4.7`**, SQLite schema **31**. Core workflows do not require Internet access, Docker, an LLM, Docomator, or cloud services. The project remains a release candidate until the real Astra Linux/Debian installation, upgrade, restoration, and rollback acceptance in [TARGET_ACCEPTANCE.md](docs/TARGET_ACCEPTANCE.md) and issue #27 is complete.

Patch release `0.4.7` adds topical retrieval, bounded spelling fallback, related queries and optional background assistance from a configured local LLM. Query expansion can find actual sources outside the initial result; quotations and access are checked while ordinary search remains independent of generation. Automatic filling of official reports is not included. Separate Debian 12, Astra Linux 1.7 and 1.8 bundles with their OS-specific OCR/PDF/Office dependencies from `0.4.6` are retained.

**[Download an offline bundle](https://github.com/f2re/kafedra-planner/releases)** · **[Install guide](docs/GITHUB_RELEASES.md)** · **[Security policy](SECURITY.md)** · **[Russian documentation](README.md#эксплуатация-и-документация)**

Published releases are not overwritten. The R1–R9 automation cycle is delivered in `v0.4.4`, protocol import improvements in `v0.4.5`, separate Astra bundles in `v0.4.6`, and topical search and background material selection in `v0.4.7`.

## Operating model

An uploaded file is never replaced by recognised text or an AI result. Every extracted fact retains its source and locator; manual corrections retain their reason and history. A failing document, row, optional converter, Docomator endpoint, or LLM must not block unrelated data or the core daily workflow.

Main areas include calendar, immutable documents, imported and manual plans, direct task completion, plan/fact reporting, meetings and versioned DOCX templates, research records, academic grade sheets, PIN access, object ACL, backup/restore, and optional local `llama.cpp` assistance.

## Finding related materials

Search accepts conversational Russian topic queries, uses the existing FTS index and retains explicit filters. When enabled, the LLM proposes bounded query variants, which are executed against actual authorized records, then selects verifiable excerpts. Additional results do not reorder the ordinary list. Their original work objects open through existing routes with return to the search context.

This is query expansion, not vector search. It does not assert completion, publication or approval. See [SEMANTIC_SEARCH.md](docs/SEMANTIC_SEARCH.md) and [SEARCH_LLM_PROMPTS.md](docs/SEARCH_LLM_PROMPTS.md).

## Annual meeting protocols

Open **Meetings**, select a calendar year and choose multiple DOCX, ODT, PDF, or TXT protocols at once. Each file is persisted as an immutable document version before interpretation. Safe facts materialise immediately; a bad or ambiguous file does not roll back the others.

The annual summary is reconstructed from durable document, extraction, meeting, and review state after reload. A questionable protocol number, date, agenda item, decision, responsible person, or due date opens the exact meeting and original source for correction. Manual changes update working meeting/decision/calendar/search projections but keep the machine result, source locator, blob, and SHA-256 intact.

See [MEETINGS.md](docs/MEETINGS.md) and [PROTOCOL_IMPORT.md](docs/PROTOCOL_IMPORT.md).

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

Download the archive for your OS, its checksum, the installer wrapper and `README-INSTALL.txt` from one release into an ordinary readable user directory, then run:

```bash
sudo KAFEDRA_APT_MODE=bundle bash ./install-kafedra-planner.sh
```

When several archives are present, the wrapper selects exactly one matching OS profile and architecture from embedded metadata. A missing or ambiguous match stops installation before system changes; a Debian archive is not used as an Astra fallback.

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

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
```

Ordinary pull requests run the complete locked install, check, documentation consistency, unit/integration tests, and smoke once. A merged `main` commit runs only the post-merge smoke. Targeted Playwright is used for the UI scenario being changed. Full browser, backup/restore, and offline systemd install/update/rollback verification run only for the corresponding risk or an explicit `Release` workflow.

The primary engineering contracts are [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [User workflows](docs/UX_FLOWS.md), [Release candidate](docs/RELEASE_CANDIDATE.md), and [Target acceptance](docs/TARGET_ACCEPTANCE.md).
