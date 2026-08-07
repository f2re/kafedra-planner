# Целевая эксплуатационная приёмка Astra Linux / Debian

Этот документ дополняет issue #27. Автоматический Ubuntu CI не закрывает целевую приёмку. Приёмка выполняется на реальной машине тем же автономным release-архивом, который прошёл CI.

## Что автоматизирует акт

`node scripts/target-acceptance.mjs capture` создаёт JSON-доказательство состояния установки без содержимого документов и без секретов конфигурации.

В акт входят:

- версия приложения и фактический `process.execPath`;
- Node version, platform, arch и доступные сведения glibc;
- `/etc/os-release`, `uname`, `ldd` embedded Node;
- system preflight;
- версии `pdftotext`, `pdftoppm`, Tesseract и LibreOffice;
- `PRAGMA quick_check` и текущая версия схемы;
- счётчики устойчивых предметных таблиц;
- полная проверка каждого `file_blobs`: существование, размер, SHA-256;
- агрегированный digest immutable blob-набора;
- состояние API/worker и ключевые systemd hardening properties;
- наличие и безопасные метаданные последней проверенной backup-копии.

В акт не записываются SMTP password, Telegram token, пароли пользователей, cookie/session tokens, содержимое документов или полный env-файл.

## Первый снимок

После установки и загрузки контрольного реалистичного набора данных:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-acceptance-before.json
```

`--require-full` делает отсутствие OCR (`pdftoppm` + Tesseract) или LibreOffice блокирующим для акта. Это жёстче обычной установки, где эти возможности могут быть отключены.

Статус `pass`/`pass_with_warnings` не заменяет пользовательскую проверку реальных PDF/DOCX/XLSX/сканов; он подтверждает платформенную целостность.

## Контрольный сценарий #27

1. Проверить внешний SHA-256 автономного архива и embedded runtime.
2. Установить release штатным `install.sh`.
3. Создать первого администратора и выполнить вход.
4. Загрузить реалистичный набор: текстовый PDF, PDF-скан, DOCX, XLSX, распоряжение, отчёт, научный материал и план.
5. Проверить OCR, LibreOffice preview, календарь, поиск, evidence и персональные права.
6. Снять `kafedra-acceptance-before.json`.
7. Создать зашифрованную backup-копию и выполнить её штатный verify.
8. Разрушить тестовую установку согласно плану испытания или восстановить копию на чистом контрольном узле.
9. После restore запустить API/worker и снять второй акт `kafedra-acceptance-after.json`.
10. Сравнить два акта.
11. Отдельно искусственно сорвать обновление и подтвердить автоматический rollback.
12. Зафиксировать RTO, замечания оператора и итоговые контрольные суммы.

## Снимок после восстановления

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-acceptance-after.json
```

## Машинное сравнение

```bash
/opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs compare \
  /root/kafedra-acceptance-before.json \
  /root/kafedra-acceptance-after.json \
  --output /root/kafedra-acceptance-compare.json
```

Для успешного сравнения должны совпасть:

- версия приложения;
- версия схемы;
- счётчики устойчивых предметных таблиц;
- количество и общий размер blobs;
- агрегированный digest, который включает ожидаемый и фактический SHA-256/размер каждого immutable blob.

Транзитные таблицы (`jobs`, sessions, audit, notification delivery и т.п.) остаются в акте информационно, но намеренно не являются критерием равенства: после перезапуска и входа их счётчики закономерно меняются.

## Что считается отказом

Акт получает `fail`, если:

- отсутствует обязательная системная команда;
- в `--require-full` нет OCR или LibreOffice;
- `PRAGMA quick_check` не `ok`;
- отсутствует blob из `file_blobs`;
- размер или SHA-256 blob не совпадает;
- API/worker недоступны через systemd;
- ключевые параметры hardening systemd отличаются от ожидаемых.

Команда `compare` возвращает ненулевой код, если устойчивый снимок до/после отличается.

## Что остаётся ручным доказательством

Автоматизировать без потери смысла нельзя:

- визуальную корректность реального предпросмотра LibreOffice;
- качество OCR конкретных ведомственных сканов;
- понятность интерфейса оператору без инструкции;
- реальное время восстановления и организационный RTO;
- факт автоматического rollback при специально сорванном обновлении;
- совместимость embedded Node и системных библиотек конкретной редакции Astra за пределами фактически проверенной машины.

Именно поэтому #27 закрывается только после фактического испытания, а не после появления этого скрипта.