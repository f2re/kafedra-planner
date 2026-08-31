# Design brief — document runtime reliability

Change: `C-DOCUMENT-RUNTIME-RELIABILITY-235`  
Issue: `#235`  
Base: `e5367b5423a9b14b1b81c8083ff1e96aee793f03`

## User outcome

The repair is mostly infrastructural. The visible contract is deliberately narrow:

- uploading a supported file works for any normal Unicode file name without presenting a transport setting;
- a Docomator check says what failed and what the administrator should correct;
- a full offline installer either completes with working document processing or stops and keeps the previous working release.

No new confirmation screen, import acceptance step or technical diagnostics panel is introduced.

## Docomator card

The existing structure-page card remains the stable container. Its geometry is not rearranged by prior use or error frequency.

Primary order:

1. protocol;
2. host;
3. port;
4. optional four-digit access code;
5. `Проверить соединение`;
6. one inline status region;
7. space, group, people preview and import action only after successful data access.

The default port remains `8080`. An explicitly entered port is never silently replaced. The access code remains in the current form only; it is not echoed into the status text, endpoint label, persisted settings or logs.

### Failure copy

Messages are concise, operational and contain one correction:

- DNS: `Сервер Оформлятора не найден. Проверьте имя хоста или укажите IP-адрес.`
- refused: `Сервер найден, но соединение с указанным портом отклонено. Проверьте порт и запуск Оформлятора.`
- timeout: `Оформлятор не ответил вовремя. Проверьте сеть и состояние сервера.`
- TLS: `Не удалось установить защищённое соединение. Проверьте HTTPS и сертификат Оформлятора.`
- wrong service: `По этому адресу отвечает другой или несовместимый сервис. Проверьте адрес Оформлятора.`
- not ready: `Оформлятор запущен, но ещё не готов к чтению данных. Повторите проверку после запуска базы.`
- denied: `Код доступа Оформлятора не подошёл.`

The UI uses the safe server message as plain text. It does not expose a stack trace, Node error code, raw URL, cookie, response body or request identifier as the main message. An unknown server failure remains `Внутренняя ошибка сервера.`

### State and focus

On failure:

- protocol, host, port and the current access-code input remain unchanged;
- the source picker is hidden because no fresh remote data is authoritative;
- focus is not stolen by the status region or moved into a modal;
- the status region is reachable by assistive technology through its existing status semantics;
- the check button returns from busy to enabled;
- submitting again is the direct retry.

On success, the existing automatic selection of a sole space is retained. This safe default must not overwrite an explicit current selection.

## Upload behavior

Transport normalization has no visual control. The user continues to select or drop a file and sees the existing progress/result UI. The original file name, including Cyrillic or emoji, remains visible wherever the source is shown.

An internal canonical idempotency value must never replace the display name, document title or evidence locator. Duplicate suppression remains deterministic for the same caller input.

## Full offline installation

The terminal is the interface. The strict full profile uses three clear phases:

1. target and package-payload verification;
2. missing package installation and real document smoke checks;
3. application transaction and activation.

A document-runtime failure occurs before application staging and is reported as a blocking full-profile error. The message states that the current release and data were not replaced and names the repair command only when a verified retained payload is available.

The word `готов` is reserved for a strict successful result. The full installer must not report a degraded installation as complete. Runtime-only/development operation can continue to describe optional capabilities separately.

## Responsive behavior

### Desktop

The Docomator address row may use its current grid. The status spans the card width, wraps without horizontal scrolling and does not cover neighboring structure panels.

### Mobile

Fields stack in semantic order. The check action remains a full-width or easily reachable control. Long host names and messages wrap inside the card. No popover, hover dependency or off-screen action is introduced.

At both sizes, the state hierarchy remains: form first, inline result second, remote-source controls third.

## Control classification

- protocol: `never-learn` because transport is an explicit connection fact;
- host: `never-learn` because it is explicit free text;
- port: `never-learn` because it is an explicit connection fact;
- access code: `never-learn` because it is a credential;
- check and import actions: `never-learn`;
- sole-space selection: `domain-derived` safe default only when no explicit current choice exists;
- status copy and badge: `domain-derived` from the current request result;
- upload idempotency identity: internal deterministic transport state, never a learned preference.

Priority is preserved fact, explicit current choice, domain-derived value, safe default, static fallback.

## Accessibility and safety

- errors are not represented by color alone;
- plain text remains selectable and readable at zoom;
- retry does not require dismissal;
- keyboard submission remains available;
- no destructive action or credential is auto-filled from usage statistics;
- no implementation depends on animation for status, focus or progress meaning.
