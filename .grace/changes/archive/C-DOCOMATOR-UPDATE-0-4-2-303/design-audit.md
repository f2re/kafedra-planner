# Independent design audit — C-DOCOMATOR-UPDATE-0-4-2-303

## Scope

Audit of the implemented administrator flow in **Настройки → Структура кафедры → Импорт из Оформлятора** at desktop and mobile widths. The review covers hierarchy, labels, focus, target size, endpoint normalization feedback, access-code handling, connection errors, empty source, field mapping, partial import, repeated import, local-directory continuity and the intentional no-motion contract.

## Results

### PASS — one copied address is the primary input

The former protocol/host/port cluster is replaced by one native text field labelled **Адрес Оформлятора**, one optional four-digit password field and one action **Подключить**. The helper explicitly accepts an address copied from a browser, including known `/api/v1`, `/healthz` and `/readyz` suffixes. The canonical endpoint is shown after server normalization. No modal, confirmation page or API-version field is required.

### PASS — stable desktop and mobile hierarchy

The card remains in the existing department-structure screen. Desktop uses a flexible address column plus the short code field; narrow layouts preserve the same document order as full-width controls. Source, field mapping, preview and import follow the connection action. No control moves according to usage statistics, and no mobile-only semantic path is introduced.

### PASS — secrets and adaptive-control policy

The endpoint, access code, connection and import actions are `never-learn`. The code uses a password control, is sent only with the current check/import request and is not returned by the settings API or restored after reload. Space/group values come from the remote domain or an explicit current selection; programmatic one-space selection does not train a preference.

### PASS — error and recovery behavior

DNS failure, refused port, timeout, TLS failure, wrong service, not-ready state, access denial and incompatible protocol are rendered as local status text beside the connection controls. A failed remote request hides stale remote preview and disables only remote import. Existing local employees and the rest of Kafedra Planner remain usable. Retrying does not require re-entering a valid address already present in the form.

### PASS — source, fields and partial success

A successful connection exposes space/group selectors, employee count and escaped name preview. Optional remote field mapping remains secondary disclosure; FIO is always imported. Mapping is persisted before the import request, including when the initial settings request completes late. Repeated synchronization updates the same remote employee link. Per-person failures are counted as skipped and do not roll back successful rows.

### PASS — accessibility and focus

Inputs and selects retain visible labels; buttons are native and remain at least the project 44 px target. The status region is announced without relying on color. The full endpoint wraps rather than widening the card. Background source refresh does not steal focus. Import remains unavailable until the server reports data access and a space is selected.

### PASS — no-motion and reduced motion

The flow is understandable through immediate static states. No animation, bounce, slide, delayed feedback or decorative transition was added. Under `prefers-reduced-motion: reduce`, computed animation and transition durations remain zero while requests, focus and actions behave identically.

### PASS — update continuity

The installed active release is verified against the selected bundle's required UI files. Static HTML, JavaScript and CSS are served with `Cache-Control: no-store`, preventing an old non-fingerprinted interface from surviving a successful release switch. The source archive may remain in a user-owned folder; only private staging and installed system paths require root ownership.

## Blockers

None found within the approved scope after the field-mapping/import ordering correction. Browser regression remains the executable acceptance evidence and must pass on the exact PR head before merge.
