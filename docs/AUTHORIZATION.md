# Локальная авторизация и роли

Авторизация связывает действия с конкретным аккаунтом/сотрудником и исключает доверие к произвольному `personId`, переданному браузером.

```text
локальный аккаунт → сотрудник → роль → предметные связи + объектная ACL
```

## Роли

- `staff` — собственные поручения, отчёты, план/факт, уведомления и доступные объекты;
- `manager` — собственный контур плюс рекурсивная зона подчинённых/контролируемых обязательств;
- `admin` — управление аккаунтами и административными настройками в пределах серверных политик.

Объектная ACL применяется дополнительно к роли. Прямой URL или производная запись не расширяет доступ к исходному объекту.

## Пароли и сессии

Пароль хранится как параметризованный `scrypt`-хэш с индивидуальной солью. Сессия использует непрозрачный токен; cookie имеет `HttpOnly`, `SameSite=Lax`, ограниченный срок и `Secure` при HTTPS-конфигурации. Изменяющие browser-запросы защищены CSRF.

## Первый администратор

В штатной offline-установке публичной регистрации нет. Installer сам создаёт первого `admin`, если активного администратора ещё нет, и один раз сохраняет временные реквизиты:

```text
/root/kafedra-planner-first-login.txt
```

Файл имеет mode `0600` и создаётся только при необходимости.

Для development/source checkout доступна ручная команда:

```bash
npm run auth:create-admin -- \
  --username admin \
  --person-name 'Иванов Иван Иванович' \
  --password-file /root/kafedra-admin-password
```

На установленном target тот же CLI запускается embedded Node напрямую, без npm:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/create-admin.mjs \
  --username admin \
  --person-name 'Иванов Иван Иванович' \
  --password-file /root/kafedra-admin-password
```

## Основная конфигурация

```text
KAFEDRA_AUTH_ENABLED=true
KAFEDRA_AUTH_COOKIE_NAME=kafedra_session
KAFEDRA_AUTH_SESSION_HOURS=12
KAFEDRA_AUTH_SECURE_COOKIES=false
KAFEDRA_AUTH_TRUST_PROXY=false
KAFEDRA_AUTH_CSRF_ENABLED=true
```

При HTTPS включается `KAFEDRA_AUTH_SECURE_COOKIES=true`. Proxy headers учитываются только при явном `KAFEDRA_AUTH_TRUST_PROXY=true`.

## API

```text
GET  /api/auth/me
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/change-password

GET   /api/admin/accounts
POST  /api/admin/accounts
PATCH /api/admin/accounts/:id
POST  /api/admin/accounts/:id/reset-password
```

## Инварианты доступа

- рабочее пространство и собственный сотрудник определяются серверной сессией;
- `staff` не может читать чужой персональный контур;
- `manager` получает доступ по фактической иерархии/предметным связям, а не по клиентскому параметру;
- календарь, поиск, preview и скачивание оригинала применяют ту же объектную политику;
- роли, ACL, approve/return/delete относятся к `never-learn` и не получают learned defaults;
- значимые административные действия аудируются.

Подробно: [`OBJECT_ACCESS.md`](OBJECT_ACCESS.md). Производственная проверка: `npm run test:browser:auth` и `npm run test:browser:acl` в source checkout; на установленной системе — штатный offline doctor и целевая приёмка.

## Режим разработки без авторизации

`KAFEDRA_AUTH_ENABLED=false` допустим только для разработки/части тестов. Production full bundle создаёт и использует локальную авторизацию по умолчанию.
