# Kafedra Planner

[Русский](README.md) · [English](README.en.md)

[![CI](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml)
[![Release gate](https://github.com/f2re/kafedra-planner/actions/workflows/release-gate.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/release-gate.yml)
[![GitHub Release](https://img.shields.io/github/v/release/f2re/kafedra-planner?display_name=tag&sort=semver)](https://github.com/f2re/kafedra-planner/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Kafedra Planner is an offline-first daily work system for an academic department: calendar, annual plans, assignments, documents, meetings, reporting, research activity, and auditable evidence.

> Current milestone: **`0.3.3`**, SQLite schema **28**. Core workflows do not require Internet access, an LLM, Docker, Docomator, or cloud services. The project remains a release candidate until the real Astra Linux/Debian installation, upgrade, restoration, and rollback acceptance in [TARGET_ACCEPTANCE.md](docs/TARGET_ACCEPTANCE.md) and issue #27 is complete.

**[Download an offline bundle](https://github.com/f2re/kafedra-planner/releases)** · **[Install guide](docs/GITHUB_RELEASES.md)** · **[Security policy](SECURITY.md)** · **[Contributing](CONTRIBUTING.md)**

## Why it exists

An uploaded PDF/DOCX/ODT/XLSX/ODS file or scan is never replaced by recognised text or an AI result. Every extracted fact retains its source and locator; manual corrections keep their reason and history.

```text
source document / manual entry
              ↓
          domain record
              ↓
calendar · assignment · search · report
              ↓
confirmation, history, and evidence
```

A failing file, adapter, OCR component, optional converter, or integration must not block other documents or the core daily workflow.

## Main capabilities

- Calendar, recurring tasks, deadlines, reminders, and provenance;
- immutable documents, version history, deduplication, local OCR/preview, and full-text search;
- imported and manual annual plans linked to assignments, evidence, and plan/fact reporting;
- deterministic automatic assignment when an imported responsible person matches exactly one active employee; ambiguous names stay unresolved for operator review;
- assignment execution, reports, manager confirmation or return for revision;
- meetings, agenda, minutes, extracts, research registry, and science reports;
- optional local-network employee import from Docomator with health/readiness/data checks, space/group selection, and idempotent remote employee mapping;
- local four-digit PIN onboarding, sessions, roles, object ACL, and audit trail;
- encrypted backup/restore plus atomic update and rollback;
- optional local `llama.cpp` enhancement; core deterministic workflows work with LLM disabled.

![Department calendar](docs/screenshots/calendar.webp)

![Annual plan](docs/screenshots/annual-plan.webp)

## Docomator employee import

An administrator can open **Settings → Department structure → Import from Docomator**, enter an HTTP/HTTPS host and port, and verify `/healthz`, `/readyz`, and application data access before importing. A four-digit Docomator access code, when required, is used only for the current request and is not stored.

The user selects a space, a group or all employees, previews names, and starts the import. Remote employee IDs provide idempotency; the first sync may match an existing local record by normalized name. Repeated synchronization updates the linked person without deleting local plans, tasks, reports, appointments, or history. See [DOCOMATOR_PEOPLE_IMPORT.md](docs/DOCOMATOR_PEOPLE_IMPORT.md).

## Install

Download the required files from the selected [GitHub Release](https://github.com/f2re/kafedra-planner/releases), keep them in one directory, verify the checksum, and run:

```bash
sha256sum -c --strict kafedra-planner-*.tar.gz.sha256
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

The installer verifies the archive and manifest, runs migrations, creates a verified pre-update backup, and rolls back an unsuccessful update. At the first open, the user sets a four-digit PIN. See the detailed [release guide](docs/GITHUB_RELEASES.md), [offline install contract](docs/OFFLINE_INSTALL.md), and [backup/restore procedure](docs/BACKUP_RESTORE.md).

For another architecture or OS series, build a bundle on a compatible Debian/Astra reference machine instead:

```bash
npm run bundle:offline
```

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run smoke
```

The full list of browser, release, and deployment checks is in the Russian [README](README.md#разработка-и-проверка). The project is intentionally Russian-first; help translating user-facing documentation or the interface is welcome through an issue or pull request.

## Documentation and policies

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [User workflows](docs/UX_FLOWS.md)
- [Docomator employee import](docs/DOCOMATOR_PEOPLE_IMPORT.md)
- [Authorization and object access](docs/AUTHORIZATION.md)
- [Release candidate and release gates](docs/RELEASE_CANDIDATE.md)
- [Target acceptance](docs/TARGET_ACCEPTANCE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [MIT License](LICENSE)
