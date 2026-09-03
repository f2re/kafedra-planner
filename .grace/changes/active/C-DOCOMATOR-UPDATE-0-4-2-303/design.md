# Design contract — C-DOCOMATOR-UPDATE-0-4-2-303

## User path

`Настройки → Структура кафедры → Импорт из Оформлятора → вставить адрес → Подключить → выбрать пространство/группу → Импортировать сотрудников`.

The integration is optional. A connection or import error never hides, disables or replaces the local department directory. The browser talks only to Kafedra Planner; Planner performs the Docomator requests server-side, so the flow does not depend on CORS or browser DNS.

## Entry and hierarchy

The existing **Источник сотрудников** card remains in the organization administrator screen. Its geometry does not depend on usage statistics or connection history.

The first row contains exactly:

1. one text control labelled **Адрес Оформлятора**;
2. one optional password control labelled **Код доступа**;
3. the primary step button **Подключить** immediately below them.

The address helper says that an administrator may paste an address copied from the browser and may leave a known `/api/v1`, `/healthz` or `/readyz` suffix. The example is `http://192.168.1.50:8080`. Protocol and port are not separate controls.

The four-digit code is optional, used only in the current request and never returned by the API or restored into the form. The form contains no modal, wizard or confirmation screen.

## Supported input and feedback

Accepted user input includes a full HTTP/HTTPS URL, a DNS name, IPv4 and bracketed or plain IPv6. A bare endpoint receives the safe legacy default `http` and port `8080`. A full URL without a port uses its protocol default. The server returns and displays the canonical endpoint after normalization.

Known copied Docomator API and health paths are reduced to the service origin. Credentials, query strings, fragments, unsupported schemes and unrelated paths are rejected before a network request.

Connection states are persistent in the same card:

- **Не проверено** — initial state;
- **Проверяю…** — controls are disabled only for the current request;
- **Доступен** — source selectors become available;
- **Доступен · нужен код** — address stays in place, focus can move to the code field;
- **Ошибка** — a classified DNS, port/refused, timeout, TLS, wrong-service, not-ready or version/protocol explanation is shown next to the form;
- **Источник пуст** — selectors remain understandable and import is disabled;
- **Импорт завершён** — totals for created, updated, matched and skipped rows are shown;
- **Повторный импорт** — the same remote identifiers update or match existing people instead of creating duplicates.

A remote failure hides stale remote preview and disables only the remote import action. Existing local people, plans, tasks and documents remain visible and editable.

## Source selection

When exactly one active space exists, it is selected automatically and immediately rechecked. Group selection defaults to **Все сотрудники пространства**. Changing space, group or **Включить неактивных** refreshes the preview without a confirmation step.

Space and group are `domain-derived` or an explicit current choice. They are never changed from usage statistics. Address, access code, connection and import are `never-learn`. No programmatic selection is counted as a learned user choice.

## Desktop and mobile

At desktop widths the address occupies the flexible majority of the two-column connection grid and the short code field stays beside it. Source selectors use the existing horizontal grid.

At narrow widths every field and action becomes one full-width column in document order. Labels remain above controls, the status text wraps, and the import button remains after count and last-import information. No controls are removed on mobile.

All interactive targets retain at least the project standard 44 px hit area. The full address can wrap in the displayed endpoint without changing card width.

## Accessibility and safety

- Native labelled inputs, select controls and buttons are used.
- The address uses `inputmode=url`, `autocomplete=off` and spellcheck disabled, but remains `type=text` so a bare host is valid.
- The access code uses `type=password`, numeric input mode, four-digit pattern and no persistence.
- Status feedback uses the existing live status region and never relies on color alone.
- Focus is not moved unexpectedly after background source refresh.
- Import stays disabled until a successful data-capable connection and selected space exist.
- User-provided values are escaped before insertion into option or preview markup.

## Acceptance boundary

This change does not add background synchronization, reverse-proxy subpath support, deletion propagation, direct Docomator database access or any dependency on Internet, cloud services or LLMs.
