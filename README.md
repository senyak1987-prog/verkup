# Verkup себестоимость

Статическое приложение для GitHub Pages: забирает сделки Bitrix24 на стадии `Запустить в производство`, показывает список сделок и хранит расчеты себестоимости в репозитории.

## Что уже заложено

- импорт сделок из Bitrix24 в `public/data/deals.json`;
- расчет по позициям: материалы, сборка, расходники, подряд, фрезеровка, печать, плоттер, монтаж, косяки;
- два итога себестоимости: чистый и итоговый с учетом косяков;
- доставка и аренда не входят в себестоимость;
- для агентов целевой коэффициент себестоимости `0.58`: изготовление считается от себестоимости изделия, монтаж - от себестоимости монтажных позиций;
- сохранение расчетов в `public/data/calculations.json` через GitHub API;
- редактируемый справочник позиций в `public/data/catalogs.json` через GitHub API;
- деплой на GitHub Pages;
- синхронизация Bitrix24 каждые 5 минут и ручной запуск workflow.

## GitHub Secrets

В репозитории откройте `Settings -> Secrets and variables -> Actions` и добавьте:

- `BITRIX_WEBHOOK_URL` - входящий webhook Bitrix24.
- `BITRIX_STAGE_ID` - точный ID стадии `Запустить в производство`.
- `BITRIX_PRODUCTION_STAGE_ID` - точный ID стадии `В производстве`.
- `BITRIX_CATEGORY_ID` - ID воронки, если сделка не в общей воронке.
- `BITRIX_FIELD_CLASSIFICATION` - код пользовательского поля классификации заявки.
- `BITRIX_FIELD_INSTALL_AMOUNT` - код пользовательского поля стоимости монтажа.
- `BITRIX_FIELD_START_DATE` - код пользовательского поля даты запуска.
- `BITRIX_FIELD_EXPECTED_FINISH_DATE` - код пользовательского поля предполагаемой даты завершения.

Webhook нельзя коммитить в репозиторий.

Webhook должен иметь права CRM. Если запросы `crm.deal.fields` или `crm.status.list` отвечают `401`, создайте новый входящий webhook в Bitrix24 с доступом к CRM.

## Как узнать коды полей

Через GitHub Actions:

1. Добавьте `BITRIX_WEBHOOK_URL` в `Settings -> Secrets and variables -> Actions`.
2. Откройте `Actions -> Inspect Bitrix metadata`.
3. Нажмите `Run workflow`.
4. В логах шага `Print deal fields` будут коды `UF_CRM_...`, типы и названия полей.

Локально:

```bash
BITRIX_WEBHOOK_URL="https://.../" npm run bitrix:fields
```

В выводе будут коды вида `UF_CRM_...`. Их нужно перенести в GitHub Secrets.

Для стадий:

```bash
BITRIX_WEBHOOK_URL="https://.../" npm run bitrix:stages
```

Для текущего портала Verkup уже определены основные значения:

- `BITRIX_STAGE_ID` = `4` (`Запустить в Производство`)
- `BITRIX_PRODUCTION_STAGE_ID` = `10` (`В ПРОИЗВОДСТВЕ`)
- `BITRIX_FIELD_CLASSIFICATION` = `UF_CRM_6512B7A78D965`
- `BITRIX_FIELD_INSTALL_AMOUNT` = `UF_CRM_1547662428256`

Дата запуска и предполагаемая дата завершения сейчас берутся из стандартных полей Bitrix24 `BEGINDATE` и `CLOSEDATE`. Если позже появятся отдельные производственные даты, их можно подключить через `BITRIX_FIELD_START_DATE` и `BITRIX_FIELD_EXPECTED_FINISH_DATE`.

## Моментальный запуск из Bitrix24

Для моментальной выгрузки добавьте робота на стадии `Запустить в производство`, который отправляет webhook в GitHub `repository_dispatch`. После этого сделка не будет ждать расписание 5 минут: Bitrix сразу запустит workflow `Sync Bitrix deals`.

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
  "event_type": "bitrix_deal_stage_changed",
  "client_payload": {
    "deal_id": "{{ID}}"
  }
}
```

`{{ID}}` - ID сделки в роботе Bitrix24. Если Bitrix не подставляет это выражение в вашем шаблоне робота, можно убрать `client_payload` полностью:

```json
{
  "event_type": "bitrix_deal_stage_changed"
}
```

`GITHUB_TOKEN` должен быть fine-grained token с доступом к репозиторию и правом `Actions: Read and write` или классический token с `repo`.

Если робот не настроен, синхронизация все равно сработает по расписанию каждые 5 минут.

## Сохранение расчетов

В правой панели приложения вставьте GitHub token с правами `Contents: Read and write` и `Actions: Read and write` для репозитория. Токен сохраняется только в браузере пользователя и не попадает в код.

Кнопка `Перевести в производство` доступна после добавления хотя бы одной позиции себестоимости. Она сохраняет расчет в GitHub, запускает workflow `Move Bitrix deal stage`, переводит сделку в Bitrix24 на стадию `В производстве` и затем обновляет `public/data/deals.json`.

Для агентских сделок приложение показывает продажу отдельно по изготовлению и монтажу:

- изготовление = себестоимость всех позиций, кроме `Монтаж` и `Косяки`, деленная на `0.58`;
- монтаж = себестоимость позиций `Монтаж`, деленная на `0.58`;
- косяки добавляются в себестоимость и уменьшают прибыль, но не увеличивают продажу.

## Редактирование справочника

Основной справочник хранится в репозитории:

```text
public/data/catalogs.json
```

В верхней панели приложения нажмите `Справочник`. В редакторе можно выбрать позицию из списка, изменить раздел, название, единицу, цену и источник, добавить новую позицию или удалить существующую.

После изменений нажмите `Сохранить справочник в GitHub`. Используется тот же GitHub token с правом `Contents: Read and write`.

Поле `Источник` - это справочная подпись, откуда позиция была импортирована или кем добавлена. Оно не создает живую связь с Excel-файлом. Если в исходном прайсе появятся новые строки, на сайт они попадут только после повторного импорта и сохранения `public/data/catalogs.json` в GitHub.

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
