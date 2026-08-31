# Делегирование и интеграционная ответственность

Финализация `C-DOCUMENT-RUNTIME-RELIABILITY-235` разделена на независимые зоны ответственности.

| Специализация | Зона ответственности | Проверяемый результат |
| --- | --- | --- |
| `kafedra-release` | Offline package cache, strict/degraded doctor, восстановление document runtime | Полный bundle не объявляет готовность без реального OCR/PDF/Office smoke; ядро остаётся доступным при частичной деградации |
| `kafedra-feature` | Docomator transport diagnostics и Unicode-safe upload | Предметные ошибки DNS/port/timeout/TLS/readiness; неизменяемый source и ASCII-only технический idempotency key |
| `kafedra-tests` | Unit, integration, Playwright desktop/mobile, GRACE final | Русские, смешанные, emoji и длинные имена; exact-head gates без missing/pending/failure/unexpected skipped |
| `kafedra-design` | Независимый UX-аудит partial success | Ошибка внешнего адаптера не блокирует календарь, задачи, план/факт и доступ к исходникам |
| Ведущая интеграция | ObservedWriteScope, PR, squash merge, post-merge CI, archive-only transition | Изменение считается завершённым только после terminal `applied` в архиве |

Границы scopes не пересекаются на уровне контрактов. Любое расширение утверждённого плана требует отдельного superseding change.
