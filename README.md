# Verkup себестоимость

Статическое приложение для GitHub Pages: забирает сделки Bitrix24 на стадии `Запустить в производство`, показывает список сделок и хранит расчеты себестоимости в репозитории.

## Что уже заложено

- импорт сделок из Bitrix24 в `public/data/deals.json`;
- расчет по позициям: материалы, сборка, расходники, подряд, фрезеровка, печать, плоттер, монтаж, косяки;
- два итога себестоимости: чистый и итоговый с учетом косяков;
- доставка и аренда не входят в себестоимость;
- для агентов целевой коэффициент себестоимости `0.58`: изготовление считается от себестоимости изделия, монтаж - от себестоимости монтажных позиций;
- сохранение расчетов в `public/data/calculations.json` через закрытый API-посредник;
- редактируемый справочник позиций в `public/data/catalogs.json` через закрытый API-посредник;
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

Для моментальной выгрузки добавьте робота на стадиях `Запустить в производство` и `В производстве`, который отправляет webhook в GitHub `repository_dispatch`. После этого сделка не будет ждать расписание 5 минут: Bitrix сразу запустит workflow `Sync Bitrix deals`.

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

`GITHUB_TOKEN` для робота Bitrix должен быть fine-grained token с доступом к репозиторию и правом `Contents: Read and write` или классический token с `repo`. Этот token нужен только в настройках робота Bitrix и не вводится на сайте.

Если робот не настроен, синхронизация все равно сработает по расписанию каждые 5 минут. Сайт периодически перечитывает опубликованный `deals.json`, поэтому откат сделки в Bitrix24 подтянется в открытую страницу после завершения GitHub Actions.

## API сохранения без GitHub token на сайте

Чтобы сайт мог сохранять расчеты и справочник без GitHub token в браузере, используется Cloudflare Worker из папки:

```text
worker/
```

GitHub token хранится в секретах Worker и не попадает в интерфейс. На сайте ничего дополнительно вводить не нужно.

Для Worker нужен один секрет:

- `GITHUB_TOKEN` - fine-grained token GitHub для репозитория `senyak1987-prog/verkup` с правами `Contents: Read and write` и `Actions: Read and write`.

Деплой Worker:

```bash
cd worker
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

После деплоя Worker выдаст адрес вида:

```text
https://verkup-save-api.<ваш-аккаунт>.workers.dev
```

Добавьте этот адрес в GitHub: `Settings -> Secrets and variables -> Actions -> Variables -> New repository variable`.

```text
VITE_SAVE_API_URL = https://verkup-save-api.<ваш-аккаунт>.workers.dev
```

После следующего деплоя поле адреса API исчезнет с сайта, а сохранение будет работать без дополнительных полей.

Если приложение будет размещено не на GitHub Pages, а на вашем домене, добавьте этот домен в `ALLOWED_ORIGIN` в `worker/wrangler.toml`, например `https://ваш-сайт.ru`.

## Сохранение расчетов

Если `VITE_SAVE_API_URL` задан в GitHub Variables, расчет сохраняется кнопкой `Сохранить расчет` без дополнительных полей. Если переменная еще не задана, временно вставьте адрес Worker в поле `Адрес API сохранения`.

Кнопки `Перевести в производство` и `Откатить в запуск` сохраняют расчет в GitHub, запускают workflow `Move Bitrix deal stage`, меняют стадию сделки в Bitrix24 и затем обновляют `public/data/deals.json`. На сайте сделка сразу переносится в нужную вкладку, а синхронизация из Bitrix24 подтверждает состояние после завершения GitHub Actions.

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

После изменений нажмите `Сохранить справочник`. Если `VITE_SAVE_API_URL` задан, справочник сохраняется без дополнительных полей.

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

## Перенос на свой сервер или существующий сайт

Приложение собирается как обычная статическая папка:

```bash
npm run build
```

Готовые файлы будут в `dist/`. Их можно загрузить на любой сервер.

Текущая настройка рассчитана на размещение в подпапке `/verkup/`. Поэтому самый простой вариант интеграции в существующий сайт - загрузить содержимое `dist/` в раздел:

```text
https://ваш-сайт.ru/verkup/
```

Если нужно поставить приложение в корень сайта или в другую папку, задайте базовый путь перед сборкой:

```bash
VITE_BASE_PATH=/ npm run build
```

или для подпапки:

```bash
VITE_BASE_PATH=/crm/verkup/ npm run build
```

В GitHub Actions это можно сделать через repository variable `VITE_BASE_PATH`.

Для быстрого встраивания в существующую страницу можно использовать iframe:

```html
<iframe src="https://senyak1987-prog.github.io/verkup/" style="width:100%;height:100vh;border:0"></iframe>
```

Для полноценной интеграции лучше держать приложение отдельным разделом сайта, потому что ему нужны свои таблицы, правая панель расчета и модальное окно справочника.
