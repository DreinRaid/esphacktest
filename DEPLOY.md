# Как залить вики на свой GitHub (кратко)

Подойдёт аккаунт **Teapot174** или любой другой.

## 1. Репозиторий

- Создай **новый** репозиторий (например `esp-hack-wiki`) **без** README, или сделай **Fork** этой копии сайта.
- В корень репозитория положи **содержимое** папки сайта (`index.html`, `css/`, `data/`, `en/`, `.github/` и т.д.) — не вложенную папку `site`, а файлы как в корне проекта.

## 2. GitHub Pages

- Репозиторий → **Settings** → **Pages**.
- **Build and deployment** → **Source: GitHub Actions** (не «Deploy from branch»).
- Закоммить и запушь в ветку **`main`** или **`master`** — сработает workflow **Deploy Pages** из `.github/workflows/pages.yml`.
- Если это **fork**: в **Actions** разреши workflows для форка (подсказка GitHub на жёлтой плашке).
- Сайт откроется по адресу вида `https://Teapot174.github.io/ИМЯ-РЕПО/` (или свой домен, если настроишь).

## 3. Настройка под свой репо вики

Открой **`data/github-release.json`** и выставь:

- **`owner`** и **`repo`** — **тот репозиторий**, где лежит эта вики (например `Teapot174` и `esp-hack-wiki`). Так админка (если включишь) и пути к данным согласованы с репо.
- Блок **`downloadOwner` / `downloadRepo` / `downloadReleasesPageUrl`** и **`releasesPageUrl`** можно оставить как есть, если прошивки и changelog по-прежнему с **Teapot174/ESP-HACK**.

Сохрани изменение в GitHub (коммит в тот же репозиторий с вики).

## 4. Что не коммитить

- **`data/admin-gate.json`** — в `.gitignore`; создай локально по примеру `data/admin-gate.example.json`, если снова включишь веб-редактор в `admin/`.

Готово: после зелёного прогона Actions сайт обновится на Pages.

## Веб-прошивальщик на странице «Прошивка»

Workflow перед деплоем скачивает два `.bin` с Releases в папку `firmware/` (в git они не лежат — только в артефакте Pages). Если в новом релизе изменились **имена файлов**, обновите URL в шаге **Fetch firmware binaries for web flasher** в `.github/workflows/pages.yml` (и при необходимости в корневом `pages.yml`).
