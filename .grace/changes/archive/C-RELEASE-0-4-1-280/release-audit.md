# Release audit — 0.4.1

- Управляющий issue: #280.
- Источник: чистый `main` после terminal archive всех включённых изменений и удаления connector probe `dummy`.
- Включены только завершённые контуры: Unicode-safe document intake; строгая OCR/offline-проверка и repair package cache; классифицированные ошибки Оформлятора; детерминированные календарные fixtures; desktop `Текущие | Архив` для планов.
- Не включены: issue #254, mobile-only navigation, новая SQLite migration, обязательный Интернет/LLM/cloud, stable Astra acceptance.
- SQLite schema: 31.
- Перед merge обязательны GRACE final, полный exact-head CI, release/database/browser/organization/science, full offline Debian/systemd/LLM и Project Control.
- После merge обязательны post-merge CI, публикация `v0.4.1`, проверка exact tag SHA и семи assets, затем отдельный archive-only transition `applied`.
