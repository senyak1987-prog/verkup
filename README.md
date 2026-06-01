# Verkup себестоимость

Статическое приложение для GitHub Pages: забирает сделки Bitrix24 на стадии `Запустить в производство`, показывает список сделок и хранит расчеты себестоимости в репозитории.

## Что уже заложено

- импорт сделок из Bitrix24 в `public/data/deals.json`;
- расчет по позициям: материалы, сборка, расходники, подряд, фрезеровка, печать, плоттер, монтаж, косяки;
- два итога себестоимости: чистый и итоговый с учетом косяков;
- доставка и аренда не входят в себестоимость;
- для агентов целевой коэффициент себестоимости `0.58`, поэтому продажа считается как `себестоимость / 0.58`;
- сохранение расчетов в `public/data/calculations.json` через GitHub API;
- деплой на GitHub Pages;
- синхронизация Bitrix24 каждые 5 минут и ручной запуск workflow.

## GitHub Secrets

В репозитории откройте `Settings -> Secrets and variables -> Actions` и добавьте:

- `BITRIX_WEBHOOK_URL` - входящий webhook Bitrix24.
- `BITRIX_STAGE_ID` - точный ID стадии `Запустить в производство`.
- `BITRIX_CATEGORY_ID` - ID воронки, если сделка не в общей воронке.
- `BITRIX_FIELD_CLASSIFICATION` - код пользовательского поля классификации заявки.
- `BITRIX_FIELD_INSTALL_AMOUNT` - код пользовательского поля стоимости монтажа.
- `BITRIX_FIELD_START_DATE` - код пользовательского поля даты запуска.
- `BITRIX_FIELD_EXPECTED_FINISH_DATE` - код пользовательского поля предполагаемой даты завершения.

Webhook нельзя коммитить в репозиторий.

Webhook должен иметь права CRM. Если запросы `crm.deal.fields` или `crm.status.list` отвечают `401`, создайте новый входящий webhook в Bitrix24 с доступом к CRM.

## Как узнать коды полей

Локально:

```bash
BITRIX_WEBHOOK_URL="https://.../" npm run bitrix:fields
```

В выводе будут коды вида `UF_CRM_...`. Их нужно перенести в GitHub Secrets.

Для стадий:

```bash
BITRIX_WEBHOOK_URL="https://.../" npm run bitrix:stages
```

## Моментальный запуск из Bitrix24

Для почти моментальной выгрузки добавьте робота на стадии `Запустить в производство`, который отправляет webhook в GitHub `repository_dispatch`.

URL:

```text
https://api.github.com/repos/senyak1987-prog/verkup/dispatches
```

Метод: `POST`.

Headers:

```text
Accept: application/vnd.github+json
Authorization: Bearer GITHUB_TOKEN
X-GitHub-Api-Version: 2022-11-28
```

Body:

```json
{
  "event_type": "bitrix_deal_started"
}
```

`GITHUB_TOKEN` должен быть fine-grained token с доступом к репозиторию и правом `Actions: Read and write` или классический token с `repo`.

Если робот не настроен, синхронизация все равно сработает по расписанию каждые 5 минут.

## Сохранение расчетов

В правой панели приложения вставьте GitHub token с правом `Contents: Read and write` для репозитория. Токен сохраняется только в браузере пользователя и не попадает в код.

## Обновление справочников из Excel

Локально:

```bash
npm run catalogs:build
```

По умолчанию скрипт читает:

- `O:/Производство/Таблицы/Прайс сборка.xlsx`
- `O:/Производство/Таблицы/ПРАЙС ФРЕЗЕРОВКА ПЕЧАТЬ ПЛОТТЕР.xlsx`
- `C:/Users/Семен/Desktop/Прайс по материалам.xlsx`

Пути можно переопределить переменными:

- `ASSEMBLY_PRICE_PATH`
- `MILLING_PRICE_PATH`
- `MATERIALS_PRICE_PATH`

## Локальный запуск

```bash
npm install
npm run dev
```
