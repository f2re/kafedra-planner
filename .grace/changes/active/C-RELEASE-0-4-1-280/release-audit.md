# Release audit — 0.4.1

- Управляющий issue: #280.
- Exact release base: `f6ec17cd88ab2ec5aaea7548da871fb5588b30a4`, tree `640ef4e9ac76c296ff0f035a7e8528a2e96d81c7`.
- Включены только завершённые контуры текущего `main`: Unicode-safe document intake; строгая OCR/offline-проверка и repair package cache; классифицированные ошибки Оформлятора; детерминированные календарные fixtures; desktop `Текущие | Архив` для планов.
- Не включены: issue #254, mobile-only navigation, новая SQLite migration, обязательный Интернет/LLM/cloud и объявление stable Astra acceptance.
- SQLite schema остаётся `31`; применённые migrations, immutable blobs, SHA-256, `document_version`, source rows и evidence не изменяются.
- Прежняя блокировка была вызвана не продуктом, а попыткой стандартного `GITHUB_TOKEN` изменить `.github/workflows/*`. Итоговый commit формируется атомарно GitHub write connector с `workflows:write`; обход или ослабление проверок данных не применяется.
- Одноразовый `apply-release-0.4.1.yml` удаляется. Активный publisher слушает только `Release gate 0.4.1`; строка `0.4.0` сохраняется исключительно как комментированный compatibility marker для исторической regression-проверки.
- Перед merge обязательны GRACE final и полный exact-head CI: database, Node 24/25, browser, release, organization, science, full offline Debian/systemd/LLM и Project Control.
- После merge обязательны post-merge CI, публикация `v0.4.1`, exact tag SHA и ровно семь digest-verified assets, затем отдельный archive-only transition `applied`.
