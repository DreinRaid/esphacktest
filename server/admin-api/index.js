/* eslint-disable no-unused-vars */
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 3001);

const GH_OWNER = process.env.GH_OWNER || process.env.GITHUB_OWNER || "";
const GH_REPO = process.env.GH_REPO || process.env.GITHUB_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";

const ALLOWED_PATHS = (() => {
  // Keep the same set of JSON files as in client EDITABLE.
  const raw = process.env.ALLOWED_PATHS;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(String);
    } catch (e) {}
  }
  return ["data/github-release.json", "data/nav.json", "data/nav-en.json", "data/downloads.json"];
})();

const ADMIN_USERS = (() => {
  const raw = process.env.ADMIN_USERS_JSON;
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch (e) {}
  return {};
})();

const ADMIN_CORS_ORIGIN = process.env.ADMIN_CORS_ORIGIN || process.env.ADMIN_ORIGIN || "";

function encodeGitHubPath(p) {
  return String(p)
    .split("/")
    .filter(Boolean)
    .map(function (seg) {
      return encodeURIComponent(seg);
    })
    .join("/");
}

function constTimeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function decodeGithubContent(base64) {
  return Buffer.from(String(base64 || ""), "base64").toString("utf8");
}

async function ghFetchJson(path, token, opts) {
  opts = opts || {};
  const url = "https://api.github.com" + path;
  const headers = Object.assign(
    {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "token " + token,
    },
    opts.headers || {}
  );

  const r = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
  });

  const txt = await r.text();
  let j = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch (e) {}

  if (!r.ok) {
    const msg = (j && (j.message || j.error)) || ("GitHub API error " + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }

  return j;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.adminUser) return next();
  res.status(401).json({ ok: false, message: "Unauthorized" });
}

const CORS_ORIGIN =
  ADMIN_CORS_ORIGIN && String(ADMIN_CORS_ORIGIN).trim() !== ""
    ? String(ADMIN_CORS_ORIGIN).trim()
    : "";

app.use(
  cors({
    origin: function (origin, cb) {
      if (CORS_ORIGIN) return cb(null, CORS_ORIGIN);
      // Если явно не задан origin — пробуем отразить пришедший origin.
      // Для fetch с credentials это важно: CORS должен вернуть конкретный домен.
      return cb(null, origin);
    },
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

app.set("trust proxy", 1);

app.use(
  session({
    name: "admin.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
    // На HTTP не прокатит SameSite=None (браузеры требуют Secure).
    // Поэтому:
    // - если secure=false -> sameSite=lax
    // - если secure=true  -> sameSite=none
    secure: process.env.COOKIE_SECURE === "false" ? false : true,
    sameSite: process.env.COOKIE_SECURE === "false" ? "lax" : "none",
    },
  })
);

app.get("/healthz", function (req, res) {
  res.json({ ok: true });
});

app.get("/versionz", function (req, res) {
  res.json({
    ok: true,
    version: "site-wiki-debug-v4",
  });
});

function adminUiHtml() {
  const editable = [
    { path: "data/github-release.json", label: "Релизы GitHub (конфиг API)" },
    { path: "data/nav.json", label: "Меню навигации (RU)" },
    { path: "data/nav-en.json", label: "Меню навигации (EN)" },
    { path: "data/pinout-modules.json", label: "Распиновка Modules (pinout)" },
    { path: "data/downloads.json", label: "Ручной список файлов" },
  ];

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ESP-HACK Admin</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: #e6edf3;
        background: #0d1117;
      }
      .card {
        max-width: 1180px;
        margin: 0 auto;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 10px;
        padding: 20px;
      }
      h1 { margin: 0 0 12px; font-size: 20px; }
      .muted { color: #8b949e; font-size: 13px; margin-top: 6px; }
      label { display: block; margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #8b949e; }
      input, textarea, select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #30363d;
        border-radius: 6px;
        background: #010409;
        color: #e6edf3;
        padding: 10px 12px;
        font-size: 14px;
      }
      textarea {
        min-height: 260px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      }
      .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
      button {
        cursor: pointer;
        padding: 10px 18px;
        border: 1px solid #30363d;
        border-radius: 6px;
        background: #30363d;
        color: #e6edf3;
        font-weight: 700;
      }

      button:hover {
        background: #21262d;
      }
      button.secondary { background: transparent; }
      .err {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid #d2a8a8;
        background: #2a0f0f;
        border-radius: 8px;
        color: #f2cbdc;
      }

      .builder {
        margin-top: 14px;
      }

      .panel {
        border: 1px solid #30363d;
        border-radius: 10px;
        padding: 12px;
        background: #161b22;
        margin-top: 10px;
      }

      .panel:first-child {
        margin-top: 0;
      }

      .panel-title {
        font-weight: 700;
        margin-bottom: 10px;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        align-items: end;
      }

      .row2 {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .btn-mini {
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #30363d;
        background: transparent;
        color: #e6edf3;
        font-weight: 700;
        cursor: pointer;
      }

      .btn-mini--danger {
        border-color: #30363d;
        background: rgba(210, 168, 168, 0.04);
      }

      .anim-pop {
        animation: pop 180ms ease-out;
      }

      @keyframes pop {
        from {
          transform: translateY(-4px);
          opacity: 0.2;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .nav-layout {
        display: flex;
        gap: 12px;
        align-items: start;
        width: 100%;
      }

      .nav-col {
        min-width: 0;
      }

      .nav-col--tree {
        flex: 0 0 310px;
        max-width: 310px;
      }

      .nav-col--editor {
        flex: 1 1 auto;
        min-width: 520px;
      }

      .nav-col--preview {
        flex: 0 0 420px;
        max-width: 420px;
      }

      .nav-tree {
        border: 1px solid #30363d;
        border-radius: 10px;
        background: #161b22;
        padding: 10px;
        overflow: auto;
        max-height: 72vh;
      }

      .nav-tree__head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .nav-node {
        width: 100%;
        text-align: left;
        border: 1px solid #30363d;
        background: transparent;
        border-radius: 8px;
        padding: 8px 10px;
        color: #e6edf3;
        cursor: pointer;
        margin-bottom: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nav-node:hover {
        border-color: #8b949e;
      }

      .nav-node--active {
        border-color: #8b949e;
        background: rgba(139, 148, 158, 0.08);
      }

      .nav-tree__group {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px dashed #30363d;
      }

      .nav-tree__group-title {
        color: #e6edf3;
        font-weight: 800;
        font-size: 13px;
        margin-bottom: 6px;
      }

      .nav-editor {
        border: 1px solid #30363d;
        border-radius: 10px;
        background: #161b22;
        padding: 12px;
        overflow: auto;
        max-height: 72vh;
      }

      .nav-editor__title {
        font-weight: 900;
        margin-bottom: 10px;
      }

      .nav-preview {
        border: 1px solid #30363d;
        border-radius: 10px;
        background: #161b22;
        padding: 12px;
        overflow: auto;
        max-height: 72vh;
      }

      .nav-preview__title {
        font-weight: 900;
        margin-bottom: 10px;
      }

      .nav-preview__code {
        width: 100%;
        min-height: 420px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
          "Courier New", monospace;
        font-size: 12px;
        line-height: 1.35;
        color: #e6edf3;
        background: #010409;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 10px 12px;
        resize: vertical;
        box-sizing: border-box;
        overflow: auto;
      }

      @media (max-width: 1180px) {
        .nav-col--editor {
          min-width: 420px;
        }
        .nav-col--preview {
          flex-basis: 320px;
          max-width: 320px;
        }
      }

      @media (max-width: 980px) {
        .nav-layout {
          flex-direction: column;
        }
        .nav-col--tree,
        .nav-col--editor,
        .nav-col--preview {
          flex: 1 1 auto;
          min-width: 0;
          max-width: none;
        }
      }

      .nav-editor-layout3 {
        display: flex;
        gap: 12px;
        width: 100%;
        align-items: start;
      }

      .nav-sidebar3 {
        flex: 0 0 320px;
        max-width: 320px;
        border: 1px solid #30363d;
        background: #161b22;
        border-radius: 10px;
        padding: 10px;
        overflow: auto;
        max-height: 72vh;
      }

      .nav-main3 {
        flex: 1 1 auto;
        min-width: 380px;
      }

      .nav-s3__head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .nav-node3 {
        width: 100%;
        text-align: left;
        border: 1px solid #30363d;
        background: transparent;
        border-radius: 10px;
        padding: 8px 10px;
        color: #e6edf3;
        cursor: pointer;
        margin-top: 8px;
      }

      .nav-node3:hover {
        border-color: #8b949e;
      }

      .nav-node3--active {
        border-color: #8b949e;
        background: rgba(139, 148, 158, 0.08);
      }

      .nav-node3__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .nav-node3__label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nav-caret3 {
        flex: 0 0 auto;
        font-weight: 900;
        color: #8b949e;
      }

      .nav-children3 {
        overflow: hidden;
        max-height: 0px;
        transition: max-height 180ms ease;
        margin-left: 10px;
        padding-left: 8px;
        border-left: 1px dashed #30363d;
      }

      .nav-children3--open {
        max-height: 9999px;
      }

      .nav-s3__actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .btn-mini--ghost {
        background: transparent;
      }

      .nav-field3 {
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="card" id="root"></div>
    <script>
      const EDITABLE = ${JSON.stringify(editable)};
      const branch = ${JSON.stringify(GH_BRANCH)};
      const esc = (s) => String(s == null ? "" : s);
      const root = document.getElementById("root");
      let currentPath = null;

      function setErr(msg) {
        const prev = root.querySelector(".err");
        if (prev) prev.remove();
        if (!msg) return;
        const d = document.createElement("div");
        d.className = "err";
        d.textContent = msg;
        root.appendChild(d);
      }

      async function api(path, opts) {
        const r = await fetch(path, Object.assign({ credentials: "include" }, opts || {}));
        let j = null;
        try { j = await r.json(); } catch (e) {}
        if (!r.ok) {
          const m = (j && (j.message || j.error)) ? (j.message || j.error) : ("HTTP " + r.status);
          throw new Error(m);
        }
        return j;
      }

      function renderLogin(err) {
        root.innerHTML =
          "<h1>Вход в админку</h1>" +
          '<div class="muted">Авторизация выполняется на сервере. Нужны логин/пароль.</div>' +
          '<div style="margin-top:14px"><label>Логин</label><input id="u" type="text" autocomplete="username" /></div>' +
          '<div style="margin-top:10px"><label>Пароль</label><input id="p" type="password" autocomplete="current-password" /></div>' +
          '<div class="row"><button id="b" type="button">Войти</button></div>' +
          '<div class="muted">После входа отобразится редактор JSON.</div>';

        setErr(err || "");

        document.getElementById("b").onclick = async () => {
          setErr("");
          const u = document.getElementById("u").value.trim();
          const p = document.getElementById("p").value;
          if (!u || !p) {
            setErr("Введите логин и пароль");
            return;
          }
          await api("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p }),
          });
          renderEditor("");
        };
      }

      function renderEditor(err) {
        let navState = null;
        let pinoutState = null;
        let textareaEl = null;
        let editorKind = "text";

        root.innerHTML =
          "<h1>Редактор данных</h1>" +
          '<div><label>Файл</label><select id="sel"></select></div>' +
          '<div class="row">' +
          '<button id="load" type="button" style="display:none">Загрузить</button>' +
          '<button id="save" type="button">Сохранить</button>' +
          '<button id="out" type="button" class="secondary">Выйти</button>' +
          "</div>" +
          '<div style="margin-top:14px"><label id="editor-label">Содержимое (JSON)</label><div id="editor"></div></div>' +
          '<div class="muted">Изменённые файлы попадут в выбранную ветку GitHub репозитория.</div>';

        const sel = document.getElementById("sel");
        sel.innerHTML = EDITABLE
          .map((x) => '<option value="' + x.path + '">' + x.label + "</option>")
          .join("");

        setErr(err || "");

        function isNavFile(p) {
          return p === "data/nav.json" || p === "data/nav-en.json";
        }

        function isPinoutFile(p) {
          return p === "data/pinout-modules.json";
        }

        var DEFAULT_PINOUT = {
          modules: {
            display: { targets: ["3V3", "GND", "G22", "G21", null, null, null] },
            buttons: { targets: ["G27", "G26", "G33", "G32", null, null, null] },
            cc1101: { targets: ["GND", "3V3", "G4", "G5", "G18", "G23", "G19"] },
            ir: { targets: ["G16", "G35", null, null, null, null, null] },
            gpio: { targets: ["G16", "G2", "G18", "G23", "G19", "G25", null] },
            sdcard: { targets: ["3V3", "G15", "G13", "G14", "G17", "GND", null] },
          },
          nrfWiring: ["GND", "3V3", "A", "B", "C", "D", "E"],
        };

        var PINOUT_MODULE_TEMPLATES = [
          { id: "display", slots: ["VCC", "GND", "SCL", "SDA", null, null, null] },
          { id: "buttons", slots: ["UP", "DOWN", "OK", "BACK", null, null, null] },
          { id: "cc1101", slots: ["1", "2", "3", "4", "5", "6", "7"] },
          { id: "ir", slots: ["IR-TX", "IR-RX", null, null, null, null, null] },
          { id: "gpio", slots: ["A", "B", "C", "D", "E", "F", null] },
          { id: "sdcard", slots: ["3v3", "CS", "MOSI", "CLK", "MISO", "GND", null] },
        ];

        var PINOUT_ALLOWED_TARGETS = (function () {
          var out = ["GND", "3V3"];
          for (var i = 0; i <= 39; i++) out.push("G" + i);
          return out;
        })();

        var NRF_ALLOWED_GPIO_ROWS = ["A", "B", "C", "D", "E"];

        function normalizePinTarget(v) {
          var s = v == null ? "" : String(v).trim();
          if (!s) return null;
          if (s.toLowerCase() === "3v3") s = "3V3";
          if (PINOUT_ALLOWED_TARGETS.indexOf(s) === -1) return null;
          return s;
        }

        function normalizeNrfToken(idx, token) {
          if (idx === 0) return token === "GND" ? "GND" : "GND";
          if (idx === 1) return token === "3V3" ? "3V3" : "3V3";
          if (NRF_ALLOWED_GPIO_ROWS.indexOf(token) !== -1) return token;
          return DEFAULT_PINOUT.nrfWiring[idx];
        }

        function ensurePinoutShape(obj) {
          var pinout = obj && typeof obj === "object" ? obj : {};
          pinout.modules = pinout.modules && typeof pinout.modules === "object" ? pinout.modules : {};

          PINOUT_MODULE_TEMPLATES.forEach(function (m) {
            var existing = pinout.modules[m.id] && typeof pinout.modules[m.id] === "object" ? pinout.modules[m.id] : {};
            var targets = Array.isArray(existing.targets) ? existing.targets.slice() : [];
            while (targets.length < 7) targets.push(null);
            for (var i = 0; i < 7; i++) targets[i] = normalizePinTarget(targets[i]);
            pinout.modules[m.id] = { targets: targets };
          });

          var nrfWiring = Array.isArray(pinout.nrfWiring) ? pinout.nrfWiring.slice() : DEFAULT_PINOUT.nrfWiring.slice();
          while (nrfWiring.length < 7) nrfWiring.push(null);
          for (var j = 0; j < 7; j++) nrfWiring[j] = normalizeNrfToken(j, nrfWiring[j]);
          pinout.nrfWiring = nrfWiring;

          return pinout;
        }

        function ensureNavShape(nav) {
          if (!nav || typeof nav !== "object") return { groups: [] };
          if (!Array.isArray(nav.groups)) nav.groups = [];
          nav.groups.forEach(function (g) {
            if (!g || typeof g !== "object") return;
            if (!Array.isArray(g.items)) g.items = [];
            g.items.forEach(function (it) {
              if (!it || typeof it !== "object") return;
              if (!it.type) it.type = "link";
              if (it.type === "expand") {
                if (!Array.isArray(it.children)) it.children = [];
                if (!Array.isArray(it.openOn)) it.openOn = it.openOn ? it.openOn : [];
                if ((!it.id || !String(it.id).trim()) && it.href) {
                  it.id = "nav-" + Math.random().toString(36).slice(2, 8);
                }
              }
            });
          });
          return nav;
        }

        function ensureOpenOn(item) {
          if (!item || item.type !== "expand") return;
          if (Array.isArray(item.openOn) && item.openOn.length) return;
          var file = String(item.href || "").split("#")[0];
          item.openOn = file ? [{ file: file }] : [];
        }

        function renderTextEditor(text) {
          editorKind = "text";
          textareaEl = document.createElement("textarea");
          textareaEl.id = "ta";
          textareaEl.value = String(text || "");
          textareaEl.spellcheck = false;
          var ed = document.getElementById("editor");
          ed.innerHTML = "";
          ed.appendChild(textareaEl);
        }

        function createInput(value, onChange) {
          var inp = document.createElement("input");
          inp.value = value == null ? "" : String(value);
          inp.addEventListener("input", function () {
            onChange(inp.value);
          });
          return inp;
        }

        function createSelect(value, options, onChange) {
          var sel = document.createElement("select");
          options.forEach(function (o) {
            var opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === value) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", function () {
            onChange(sel.value);
          });
          return sel;
        }

        function renderPinoutEditor(pinout) {
          editorKind = "pinout";
          pinoutState = ensurePinoutShape(pinout);

          textareaEl = null;

          var ed = document.getElementById("editor");
          ed.innerHTML = "";
          ed.classList.add("anim-pop");
          ed.style.display = "block";

          var wrap = document.createElement("div");
          wrap.className = "builder";

          var toolbar = document.createElement("div");
          toolbar.className = "panel";
          toolbar.innerHTML =
            '<div class="panel-title">Конструктор распиновки Modules</div>' +
            '<div class="muted" style="margin-top:6px">Сохраняется в JSON: <code>data/pinout-modules.json</code></div>' +
            '<div class="row2" style="margin-top:12px;justify-content:space-between">' +
            '<div class="muted" style="font-size:12px;max-width:680px">В таблице справа выбирай назначение пина из списка. Пусто = —</div>' +
            '<div><button id="pinout-reset" class="btn-mini btn-mini--danger" type="button">Сбросить к дефолту</button></div>' +
            "</div>";
          wrap.appendChild(toolbar);

          var nameByModuleId = {
            display: "Display",
            buttons: "Buttons",
            cc1101: "CC1101",
            ir: "IR",
            gpio: "GPIO",
            sdcard: "SD Card",
          };

          var targetOptions = PINOUT_ALLOWED_TARGETS.map(function (t) {
            return { value: t, label: t };
          });
          targetOptions.unshift({ value: "", label: "—" });

          var modTable = document.createElement("table");
          modTable.style.width = "100%";
          modTable.style.borderCollapse = "collapse";
          modTable.style.marginTop = "12px";

          function applyCellStyle(cell, isHeader) {
            cell.style.border = "1px solid #30363d";
            cell.style.padding = "8px 10px";
            cell.style.textAlign = isHeader ? "center" : "center";
            cell.style.verticalAlign = "middle";
          }

          var thead = document.createElement("thead");
          var hr = document.createElement("tr");

          var h0 = document.createElement("th");
          h0.scope = "col";
          h0.textContent = "Module";
          applyCellStyle(h0, true);
          h0.style.textAlign = "left";
          hr.appendChild(h0);

          for (var pi = 0; pi < 7; pi++) {
            var h = document.createElement("th");
            h.scope = "col";
            h.textContent = "Pin";
            applyCellStyle(h, true);
            hr.appendChild(h);
          }
          thead.appendChild(hr);
          modTable.appendChild(thead);

          var tbody = document.createElement("tbody");
          PINOUT_MODULE_TEMPLATES.forEach(function (m) {
            var tr = document.createElement("tr");

            var th = document.createElement("th");
            th.scope = "row";
            th.textContent = nameByModuleId[m.id] || m.id;
            th.style.textAlign = "left";
            applyCellStyle(th, false);
            tr.appendChild(th);

            var targets = pinoutState.modules[m.id] && Array.isArray(pinoutState.modules[m.id].targets) ? pinoutState.modules[m.id].targets : [];
            for (var col = 0; col < 7; col++) {
              var td = document.createElement("td");
              applyCellStyle(td, false);

              var slotLabel = m.slots[col];
              if (!slotLabel) {
                td.textContent = "—";
                td.style.color = "#8b949e";
                tr.appendChild(td);
                continue;
              }

              var currentVal = targets[col] == null ? "" : String(targets[col]);
              var sel = createSelect(currentVal, targetOptions, function (v) {
                pinoutState.modules[m.id].targets[col] = normalizePinTarget(v);
              });
              td.appendChild(sel);
              tr.appendChild(td);
            }

            tbody.appendChild(tr);
          });

          modTable.appendChild(tbody);
          wrap.appendChild(modTable);

          // NRF wiring section: pins 3..7 -> GPIO rows A..E
          var nrfPanel = document.createElement("div");
          nrfPanel.className = "panel";
          nrfPanel.style.marginTop = "10px";
          nrfPanel.innerHTML = '<div class="panel-title">NRF24 wiring</div><div class="muted" style="margin-top:6px">Справа отображение обновляется автоматически по текущей строке GPIO (A–E).</div>';

          var nrfRows = [
            { idx: 2, label: "CE (pin 3)" },
            { idx: 3, label: "CSN (pin 4)" },
            { idx: 4, label: "SCK (pin 5)" },
            { idx: 5, label: "MOSI (pin 6)" },
            { idx: 6, label: "MISO (pin 7)" },
          ];

          var nrfOptions = NRF_ALLOWED_GPIO_ROWS.map(function (r) {
            return { value: r, label: r };
          });

          nrfRows.forEach(function (r) {
            var row = document.createElement("div");
            row.className = "nav-field3";
            row.style.marginTop = "12px";

            var lab = document.createElement("label");
            lab.textContent = r.label + " -> GPIO row";
            row.appendChild(lab);

            var cur = pinoutState.nrfWiring[r.idx];
            if (cur == null || NRF_ALLOWED_GPIO_ROWS.indexOf(cur) === -1) cur = "A";

            var sel = createSelect(cur, nrfOptions, function (v) {
              pinoutState.nrfWiring[r.idx] = v;
            });
            row.appendChild(sel);
            nrfPanel.appendChild(row);
          });

          wrap.appendChild(nrfPanel);

          ed.appendChild(wrap);

          var resetBtn = document.getElementById("pinout-reset");
          if (resetBtn) {
            resetBtn.addEventListener("click", function () {
              renderPinoutEditor(DEFAULT_PINOUT);
            });
          }
        }

        function renderNavEditor(nav) {
          editorKind = "nav";
          navState = ensureNavShape(nav);

          var ed = document.getElementById("editor");
          ed.innerHTML = "";
          ed.classList.add("anim-pop");
          ed.style.display = "block";

          var wrap = document.createElement("div");
          wrap.className = "builder";

          var toolbar = document.createElement("div");
          toolbar.className = "panel";

          toolbar.innerHTML =
            '<div class="panel-title">Конструктор меню</div>' +
            '<div class="row2">' +
            '<div class="muted">Группы → пункты → (для expand) под-пункты.</div>' +
            '<div><button id="add-group" class="btn-mini">+ Добавить группу</button></div>' +
            "</div>";

          wrap.appendChild(toolbar);

          var groupsHost = document.createElement("div");
          groupsHost.id = "groups-host";
          wrap.appendChild(groupsHost);

          ed.appendChild(wrap);

          function move(arr, idx, dir) {
            var ni = idx + dir;
            if (ni < 0 || ni >= arr.length) return;
            var tmp = arr[idx];
            arr[idx] = arr[ni];
            arr[ni] = tmp;
          }

          function renderGroups() {
            groupsHost.innerHTML = "";

            navState.groups.forEach(function (g, gi) {
              var groupPanel = document.createElement("div");
              groupPanel.className = "panel anim-pop";

              var header = document.createElement("div");
              header.className = "row2";

              var titleCol = document.createElement("div");
              titleCol.innerHTML = '<div class="panel-title">Группа</div>';

              var actionsCol = document.createElement("div");
              actionsCol.innerHTML =
                '<div class="row2">' +
                '<button class="btn-mini" data-act="up" data-gi="' +
                gi +
                '">↑</button>' +
                '<button class="btn-mini" data-act="down" data-gi="' +
                gi +
                '">↓</button>' +
                '<button class="btn-mini btn-mini--danger" data-act="del-group" data-gi="' +
                gi +
                '">Удалить</button>' +
                "</div>";

              header.appendChild(titleCol);
              header.appendChild(actionsCol);
              groupPanel.appendChild(header);

              var labelRow = document.createElement("div");
              labelRow.className = "row2";

              var lbl = document.createElement("div");
              lbl.innerHTML = '<label>Название группы</label>';
              var inpLabel = createInput(g && g.label, function (v) {
                navState.groups[gi].label = v;
              });
              lbl.appendChild(inpLabel);

              var addItemWrap = document.createElement("div");
              addItemWrap.innerHTML = '<div><button class="btn-mini" data-act="add-item" data-gi="' + gi + '">+ Добавить пункт</button></div>';

              labelRow.appendChild(lbl);
              labelRow.appendChild(addItemWrap);
              groupPanel.appendChild(labelRow);

              var itemsHost = document.createElement("div");
              itemsHost.style.marginTop = "10px";

              (g.items || []).forEach(function (it, ii) {
                var itemPanel = document.createElement("div");
                itemPanel.className = "panel";
                itemPanel.style.background = "#161b22";
                itemPanel.style.marginTop = "10px";

                function onDeleteItem() {
                  navState.groups[gi].items.splice(ii, 1);
                  renderGroups();
                }

                function onMoveItem(dir) {
                  move(navState.groups[gi].items, ii, dir);
                  renderGroups();
                }

                function onChangeType(newType) {
                  navState.groups[gi].items[ii].type = newType;
                  if (newType === "expand") {
                    if (!Array.isArray(navState.groups[gi].items[ii].children)) navState.groups[gi].items[ii].children = [];
                    if (!navState.groups[gi].items[ii].id) navState.groups[gi].items[ii].id = "nav-" + Math.random().toString(36).slice(2, 8);
                    if (!Array.isArray(navState.groups[gi].items[ii].openOn)) navState.groups[gi].items[ii].openOn = [];
                  } else {
                    delete navState.groups[gi].items[ii].children;
                    delete navState.groups[gi].items[ii].openOn;
                    delete navState.groups[gi].items[ii].id;
                  }
                  renderGroups();
                }

                var topRow = document.createElement("div");
                topRow.className = "row2";

                topRow.appendChild(
                  (function () {
                    var col = document.createElement("div");
                    col.innerHTML = "<label>Тип</label>";
                    var sel = createSelect(
                      it.type || "link",
                      [
                        { value: "link", label: "Ссылка" },
                        { value: "expand", label: "Раскрывашка" },
                      ],
                      function (v) {
                        onChangeType(v);
                      }
                    );
                    col.appendChild(sel);
                    return col;
                  })()
                );

                topRow.appendChild(
                  (function () {
                    var col = document.createElement("div");
                    col.innerHTML = "<label>Заголовок</label>";
                    var inp = createInput(it.label, function (v) {
                      navState.groups[gi].items[ii].label = v;
                    });
                    col.appendChild(inp);
                    return col;
                  })()
                );

                itemPanel.appendChild(topRow);

                var hrefRow = document.createElement("div");
                hrefRow.className = "row2";
                var hrefCol = document.createElement("div");
                hrefCol.innerHTML = "<label>Href</label>";
                hrefCol.appendChild(
                  createInput(it.href, function (v) {
                    navState.groups[gi].items[ii].href = v;
                    if (navState.groups[gi].items[ii].type === "expand") {
                      ensureOpenOn(navState.groups[gi].items[ii]);
                    }
                  })
                );
                hrefRow.appendChild(hrefCol);

                var rightBtns = document.createElement("div");
                rightBtns.innerHTML =
                  '<div class="row2">' +
                  '<button class="btn-mini" data-act="up-item" data-gi="' +
                  gi +
                  '" data-ii="' +
                  ii +
                  '">↑</button>' +
                  '<button class="btn-mini" data-act="down-item" data-gi="' +
                  gi +
                  '" data-ii="' +
                  ii +
                  '">↓</button>' +
                  '<button class="btn-mini btn-mini--danger" data-act="del-item" data-gi="' +
                  gi +
                  '" data-ii="' +
                  ii +
                  '">Удалить</button>' +
                  "</div>";
                hrefRow.appendChild(rightBtns);

                itemPanel.appendChild(hrefRow);
                itemsHost.appendChild(itemPanel);

                if (it.type === "expand") {
                  var childrenHost = document.createElement("div");
                  childrenHost.style.marginTop = "10px";

                  var childrenHeader = document.createElement("div");
                  childrenHeader.className = "row2";
                  childrenHeader.innerHTML =
                    '<div><div class="panel-title">Подпункты</div></div>' +
                    '<div><button class="btn-mini" data-act="add-child" data-gi="' +
                    gi +
                    '" data-ii="' +
                    ii +
                    '">+ Добавить</button></div>';

                  childrenHost.appendChild(childrenHeader);

                  var children = Array.isArray(it.children) ? it.children : [];
                  children.forEach(function (ch, ci) {
                    var childPanel = document.createElement("div");
                    childPanel.className = "panel";
                    childPanel.style.background = "#161b22";
                    childPanel.style.marginTop = "10px";

                    var childTop = document.createElement("div");
                    childTop.className = "row2";

                    var lblCol = document.createElement("div");
                    lblCol.innerHTML = "<label>Подпункт: текст</label>";
                    lblCol.appendChild(
                      createInput(ch.label, function (v) {
                        navState.groups[gi].items[ii].children[ci].label = v;
                      })
                    );

                    var hrefCol2 = document.createElement("div");
                    hrefCol2.innerHTML = "<label>Подпункт: href</label>";
                    hrefCol2.appendChild(
                      createInput(ch.href, function (v) {
                        navState.groups[gi].items[ii].children[ci].href = v;
                      })
                    );

                    childTop.appendChild(lblCol);
                    childTop.appendChild(hrefCol2);

                    var delRow = document.createElement("div");
                    delRow.style.marginTop = "10px";
                    delRow.innerHTML =
                      '<button class="btn-mini btn-mini--danger" data-act="del-child" data-gi="' +
                      gi +
                      '" data-ii="' +
                      ii +
                      '" data-ci="' +
                      ci +
                      '">Удалить подпункт</button>';

                    childPanel.appendChild(childTop);
                    childPanel.appendChild(delRow);
                    childrenHost.appendChild(childPanel);
                  });

                  itemPanel.appendChild(childrenHost);
                }
              });

              groupPanel.appendChild(itemsHost);
              groupsHost.appendChild(groupPanel);
            });

            // After DOM built, attach click handlers by dataset.
            groupsHost.querySelectorAll("[data-act]").forEach(function (btn) {
              btn.addEventListener("click", function () {
                var act = btn.getAttribute("data-act") || "";
                var gi = Number(btn.getAttribute("data-gi"));
                var ii = Number(btn.getAttribute("data-ii"));
                var ci = Number(btn.getAttribute("data-ci"));

                if (act === "add-group") return;
                if (act === "del-group") {
                  navState.groups.splice(gi, 1);
                  renderGroups();
                } else if (act === "up") {
                  move(navState.groups, gi, -1);
                  renderGroups();
                } else if (act === "down") {
                  move(navState.groups, gi, 1);
                  renderGroups();
                } else if (act === "add-item") {
                  navState.groups[gi].items.push({ type: "link", label: "Новый пункт", href: "index.html" });
                  renderGroups();
                } else if (act === "up-item") {
                  move(navState.groups[gi].items, ii, -1);
                  renderGroups();
                } else if (act === "down-item") {
                  move(navState.groups[gi].items, ii, 1);
                  renderGroups();
                } else if (act === "del-item") {
                  navState.groups[gi].items.splice(ii, 1);
                  renderGroups();
                } else if (act === "add-child") {
                  navState.groups[gi].items[ii].type = "expand";
                  if (!Array.isArray(navState.groups[gi].items[ii].children)) navState.groups[gi].items[ii].children = [];
                  navState.groups[gi].items[ii].children.push({ label: "Новый подпункт", href: "index.html" });
                  renderGroups();
                } else if (act === "del-child") {
                  navState.groups[gi].items[ii].children.splice(ci, 1);
                  renderGroups();
                }
              });
            });
          }

          // First render groups.
          renderGroups();

          // Toolbar handler.
          var addBtn = document.getElementById("add-group");
          if (addBtn) {
            addBtn.addEventListener("click", function () {
              navState.groups.push({ label: "Новая группа", items: [] });
              renderNavEditor(navState);
            });
          }
        }

        function renderNavEditor2(nav) {
          editorKind = "nav";
          navState = ensureNavShape(nav);

          // Selection: { kind: 'group'|'item'|'child', gi, ii, ci }
          var selected = null;

          function setSelected(sel) {
            selected = sel;
            renderAll();
          }

          var ed = document.getElementById("editor");
          ed.innerHTML = "";

          var layout = document.createElement("div");
          layout.className = "nav-layout";

          var treeCol = document.createElement("div");
          treeCol.className = "nav-col nav-col--tree";

          var editorCol = document.createElement("div");
          editorCol.className = "nav-col nav-col--editor";

          var previewCol = document.createElement("div");
          previewCol.className = "nav-col nav-col--preview";

          // Колонки: 1) редактор (центр-слева), 2) дерево (справа от редактора), 3) JSON превью (крайний справа).
          layout.appendChild(editorCol);
          layout.appendChild(treeCol);
          layout.appendChild(previewCol);
          ed.appendChild(layout);

          function move(arr, idx, dir) {
            var ni = idx + dir;
            if (ni < 0 || ni >= arr.length) return;
            var tmp = arr[idx];
            arr[idx] = arr[ni];
            arr[ni] = tmp;
          }

          function isNavFile(_p) {
            return _p === "data/nav.json" || _p === "data/nav-en.json";
          }

          function renderTree() {
            treeCol.innerHTML =
              '<div class="nav-tree__head">' +
              '<div><div style="font-weight:900">Меню</div><div class="muted" style="margin-top:4px;font-size:12px">Группы и пункты</div></div>' +
              '<div><button id="add-group2" class="btn-mini">+ Группа</button></div>' +
              "</div>" +
              '<div class="nav-tree" style="padding:0;border-radius:10px;margin-top:10px"></div>';

            // Host for nodes inside tree container.
            var host = treeCol.querySelector(".nav-tree");
            host.innerHTML = "";

            var groups = Array.isArray(navState.groups) ? navState.groups : [];

            function nodeButton(kind, gi, ii, ci, label) {
              var b = document.createElement("button");
              b.className = "nav-node";
              var active =
                selected &&
                selected.kind === kind &&
                selected.gi === gi &&
                selected.ii === ii &&
                selected.ci === ci;
              if (active) b.classList.add("nav-node--active");
              b.textContent = label;
              b.addEventListener("click", function () {
                setSelected({ kind: kind, gi: gi, ii: ii, ci: ci });
              });
              return b;
            }

            groups.forEach(function (g, gi) {
              var gt = document.createElement("div");
              gt.className = "nav-tree__group";
              var title = document.createElement("div");
              title.className = "nav-tree__group-title";
              title.textContent = g.label || "Без названия";
              gt.appendChild(title);

              host.appendChild(gt);

              var items = Array.isArray(g.items) ? g.items : [];
              items.forEach(function (it, ii) {
                var prefix = it.type === "expand" ? "↳ " : "";
                host.appendChild(
                  nodeButton("item", gi, ii, null, prefix + (it.label || "Без заголовка"))
                );

                if (it.type === "expand") {
                  var children = Array.isArray(it.children) ? it.children : [];
                  children.forEach(function (ch, ci) {
                    host.appendChild(
                      nodeButton("child", gi, ii, ci, "    • " + (ch.label || "Подпункт"))
                    );
                  });
                }
              });
            });

            var addBtn = document.getElementById("add-group2");
            if (addBtn) {
              addBtn.addEventListener("click", function () {
                navState.groups = navState.groups || [];
                navState.groups.push({
                  label: "Новая группа",
                  items: [],
                });
                setSelected({ kind: "group", gi: navState.groups.length - 1, ii: null, ci: null });
              });
            }
          }

          function renderEditor() {
            editorCol.innerHTML = "";

            var panel = document.createElement("div");
            panel.className = "nav-editor anim-pop";
            editorCol.appendChild(panel);

            if (!selected) {
              panel.innerHTML = '<div class="nav-editor__title">Выбери элемент</div>';
              return;
            }

            function row2() {
              var d = document.createElement("div");
              d.className = "row2";
              return d;
            }

            if (selected.kind === "group") {
              var g = navState.groups[selected.gi];
              panel.innerHTML = '<div class="nav-editor__title">Редактирование группы</div>';

              var lbl = document.createElement("div");
              lbl.innerHTML = "<label>Название</label>";
              lbl.appendChild(
                createInput(g && g.label, function (v) {
                  navState.groups[selected.gi].label = v;
                  renderAll();
                })
              );
              panel.appendChild(lbl);

              panel.appendChild(
                (function () {
                  var wrap = document.createElement("div");
                  wrap.style.marginTop = "10px";
                  wrap.innerHTML =
                    '<div class="row2">' +
                    '<button class="btn-mini" id="add-item2">+ Пункт</button>' +
                    '<button class="btn-mini btn-mini--danger" id="del-group2">Удалить</button>' +
                    "</div>";
                  return wrap;
                })()
              );

              var addItem2 = document.getElementById("add-item2");
              if (addItem2) {
                addItem2.addEventListener("click", function () {
                  navState.groups[selected.gi].items = navState.groups[selected.gi].items || [];
                  navState.groups[selected.gi].items.push({
                    type: "link",
                    label: "Новый пункт",
                    href: "index.html",
                  });
                  setSelected({ kind: "item", gi: selected.gi, ii: navState.groups[selected.gi].items.length - 1, ci: null });
                });
              }

              var delGroup2 = document.getElementById("del-group2");
              if (delGroup2) {
                delGroup2.addEventListener("click", function () {
                  navState.groups.splice(selected.gi, 1);
                  selected = null;
                  renderAll();
                });
              }

              // Move buttons.
              var moveRow = document.createElement("div");
              moveRow.className = "row2";
              moveRow.style.marginTop = "10px";
              moveRow.innerHTML =
                '<button class="btn-mini" id="up-g2">↑</button>' +
                '<button class="btn-mini" id="down-g2">↓</button>';
              panel.appendChild(moveRow);

              var upg = document.getElementById("up-g2");
              if (upg) upg.addEventListener("click", function () { move(navState.groups, selected.gi, -1); selected.gi = Math.max(0, selected.gi - 1); renderAll(); });
              var downg = document.getElementById("down-g2");
              if (downg) downg.addEventListener("click", function () { move(navState.groups, selected.gi, 1); selected.gi = Math.min(navState.groups.length - 1, selected.gi + 1); renderAll(); });
            }

            if (selected.kind === "item") {
              var it = navState.groups[selected.gi].items[selected.ii];
              panel.innerHTML = '<div class="nav-editor__title">Редактирование пункта</div>';

              // Type toggle.
              var typeRow = row2();
              typeRow.innerHTML =
                '<div><label>Тип</label></div>';
              var typeSel = createSelect(it.type || "link", [
                { value: "link", label: "Ссылка" },
                { value: "expand", label: "Раскрывашка" },
              ], function (v) {
                navState.groups[selected.gi].items[selected.ii].type = v;
                if (v === "expand") {
                  if (!Array.isArray(it.children)) it.children = [];
                  if (!Array.isArray(it.openOn)) it.openOn = [];
                  if (!it.id) it.id = "nav-" + Math.random().toString(36).slice(2, 8);
                } else {
                  delete it.children;
                  delete it.openOn;
                  delete it.id;
                }
                renderAll();
              });
              typeRow.appendChild(typeSel);
              panel.appendChild(typeRow);

              var lbl = document.createElement("div");
              lbl.innerHTML = "<label>Заголовок</label>";
              lbl.appendChild(
                createInput(it.label, function (v) {
                  navState.groups[selected.gi].items[selected.ii].label = v;
                  renderAll();
                })
              );
              panel.appendChild(lbl);

              var href = document.createElement("div");
              href.innerHTML = "<label>Href</label>";
              href.appendChild(
                createInput(it.href, function (v) {
                  navState.groups[selected.gi].items[selected.ii].href = v;
                  if (it.type === "expand") ensureOpenOn(navState.groups[selected.gi].items[selected.ii]);
                  renderAll();
                })
              );
              panel.appendChild(href);

              // Actions row.
              var actions = document.createElement("div");
              actions.className = "row2";
              actions.style.marginTop = "10px";
              actions.innerHTML =
                '<button class="btn-mini" id="up-i2">↑</button>' +
                '<button class="btn-mini" id="down-i2">↓</button>' +
                '<button class="btn-mini btn-mini--danger" id="del-i2">Удалить</button>';
              panel.appendChild(actions);

              var upi = document.getElementById("up-i2");
              if (upi) upi.addEventListener("click", function () { move(navState.groups[selected.gi].items, selected.ii, -1); selected.ii = Math.max(0, selected.ii - 1); renderAll(); });
              var downi = document.getElementById("down-i2");
              if (downi) downi.addEventListener("click", function () { move(navState.groups[selected.gi].items, selected.ii, 1); selected.ii = Math.min(navState.groups[selected.gi].items.length - 1, selected.ii + 1); renderAll(); });
              var deli = document.getElementById("del-i2");
              if (deli) deli.addEventListener("click", function () { navState.groups[selected.gi].items.splice(selected.ii, 1); selected = null; renderAll(); });

              if (it.type === "expand") {
                var children = Array.isArray(it.children) ? it.children : [];
                var childWrap = document.createElement("div");
                childWrap.style.marginTop = "12px";
                childWrap.innerHTML =
                  '<div style="font-weight:900;margin-bottom:10px">Подпункты</div>' +
                  '<div class="row2"><button class="btn-mini" id="add-child2">+ Добавить подпункт</button></div>';
                panel.appendChild(childWrap);

                var addChild2 = document.getElementById("add-child2");
                if (addChild2) {
                  addChild2.addEventListener("click", function () {
                    it.children = it.children || [];
                    it.children.push({ label: "Новый подпункт", href: "index.html" });
                    setSelected({ kind: "child", gi: selected.gi, ii: selected.ii, ci: it.children.length - 1 });
                    renderAll();
                  });
                }

                // Children list.
                children.forEach(function (ch, ci) {
                  var chPanel = document.createElement("div");
                  chPanel.className = "panel";
                  chPanel.style.background = "#161b22";
                  chPanel.style.marginTop = "10px";

                  var top = document.createElement("div");
                  top.className = "row2";
                  top.innerHTML =
                    '<div><label>Подпункт</label></div>';
                  chPanel.appendChild(top);

                  var name = document.createElement("div");
                  name.innerHTML = "<label>Текст</label>";
                  name.appendChild(
                    createInput(ch.label, function (v) {
                      it.children[ci].label = v;
                      renderAll();
                    })
                  );
                  chPanel.appendChild(name);

                  var href2 = document.createElement("div");
                  href2.innerHTML = "<label>Href</label>";
                  href2.appendChild(
                    createInput(ch.href, function (v) {
                      it.children[ci].href = v;
                      renderAll();
                    })
                  );
                  chPanel.appendChild(href2);

                  var del = document.createElement("div");
                  del.className = "row2";
                  del.style.marginTop = "10px";
                  del.innerHTML =
                    '<button class="btn-mini btn-mini--danger" data-del-ci="' +
                    ci +
                    '" id="del-child2-' +
                    ci +
                    '">Удалить</button>';
                  chPanel.appendChild(del);
                  var btn = document.getElementById("del-child2-" + ci);
                  if (btn) {
                    btn.addEventListener("click", function () {
                      it.children.splice(ci, 1);
                      setSelected({ kind: "item", gi: selected.gi, ii: selected.ii, ci: null });
                      renderAll();
                    });
                  }

                  panel.appendChild(chPanel);
                });
              }
            }

            if (selected.kind === "child") {
              var it = navState.groups[selected.gi].items[selected.ii];
              var ch = it.children[selected.ci];
              panel.innerHTML = '<div class="nav-editor__title">Редактирование подпункта</div>';

              var lbl = document.createElement("div");
              lbl.innerHTML = "<label>Текст</label>";
              lbl.appendChild(
                createInput(ch.label, function (v) {
                  it.children[selected.ci].label = v;
                  renderAll();
                })
              );
              panel.appendChild(lbl);

              var href = document.createElement("div");
              href.innerHTML = "<label>Href</label>";
              href.appendChild(
                createInput(ch.href, function (v) {
                  it.children[selected.ci].href = v;
                  renderAll();
                })
              );
              panel.appendChild(href);

              var actions = document.createElement("div");
              actions.className = "row2";
              actions.style.marginTop = "10px";
              actions.innerHTML =
                '<button class="btn-mini" id="up-c2">↑</button>' +
                '<button class="btn-mini" id="down-c2">↓</button>' +
                '<button class="btn-mini btn-mini--danger" id="del-c2">Удалить</button>';
              panel.appendChild(actions);

              var upc = document.getElementById("up-c2");
              if (upc)
                upc.addEventListener("click", function () {
                  move(it.children, selected.ci, -1);
                  selected.ci = Math.max(0, selected.ci - 1);
                  renderAll();
                });
              var downc = document.getElementById("down-c2");
              if (downc)
                downc.addEventListener("click", function () {
                  move(it.children, selected.ci, 1);
                  selected.ci = Math.min(it.children.length - 1, selected.ci + 1);
                  renderAll();
                });
              var delc = document.getElementById("del-c2");
              if (delc)
                delc.addEventListener("click", function () {
                  it.children.splice(selected.ci, 1);
                  setSelected({ kind: "item", gi: selected.gi, ii: selected.ii, ci: null });
                  renderAll();
                });
            }
          }

          function renderPreview() {
            previewCol.innerHTML = "";
            var panel = document.createElement("div");
            panel.className = "nav-preview anim-pop";
            previewCol.appendChild(panel);
            panel.innerHTML =
              '<div class="nav-preview__title">JSON превью</div>' +
              '<textarea class="nav-preview__code" readonly></textarea>';
            var ta = panel.querySelector("textarea");
            ta.value = JSON.stringify(navState, null, 2);
          }

          function renderAll() {
            // Render in order to keep DOM queries stable.
            renderTree();
            renderEditor();
            renderPreview();
          }

          if (!selected) {
            if (Array.isArray(navState.groups) && navState.groups.length > 0) {
              selected = { kind: "group", gi: 0, ii: null, ci: null };
            }
          }

          renderAll();
        }

        function renderNavEditor3(nav) {
          editorKind = "nav";
          navState = ensureNavShape(nav);

          var selected3 = null; // { kind:'group'|'item'|'child', gi, ii, ci }
          var expandedGroups3 = {};
          var expandedItems3 = {}; // key: "gi:ii"

          function keyItem(gi, ii) {
            return gi + ":" + ii;
          }

          if (navState && Array.isArray(navState.groups)) {
            navState.groups.forEach(function (_g, gi) {
              expandedGroups3[gi] = true;
            });
            navState.groups.forEach(function (g, gi) {
              (g.items || []).forEach(function (it, ii) {
                if (it.type === "expand") expandedItems3[keyItem(gi, ii)] = true;
              });
            });
          }

          function setSelected3(sel) {
            selected3 = sel;
            renderAll3();
          }

          var ed3 = document.getElementById("editor");
          ed3.innerHTML = "";

          var layout3 = document.createElement("div");
          layout3.className = "nav-editor-layout3";

          var sidebar3 = document.createElement("div");
          sidebar3.className = "nav-sidebar3";

          var main3 = document.createElement("div");
          main3.className = "nav-main3";

          layout3.appendChild(sidebar3);
          layout3.appendChild(main3);
          ed3.appendChild(layout3);

          function isActive3(sel) {
            if (!selected3 || !sel) return false;
            return (
              selected3.kind === sel.kind &&
              selected3.gi === sel.gi &&
              selected3.ii === sel.ii &&
              selected3.ci === sel.ci
            );
          }

          function renderSidebar3() {
            var groups = Array.isArray(navState.groups) ? navState.groups : [];

            sidebar3.innerHTML =
              '<div class="nav-s3__head">' +
              '<div><div style="font-weight:900">Меню</div><div class="muted" style="margin-top:4px;font-size:12px">Раскрытие как на вики</div></div>' +
              '<div><button id="add-group3" class="btn-mini">+ Группа</button></div>' +
              "</div>";

            groups.forEach(function (g, gi) {
              var groupOpen = !!expandedGroups3[gi];
              var groupSel = { kind: "group", gi: gi, ii: null, ci: null };

              var groupBtn = document.createElement("button");
              groupBtn.type = "button";
              groupBtn.className =
                "nav-node3" + (isActive3(groupSel) ? " nav-node3--active" : "");
              groupBtn.innerHTML =
                '<div class="nav-node3__row">' +
                '<div class="nav-node3__label">' +
                (g.label || "Без названия") +
                "</div>" +
                '<div class="nav-caret3">' + (groupOpen ? "–" : "+") + "</div>" +
                "</div>";

              groupBtn.addEventListener("click", function () {
                expandedGroups3[gi] = !groupOpen;
                setSelected3(groupSel);
              });
              sidebar3.appendChild(groupBtn);

              var wrap = document.createElement("div");
              wrap.className =
                "nav-children3" + (groupOpen ? " nav-children3--open" : "");
              sidebar3.appendChild(wrap);

              (g.items || []).forEach(function (it, ii) {
                var isExp = it.type === "expand";
                var itemKey = keyItem(gi, ii);
                var itemOpen = !!expandedItems3[itemKey];

                var itemSel = { kind: "item", gi: gi, ii: ii, ci: null };

                var itemBtn = document.createElement("button");
                itemBtn.type = "button";
                itemBtn.className =
                  "nav-node3" + (isActive3(itemSel) ? " nav-node3--active" : "");
                itemBtn.style.marginTop = "8px";
                itemBtn.style.borderRadius = "10px";
                itemBtn.innerHTML =
                  '<div class="nav-node3__row">' +
                  '<div class="nav-node3__label">' +
                  (isExp ? "▸ " : "") +
                  (it.label || "Без заголовка") +
                  "</div>" +
                  '<div class="nav-caret3">' +
                  (isExp ? (itemOpen ? "–" : "+") : "") +
                  "</div>" +
                  "</div>";

                itemBtn.addEventListener("click", function (e) {
                  if (isExp) expandedItems3[itemKey] = !itemOpen;
                  setSelected3(itemSel);
                  e.stopPropagation();
                });
                wrap.appendChild(itemBtn);

                if (isExp) {
                  var chWrap = document.createElement("div");
                  chWrap.className =
                    "nav-children3" + (itemOpen ? " nav-children3--open" : "");
                  wrap.appendChild(chWrap);

                  var children = Array.isArray(it.children) ? it.children : [];
                  children.forEach(function (ch, ci) {
                    var childSel = { kind: "child", gi: gi, ii: ii, ci: ci };
                    var chBtn = document.createElement("button");
                    chBtn.type = "button";
                    chBtn.className =
                      "nav-node3" + (isActive3(childSel) ? " nav-node3--active" : "");
                    chBtn.style.marginTop = "8px";
                    chBtn.style.marginLeft = "10px";
                    chBtn.innerHTML =
                      '<div class="nav-node3__row">' +
                      '<div class="nav-node3__label">• ' +
                      (ch.label || "Подпункт") +
                      "</div>" +
                      '<div class="nav-caret3"></div>' +
                      "</div>";
                    chBtn.addEventListener("click", function (e2) {
                      setSelected3(childSel);
                      e2.stopPropagation();
                    });
                    chWrap.appendChild(chBtn);
                  });
                }
              });
            });

            var addBtn = document.getElementById("add-group3");
            if (addBtn) {
              addBtn.addEventListener("click", function () {
                navState.groups = Array.isArray(navState.groups) ? navState.groups : [];
                navState.groups.push({ label: "Новая группа", items: [] });
                var ngi = navState.groups.length - 1;
                expandedGroups3[ngi] = true;
                setSelected3({ kind: "group", gi: ngi, ii: null, ci: null });
              });
            }

            if (!selected3 && groups.length) {
              selected3 = { kind: "group", gi: 0, ii: null, ci: null };
            }
          }

          function renderMain3() {
            main3.innerHTML = "";

            if (!selected3) {
              main3.innerHTML = '<div class="muted">Выбери узел слева.</div>';
              return;
            }

            if (selected3.kind === "group") {
              var g = navState.groups[selected3.gi];
              main3.innerHTML =
                '<div style="font-weight:900">Группа</div>' +
                '<div class="nav-field3"><label>Название</label></div>';
              var nameWrap = main3.querySelector(".nav-field3");
              nameWrap.appendChild(
                createInput(g.label || "", function (v) {
                  g.label = v;
                })
              );

              var actions = document.createElement("div");
              actions.className = "nav-s3__actions";
              actions.innerHTML =
                '<button class="btn-mini" id="up-group3">↑</button>' +
                '<button class="btn-mini" id="down-group3">↓</button>' +
                '<button class="btn-mini btn-mini--danger" id="del-group3">Удалить</button>' +
                '<button class="btn-mini" id="add-item3">+ Пункт</button>';
              main3.appendChild(actions);

              var upg = document.getElementById("up-group3");
              if (upg)
                upg.addEventListener("click", function () {
                  move(navState.groups, selected3.gi, -1);
                  selected3.gi = Math.max(0, selected3.gi - 1);
                  renderAll3();
                });
              var dowg = document.getElementById("down-group3");
              if (dowg)
                dowg.addEventListener("click", function () {
                  move(navState.groups, selected3.gi, 1);
                  selected3.gi = Math.min(navState.groups.length - 1, selected3.gi + 1);
                  renderAll3();
                });
              var delg = document.getElementById("del-group3");
              if (delg)
                delg.addEventListener("click", function () {
                  navState.groups.splice(selected3.gi, 1);
                  selected3 = null;
                  renderAll3();
                });
              var addItem = document.getElementById("add-item3");
              if (addItem)
                addItem.addEventListener("click", function () {
                  g.items = Array.isArray(g.items) ? g.items : [];
                  g.items.push({ type: "link", label: "Новый пункт", href: "index.html" });
                  setSelected3({ kind: "item", gi: selected3.gi, ii: g.items.length - 1, ci: null });
                  renderAll3();
                });
              return;
            }

            if (selected3.kind === "item") {
              var it = navState.groups[selected3.gi].items[selected3.ii];
              main3.innerHTML =
                '<div style="font-weight:900">Пункт</div>';

              // Type
              var typeWrap = document.createElement("div");
              typeWrap.className = "nav-field3";
              typeWrap.innerHTML = "<label>Тип</label>";
              typeWrap.appendChild(
                createSelect(
                  it.type || "link",
                  [
                    { value: "link", label: "Ссылка" },
                    { value: "expand", label: "Раскрывашка" },
                  ],
                  function (v) {
                    it.type = v;
                    if (v === "expand") {
                      it.children = Array.isArray(it.children) ? it.children : [];
                      if (!it.openOn) it.openOn = [];
                    } else {
                      delete it.children;
                      delete it.openOn;
                      delete it.id;
                    }
                    renderAll3();
                  }
                )
              );
              main3.appendChild(typeWrap);

              var labWrap = document.createElement("div");
              labWrap.className = "nav-field3";
              labWrap.innerHTML = "<label>Заголовок</label>";
              labWrap.appendChild(
                createInput(it.label || "", function (v) {
                  it.label = v;
                })
              );
              main3.appendChild(labWrap);

              var hrefWrap = document.createElement("div");
              hrefWrap.className = "nav-field3";
              hrefWrap.innerHTML = "<label>Href</label>";
              hrefWrap.appendChild(
                createInput(it.href || "", function (v) {
                  it.href = v;
                })
              );
              main3.appendChild(hrefWrap);

              var act = document.createElement("div");
              act.className = "nav-s3__actions";
              act.innerHTML =
                '<button class="btn-mini" id="up-item3">↑</button>' +
                '<button class="btn-mini" id="down-item3">↓</button>' +
                '<button class="btn-mini btn-mini--danger" id="del-item3">Удалить</button>';
              main3.appendChild(act);

              var upi = document.getElementById("up-item3");
              if (upi)
                upi.addEventListener("click", function () {
                  move(navState.groups[selected3.gi].items, selected3.ii, -1);
                  selected3.ii = Math.max(0, selected3.ii - 1);
                  renderAll3();
                });
              var dovi = document.getElementById("down-item3");
              if (dovi)
                dovi.addEventListener("click", function () {
                  move(navState.groups[selected3.gi].items, selected3.ii, 1);
                  selected3.ii = Math.min(navState.groups[selected3.gi].items.length - 1, selected3.ii + 1);
                  renderAll3();
                });
              var deli = document.getElementById("del-item3");
              if (deli)
                deli.addEventListener("click", function () {
                  navState.groups[selected3.gi].items.splice(selected3.ii, 1);
                  selected3 = null;
                  renderAll3();
                });

              if (it.type === "expand") {
                var chHdr = document.createElement("div");
                chHdr.style.fontWeight = "900";
                chHdr.style.marginTop = "14px";
                chHdr.textContent = "Подпункты";
                main3.appendChild(chHdr);

                var addCh = document.createElement("button");
                addCh.className = "btn-mini";
                addCh.style.marginTop = "10px";
                addCh.textContent = "+ Подпункт";
                main3.appendChild(addCh);

                addCh.addEventListener("click", function () {
                  it.children = Array.isArray(it.children) ? it.children : [];
                  it.children.push({ label: "Новый подпункт", href: "page-flash.html" });
                  setSelected3({ kind: "child", gi: selected3.gi, ii: selected3.ii, ci: it.children.length - 1 });
                  renderAll3();
                });

                var chList = document.createElement("div");
                chList.style.marginTop = "10px";
                var children = Array.isArray(it.children) ? it.children : [];
                children.forEach(function (ch, ci) {
                  var row = document.createElement("div");
                  row.className = "panel";
                  row.style.background = "#161b22";
                  row.style.marginTop = "10px";

                  row.innerHTML =
                    '<div style="font-weight:900;margin-bottom:8px">Подпункт ' +
                    (ci + 1) +
                    '</div>' +
                    '<div class="nav-field3"><label>Текст</label></div>' +
                    '<div class="nav-field3"><label>Href</label></div>';

                  var tWrap = row.querySelectorAll(".nav-field3")[0];
                  tWrap.appendChild(
                    createInput(ch.label || "", function (v) {
                      ch.label = v;
                    })
                  );
                  var hWrap = row.querySelectorAll(".nav-field3")[1];
                  hWrap.appendChild(
                    createInput(ch.href || "", function (v) {
                      ch.href = v;
                    })
                  );

                  var btnRow = document.createElement("div");
                  btnRow.className = "nav-s3__actions";
                  btnRow.innerHTML =
                    '<button class="btn-mini" data-upci="' +
                    ci +
                    '">↑</button>' +
                    '<button class="btn-mini" data-doci="' +
                    ci +
                    '">↓</button>' +
                    '<button class="btn-mini btn-mini--danger" data-delci="' +
                    ci +
                    '">Удалить</button>';
                  row.appendChild(btnRow);

                  btnRow.querySelector('[data-upci="' + ci + '"]').addEventListener("click", function () {
                    move(it.children, ci, -1);
                    setSelected3({ kind: "child", gi: selected3.gi, ii: selected3.ii, ci: Math.max(0, ci - 1) });
                    renderAll3();
                  });
                  btnRow.querySelector('[data-doci="' + ci + '"]').addEventListener("click", function () {
                    move(it.children, ci, 1);
                    setSelected3({ kind: "child", gi: selected3.gi, ii: selected3.ii, ci: Math.min(it.children.length - 1, ci + 1) });
                    renderAll3();
                  });
                  btnRow.querySelector('[data-delci="' + ci + '"]').addEventListener("click", function () {
                    it.children.splice(ci, 1);
                    selected3 = null;
                    renderAll3();
                  });

                  chList.appendChild(row);
                });

                main3.appendChild(chList);
              }
              return;
            }

            if (selected3.kind === "child") {
              main3.innerHTML = "<div style='font-weight:900'>Подпункт</div>";
              var parent = navState.groups[selected3.gi].items[selected3.ii];
              var ch = parent.children[selected3.ci];

              var tw = document.createElement("div");
              tw.className = "nav-field3";
              tw.innerHTML = "<label>Текст</label>";
              tw.appendChild(
                createInput(ch.label || "", function (v) {
                  ch.label = v;
                })
              );
              main3.appendChild(tw);

              var hw = document.createElement("div");
              hw.className = "nav-field3";
              hw.innerHTML = "<label>Href</label>";
              hw.appendChild(
                createInput(ch.href || "", function (v) {
                  ch.href = v;
                })
              );
              main3.appendChild(hw);

              var del = document.createElement("button");
              del.className = "btn-mini btn-mini--danger";
              del.style.marginTop = "12px";
              del.textContent = "Удалить подпункт";
              main3.appendChild(del);
              del.addEventListener("click", function () {
                parent.children.splice(selected3.ci, 1);
                selected3 = null;
                renderAll3();
              });
            }
          }

          function renderAll3() {
            renderSidebar3();
            renderMain3();
          }

          renderAll3();
        }

        function getSaveText() {
          if (isNavFile(currentPath)) {
            // Ensure required defaults for expand items.
            navState.groups.forEach(function (g) {
              (g.items || []).forEach(function (it) {
                if (it && it.type === "expand") ensureOpenOn(it);
              });
            });
            return JSON.stringify(navState, null, 2);
          }
          if (isPinoutFile(currentPath)) {
            return JSON.stringify(pinoutState, null, 2);
          }
          return String(textareaEl && textareaEl.value ? textareaEl.value : "");
        }

        async function loadSelected() {
          setErr("");
          currentPath = sel.value;
          // Friendly loading state.
          document.getElementById("editor").innerHTML =
            '<div class="muted" style="margin-top:14px">Загрузка...</div>';
          const j = await api(
            "/api/admin/contents?path=" +
              encodeURIComponent(currentPath) +
              "&branch=" +
              encodeURIComponent(branch)
          );
          var content = String(j.content || "");
          if (isNavFile(currentPath)) {
            var nav = null;
            try {
              nav = JSON.parse(content);
            } catch (e) {
              setErr(
                "Ошибка JSON в навигации: " +
                  (e && e.message ? e.message : String(e))
              );
              return;
            }
            renderNavEditor3(nav);
          } else if (isPinoutFile(currentPath)) {
            var pinout = null;
            try {
              pinout = JSON.parse(content);
            } catch (e) {
              setErr(
                "Ошибка JSON в pinout: " +
                  (e && e.message ? e.message : String(e))
              );
              return;
            }
            renderPinoutEditor(pinout);
          } else {
            renderTextEditor(content);
          }
        }

        document.getElementById("load").onclick = loadSelected;

        // Автозагрузка при выборе файла.
        sel.addEventListener("change", function () {
          loadSelected().catch(function (e) {
            setErr(e && e.message ? e.message : String(e));
          });
        });

        // Если уже выбрана навигация (например, после перезагрузки UI),
        // подгрузим сразу.
        if (isNavFile(sel.value) || isPinoutFile(sel.value)) {
          loadSelected().catch(function () {});
        }

        document.getElementById("save").onclick = async () => {
          setErr("");
          var text = getSaveText();
          JSON.parse(text);
          await api("/api/admin/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: currentPath, branch: branch, text: text }),
          });
          alert("Сохранено. Через минуту обновится сайт (если Actions/Pages включены).");
        };

        document.getElementById("out").onclick = () => {
          // Сессионная cookie будет жить до истечения; просто перезагрузим UI.
          location.reload();
        };
      }

      renderLogin("");
    </script>
  </body>
</html>`;
}

function adminFilesEditorHtml() {
  // File-based admin editor (HTML/CSS/JS/JSON/images) to edit the whole site.
  // UI runs on the same origin as the API (Timeweb), so cookies work over HTTP.
  var rawBase = "https://raw.githubusercontent.com/" + GH_OWNER + "/" + GH_REPO + "/" + GH_BRANCH + "/";

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ESP-HACK Admin (site editor)</title>
    <style>
      :root {
        --bg: #0d1117;
        --card: #161b22;
        --border: #30363d;
        --fg: #e6edf3;
        --muted: #8b949e;
        --muted2: #6e7781;
      }
      body {
        margin: 0;
        padding: 24px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: var(--fg);
        background: var(--bg);
      }
      .card {
        max-width: none;
        width: 100%;
        margin: 0;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 18px;
        box-sizing: border-box;
      }
      h1 { margin: 0 0 10px; font-size: 18px; }
      .muted { color: var(--muted); font-size: 13px; line-height: 1.4; }
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 14px;
        align-items: start;
        margin-top: 12px;
      }
      @media (max-width: 980px) {
        .layout { grid-template-columns: 1fr; }
      }
      .sidebar {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        background: #10151d;
        overflow: auto;
        max-height: 70vh;
      }
      .tree-item {
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        margin-top: 6px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
      }
      .tree-item:hover { border-color: var(--muted); }
      .tree-item--active { border-color: var(--muted); background: rgba(139,148,158,0.08); }

      .panel {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        background: #10151d;
      }
      label {
        display: block;
        font-weight: 800;
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 6px;
      }
      input[type="text"], textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #010409;
        color: var(--fg);
        padding: 10px 12px;
        font-size: 14px;
      }
      textarea {
        min-height: 420px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        margin-top: 10px;
      }
      button {
        cursor: pointer;
        padding: 10px 14px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: transparent;
        color: var(--fg);
        font-weight: 900;
      }
      button.primary {
        background: #2d333d;
      }
      button.danger {
        border-color: #d2a8a8;
        color: #f2cbdc;
      }
      .status {
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        color: var(--muted);
        font-size: 13px;
        min-height: 18px;
      }
      img.preview {
        max-width: 100%;
        border: 1px solid var(--border);
        border-radius: 10px;
      }
      .anim {
        animation: pop 180ms ease-out;
      }
      @keyframes pop {
        from { transform: translateY(-4px); opacity: 0.2; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Редактор контента вики</h1>
      <div class="muted">
        Редактируй только содержимое страниц вики (WYSIWYG) и загружай картинки через серверную прокси.
        Путь и ветка валидируются на сервере.
      </div>
      <div id="app"></div>
    </div>
    <script>
      const RAW_BASE = ${JSON.stringify(rawBase)};
      const GH_BRANCH_CLIENT = ${JSON.stringify(GH_BRANCH)};

      const appEl = document.getElementById("app");
      let currentPath = null;
      let currentMode = "text"; // text | image | pinout
      let pinoutState = null;

      function esc(s) {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;");
      }

      async function api(url, opts) {
        opts = opts || {};
        opts.credentials = "include";
        const r = await fetch(url, opts);
        let j = null;
        try { j = await r.json(); } catch (e) {}
        if (!r.ok) {
          throw new Error((j && (j.message || j.error)) ? (j.message || j.error) : ("HTTP " + r.status));
        }
        return j;
      }

      function renderLogin(errMsg) {
        appEl.innerHTML =
          '<div class="panel anim">' +
          '<div style="font-weight:900;margin-bottom:10px">Вход</div>' +
          '<div class="muted" style="margin-bottom:12px">Логин/пароль проверяются на сервере.</div>' +
          '<label>Логин</label><input id="u" type="text" />' +
          '<div style="height:10px"></div>' +
          '<label>Пароль</label><input id="p" type="password" />' +
          '<div class="row">' +
          '<button class="primary" id="loginBtn" type="button">Войти</button>' +
          '</div>' +
          '<div class="status" id="st">' + (errMsg ? esc(errMsg) : "") + '</div>' +
          "</div>";

        document.getElementById("loginBtn").addEventListener("click", async function () {
          const u = document.getElementById("u").value.trim();
          const p = document.getElementById("p").value;
          const st = document.getElementById("st");
          st.textContent = "";
          if (!u || !p) {
            st.textContent = "Введите логин и пароль";
            return;
          }
          try {
            await api("/api/admin/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: u, password: p }),
            });
            await boot();
          } catch (e) {
            st.textContent = e && e.message ? e.message : String(e);
          }
        });
      }

      function isBinaryImagePath(p) {
        const ext = String(p || "").toLowerCase();
        return (
          ext.endsWith(".png") ||
          ext.endsWith(".jpg") ||
          ext.endsWith(".jpeg") ||
          ext.endsWith(".webp") ||
          ext.endsWith(".gif") ||
          ext.endsWith(".bmp")
        );
      }

      function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      }

      function setStatus(msg) {
        let el = document.getElementById("status");
        if (!el) {
          el = document.createElement("div");
          el.id = "status";
          el.className = "status";
          document.querySelector(".panel")?.appendChild(el);
        }
        el.textContent = msg || "";
      }

      function isPinoutFile(p) {
        return String(p || "") === "data/pinout-modules.json";
      }

      var DEFAULT_PINOUT = {
        modules: {
          display: { targets: ["3V3", "GND", "G22", "G21", null, null, null] },
          buttons: { targets: ["G27", "G26", "G33", "G32", null, null, null] },
          cc1101: { targets: ["GND", "3V3", "G4", "G5", "G18", "G23", "G19"] },
          ir: { targets: ["G16", "G35", null, null, null, null, null] },
          gpio: { targets: ["G16", "G2", "G18", "G23", "G19", "G25", null] },
          sdcard: { targets: ["3V3", "G15", "G13", "G14", "G17", "GND", null] },
        },
        nrfWiring: ["GND", "3V3", "A", "B", "C", "D", "E"],
      };

      var PINOUT_MODULE_TEMPLATES = [
        { id: "display", slots: ["VCC", "GND", "SCL", "SDA", null, null, null] },
        { id: "buttons", slots: ["UP", "DOWN", "OK", "BACK", null, null, null] },
        { id: "cc1101", slots: ["1", "2", "3", "4", "5", "6", "7"] },
        { id: "ir", slots: ["IR-TX", "IR-RX", null, null, null, null, null] },
        { id: "gpio", slots: ["A", "B", "C", "D", "E", "F", null] },
        { id: "sdcard", slots: ["3v3", "CS", "MOSI", "CLK", "MISO", "GND", null] },
      ];

      var PINOUT_ALLOWED_TARGETS = (function () {
        var out = ["GND", "3V3"];
        for (var i = 0; i <= 39; i++) out.push("G" + i);
        return out;
      })();

      var NRF_ALLOWED_GPIO_ROWS = ["A", "B", "C", "D", "E"];

      function normalizePinTarget(v) {
        var s = v == null ? "" : String(v).trim();
        if (!s) return null;
        if (s.toLowerCase() === "3v3") s = "3V3";
        if (PINOUT_ALLOWED_TARGETS.indexOf(s) === -1) return null;
        return s;
      }

      function ensurePinoutShape(obj) {
        var pinout = obj && typeof obj === "object" ? obj : {};
        pinout.modules = pinout.modules && typeof pinout.modules === "object" ? pinout.modules : {};

        PINOUT_MODULE_TEMPLATES.forEach(function (m) {
          var existing = pinout.modules[m.id] && typeof pinout.modules[m.id] === "object" ? pinout.modules[m.id] : {};
          var targets = Array.isArray(existing.targets) ? existing.targets.slice() : [];
          while (targets.length < 7) targets.push(null);
          for (var i = 0; i < 7; i++) targets[i] = normalizePinTarget(targets[i]);
          pinout.modules[m.id] = { targets: targets };
        });

        var wiring = Array.isArray(pinout.nrfWiring) ? pinout.nrfWiring.slice() : DEFAULT_PINOUT.nrfWiring.slice();
        while (wiring.length < 7) wiring.push(null);
        wiring[0] = "GND";
        wiring[1] = "3V3";
        for (var j = 2; j < 7; j++) {
          var t = wiring[j];
          wiring[j] = NRF_ALLOWED_GPIO_ROWS.indexOf(t) !== -1 ? t : DEFAULT_PINOUT.nrfWiring[j];
        }
        pinout.nrfWiring = wiring;
        return pinout;
      }

      function renderPinoutEditor(pinout) {
        currentMode = "pinout";
        pinoutState = ensurePinoutShape(pinout);

        var editorWrap = document.getElementById("editorWrap");
        if (!editorWrap) return;
        editorWrap.innerHTML = "";

        document.getElementById("editorModeLabel").textContent =
          "Pinout: " + String(currentPath || "").split("/").pop();

        function createSelect(value, options, onChange) {
          var sel = document.createElement("select");
          sel.style.width = "100%";
          sel.style.boxSizing = "border-box";
          sel.style.border = "1px solid var(--border)";
          sel.style.borderRadius = "8px";
          sel.style.background = "#010409";
          sel.style.color = "var(--fg)";
          sel.style.padding = "10px 12px";
          sel.style.fontSize = "14px";
          options.forEach(function (o) {
            var opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === value) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener("change", function () {
            onChange(sel.value);
          });
          return sel;
        }

        var wrap = document.createElement("div");
        wrap.className = "panel";

        wrap.innerHTML =
          '<div style="font-weight:900">Конструктор распиновки Modules</div>' +
          '<div class="muted" style="margin-top:6px">Файл: <code>data/pinout-modules.json</code></div>' +
          '<div class="muted" style="margin-top:10px">В таблице выбирай назначение пина из списка. Пусто = —</div>';

        var pinTable = document.createElement("table");
        pinTable.style.width = "100%";
        pinTable.style.borderCollapse = "collapse";
        pinTable.style.marginTop = "12px";

        function cellBaseStyle(cell) {
          cell.style.border = "1px solid var(--border)";
          cell.style.padding = "8px 10px";
          cell.style.verticalAlign = "middle";
        }

        var thead = document.createElement("thead");
        var hr = document.createElement("tr");

        var th0 = document.createElement("th");
        th0.textContent = "Module";
        th0.scope = "col";
        cellBaseStyle(th0);
        th0.style.textAlign = "left";
        hr.appendChild(th0);

        for (var pi = 0; pi < 7; pi++) {
          var th = document.createElement("th");
          th.textContent = "Pin";
          th.scope = "col";
          cellBaseStyle(th);
          th.style.textAlign = "center";
          hr.appendChild(th);
        }
        thead.appendChild(hr);
        pinTable.appendChild(thead);

        var tbody = document.createElement("tbody");
        var nameByModuleId = {
          display: "Display",
          buttons: "Buttons",
          cc1101: "CC1101",
          ir: "IR",
          gpio: "GPIO",
          sdcard: "SD Card",
        };

        var targetOptions = PINOUT_ALLOWED_TARGETS.map(function (t) {
          return { value: t, label: t };
        });
        targetOptions.unshift({ value: "", label: "—" });

        PINOUT_MODULE_TEMPLATES.forEach(function (m) {
          var tr = document.createElement("tr");
          var th = document.createElement("th");
          th.scope = "row";
          th.textContent = nameByModuleId[m.id] || m.id;
          cellBaseStyle(th);
          th.style.textAlign = "left";
          tr.appendChild(th);

          var targets = pinoutState.modules[m.id].targets;
          for (var col = 0; col < 7; col++) {
            var td = document.createElement("td");
            cellBaseStyle(td);
            td.style.textAlign = "center";

            var slotLabel = m.slots[col];
            if (!slotLabel) {
              td.textContent = "—";
              td.style.color = "var(--muted)";
              tr.appendChild(td);
              continue;
            }

            var currentVal = targets[col] == null ? "" : String(targets[col]);
            var sel = createSelect(currentVal, targetOptions, function (v) {
              pinoutState.modules[m.id].targets[col] = normalizePinTarget(v);
            });
            td.appendChild(sel);
            tr.appendChild(td);
          }

          tbody.appendChild(tr);
        });

        pinTable.appendChild(tbody);
        wrap.appendChild(pinTable);

        var nrfPanel = document.createElement("div");
        nrfPanel.className = "panel";
        nrfPanel.style.marginTop = "10px";
        nrfPanel.innerHTML =
          '<div style="font-weight:900">NRF24 wiring</div>' +
          '<div class="muted" style="margin-top:6px">Pins 3..7 выбираются как GPIO-строки A–E (сверка по модулю GPIO).</div>';

        var nrfRows = [
          { idx: 2, label: "CE (pin 3)" },
          { idx: 3, label: "CSN (pin 4)" },
          { idx: 4, label: "SCK (pin 5)" },
          { idx: 5, label: "MOSI (pin 6)" },
          { idx: 6, label: "MISO (pin 7)" },
        ];

        var nrfOptions = NRF_ALLOWED_GPIO_ROWS.map(function (r) {
          return { value: r, label: r };
        });

        nrfRows.forEach(function (r) {
          var row = document.createElement("div");
          row.style.marginTop = "12px";

          var lab = document.createElement("div");
          lab.className = "muted";
          lab.style.fontSize = "13px";
          lab.style.marginBottom = "6px";
          lab.textContent = r.label + " -> GPIO row";
          row.appendChild(lab);

          var cur = pinoutState.nrfWiring[r.idx];
          if (NRF_ALLOWED_GPIO_ROWS.indexOf(cur) === -1) cur = "A";

          var sel2 = createSelect(cur, nrfOptions, function (v) {
            pinoutState.nrfWiring[r.idx] = v;
          });
          row.appendChild(sel2);
          nrfPanel.appendChild(row);
        });

        wrap.appendChild(nrfPanel);

        var actions = document.createElement("div");
        actions.className = "row";
        actions.style.marginTop = "12px";
        actions.innerHTML = '<button class="primary" type="button" id="savePinoutBtn">Сохранить</button>';
        wrap.appendChild(actions);

        editorWrap.appendChild(wrap);

        document.getElementById("savePinoutBtn").addEventListener("click", async function () {
          try {
            setStatus("Сохраняю pinout...");
            await api("/api/admin/commit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: currentPath,
                branch: GH_BRANCH_CLIENT,
                text: JSON.stringify(pinoutState, null, 2),
              }),
            });
            setStatus("Сохранено: " + currentPath);
          } catch (e) {
            setStatus(e && e.message ? e.message : String(e));
          }
        });
      }

      async function loadTextFile(path) {
        const j = await api(
          "/api/admin/contents?path=" + encodeURIComponent(path) + "&branch=" + encodeURIComponent(GH_BRANCH_CLIENT)
        );
        var raw = String(j.content || "");
        currentPath = path;

        if (isPinoutFile(path)) {
          var parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            parsed = DEFAULT_PINOUT;
          }
          renderPinoutEditor(parsed);
          setStatus("Pinout загружен: " + path);
          return;
        }

        // If this looks like a wiki page (contains .content__wrap), open it in WYSIWYG mode.
        // Otherwise fallback to plain textarea editor.
        var htmlTagIdx = raw.indexOf("<html");
        var prefix = htmlTagIdx >= 0 ? raw.slice(0, htmlTagIdx) : "<!DOCTYPE html>";
        var doc = null;
        var wrap = null;
        try {
          doc = new DOMParser().parseFromString(raw, "text/html");
          wrap = doc.querySelector(".content__wrap");
        } catch (e) {
          doc = null;
          wrap = null;
        }

        if (wrap) {
          currentMode = "wysiwyg";
          document.getElementById("editorModeLabel").textContent =
            "WYSIWYG: " + path.split("/").pop();

          var toolbar =
            '<div id="wys-toolbar" class="row" style="margin-top:0">' +
            '<button class="primary" type="button" data-cmd="bold">Жирный</button>' +
            '<button class="primary" type="button" data-cmd="italic">Курсив</button>' +
            '<button class="primary" type="button" data-cmd="underline">Подчерк.</button>' +
            '<button class="primary" type="button" data-cmd="h2">Заголовок</button>' +
            '<button class="primary" type="button" data-cmd="ul">Список</button>' +
            '<button class="primary" type="button" data-cmd="ol">Нум. список</button>' +
            '<button class="primary" type="button" data-cmd="link">Ссылка</button>' +
            '<button class="primary" type="button" data-cmd="image">Фото</button>' +
            '<button class="primary" type="button" data-cmd="resize">Размер img</button>' +
            '<button class="primary" type="button" data-cmd="table">Таблица</button>' +
            '<button class="primary" type="button" id="saveWysBtn">Сохранить</button>' +
            "</div>" +
            '<input id="imgPick" type="file" accept="image/*" style="display:none" />';

          document.getElementById("editorWrap").innerHTML =
            '<div style="margin-top:12px;padding:10px 12px">' +
            toolbar +
            "</div>" +
            '<div id="wys-editor" style="margin-top:12px">' +
            '<div id="wys" contenteditable="true" spellcheck="false" ' +
            'style="border:1px solid var(--border);border-radius:10px;background:#010409;padding:14px;min-height:420px;outline:none;overflow:auto"></div>' +
            "</div>";

          var wys = document.getElementById("wys");
          wys.innerHTML = wrap.innerHTML;

          function setStatusLocal(msg) {
            setStatus(msg);
          }

          function exec(cmd, value) {
            wys.focus();
            if (value != null) {
              document.execCommand(cmd, false, value);
            } else {
              document.execCommand(cmd, false);
            }
            wys.focus();
          }

          function insertNodeAtCursor(node) {
            wys.focus();
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            var range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
          }

          function getSelectedImg() {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            var node = sel.anchorNode;
            if (!node) return null;
            if (node.nodeType === 3) node = node.parentNode;
            while (node && node !== wys) {
              if (node.nodeType === 1 && String(node.tagName).toUpperCase() === "IMG") return node;
              node = node.parentNode;
            }
            return null;
          }

          function safeFileName(name) {
            return String(name || "image")
              .replace(/[^a-zA-Z0-9._-]/g, "_")
              .replace(/_+/g, "_");
          }

          // Wire toolbar.
          document.querySelectorAll("#wys-toolbar [data-cmd]").forEach(function (b) {
            b.addEventListener("click", function () {
              var cmd = b.getAttribute("data-cmd");
              if (cmd === "bold") return exec("bold");
              if (cmd === "italic") return exec("italic");
              if (cmd === "underline") return exec("underline");
              if (cmd === "h2") return exec("formatBlock", "h2");
              if (cmd === "ul") return exec("insertUnorderedList");
              if (cmd === "ol") return exec("insertOrderedList");
              if (cmd === "link") {
                var url = prompt("URL ссылки");
                if (!url) return;
                exec("createLink", url);
                return;
              }
              if (cmd === "table") {
                var rows = parseInt(prompt("Rows (например 3)"), 10);
                var cols = parseInt(prompt("Cols (например 3)"), 10);
                if (!rows || !cols) return;
                var html = "<table><tbody>";
                for (var r = 0; r < rows; r++) {
                  html += "<tr>";
                  for (var c = 0; c < cols; c++) {
                    html += "<td> </td>";
                  }
                  html += "</tr>";
                }
                html += "</tbody></table>";
                exec("insertHTML", html);
                return;
              }
              if (cmd === "resize") {
                var img = getSelectedImg();
                if (!img) {
                  alert("Выдели картинку (клик по ней).");
                  return;
                }
                var w = prompt("Ширина (px, пусто = не менять)", img.width || "");
                var h = prompt("Высота (px, пусто = не менять)", img.height || "");
                if (w && w.trim()) {
                  img.width = parseInt(w, 10);
                  img.style.width = w + "px";
                }
                if (h && h.trim()) {
                  img.height = parseInt(h, 10);
                  img.style.height = h + "px";
                }
                return;
              }
              if (cmd === "image") {
                document.getElementById("imgPick").click();
                return;
              }
            });
          });

          document.getElementById("imgPick").addEventListener("change", async function () {
            var f = document.getElementById("imgPick").files[0];
            if (!f) return;
            setStatusLocal("Загружаю изображение...");
            var buf = await f.arrayBuffer();
            var b64 = arrayBufferToBase64(buf);
            var fileName = safeFileName(f.name);
            var imgPath = "images/" + fileName;

            await api("/api/admin/commit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: imgPath,
                branch: GH_BRANCH_CLIENT,
                contentBase64: b64,
              }),
            });

            var img = document.createElement("img");
            // Keep correct relative image paths for en/... pages.
            var imgSrc = (currentPath && String(currentPath).startsWith("en/") ? "../images/" : "images/") + fileName;
            img.src = imgSrc;
            img.alt = fileName;
            insertNodeAtCursor(img);
            setStatusLocal("Изображение добавлено: " + imgPath);
          });

          document.getElementById("saveWysBtn").addEventListener("click", async function () {
            try {
              setStatusLocal("Сохраняю...");
              // Update original .content__wrap in doc and serialize full page.
              var docWrap = doc.querySelector(".content__wrap");
              if (!docWrap) throw new Error("content__wrap not found");
              docWrap.innerHTML = wys.innerHTML;
              var newHtml = prefix + doc.documentElement.outerHTML;

              await api("/api/admin/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  path: currentPath,
                  branch: GH_BRANCH_CLIENT,
                  text: newHtml,
                }),
              });
              setStatusLocal("Сохранено: " + currentPath);
            } catch (e) {
              setStatusLocal(e && e.message ? e.message : String(e));
            }
          });

          setStatus("Загружено в WYSIWYG: " + path);
          return;
        }

        // Fallback: raw textarea.
        currentMode = "text";
        currentPath = path;
        document.getElementById("editorModeLabel").textContent = "Текст: " + path.split("/").pop();
        document.getElementById("editorWrap").innerHTML =
          '<textarea id="ta" spellcheck="false"></textarea>' +
          '<div class="row">' +
          '<button class="primary" id="saveTextBtn" type="button">Сохранить</button>' +
          "</div>";
        document.getElementById("ta").value = raw;
        const btn = document.getElementById("saveTextBtn");
        if (btn) {
          btn.addEventListener("click", async function () {
            const text = document.getElementById("ta").value;
            setStatus("Сохраняю...");
            await api("/api/admin/commit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: currentPath,
                branch: GH_BRANCH_CLIENT,
                text: text,
              }),
            });
            setStatus("Сохранено: " + currentPath);
          });
        }
        setStatus("Загружено: " + path);
      }

      function loadImagePreview(path) {
        currentMode = "image";
        currentPath = path;
        document.getElementById("editorModeLabel").textContent = "Изображение: " + path.split("/").pop();

        const imgUrl = RAW_BASE + path;
        document.getElementById("editorWrap").innerHTML =
          '<div class="row" style="margin-top:0">' +
          '<img class="preview" src="' + esc(imgUrl) + '" alt="preview" />' +
          "</div>" +
          '<div style="height:12px"></div>' +
          '<label>Заменить изображение или создать новый файл</label>' +
          '<input id="imgFile" type="file" accept="image/*" />' +
          '<div style="height:10px"></div>' +
          '<label>Имя файла (опционально). Оставь пустым — перезапишет текущий путь.</label>' +
          '<input id="imgName" type="text" placeholder="например: my-photo.png" />' +
          '<div class="row"><button class="primary" id="saveImgBtn" type="button">Загрузить</button></div>';

        const btn = document.getElementById("saveImgBtn");
        if (btn) {
          btn.addEventListener("click", async function () {
            const f = document.getElementById("imgFile").files[0];
            if (!f) {
              setStatus("Выбери файл для загрузки");
              return;
            }
            setStatus("Кодирую файл...");
            const buf = await f.arrayBuffer();
            const b64 = arrayBufferToBase64(buf);
            const dir = String(currentPath || "").split("/").slice(0, -1).join("/");
            const oldName = String(currentPath || "").split("/").pop();
            const newName = (document.getElementById("imgName").value || "").trim();
            const targetName = newName || oldName;
            const targetPath = dir ? dir + "/" + targetName : targetName;
            await api("/api/admin/commit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: targetPath,
                branch: GH_BRANCH_CLIENT,
                contentBase64: b64,
              }),
            });
            currentPath = targetPath;
            setStatus("Загружено: " + currentPath + ". Обнови страницу (Pages/Actions) при необходимости.");
            // Refresh preview with cache-buster.
            const img = document.querySelector("img.preview");
            if (img) img.src = RAW_BASE + currentPath + "?t=" + Date.now();
          });
        }

        setStatus("Изображение: " + path);
      }

      async function loadFile(path) {
        if (isBinaryImagePath(path)) {
          loadImagePreview(path);
          return;
        }
        await loadTextFile(path);
      }

      async function renderTree(path, container, depth) {
        depth = depth || 0;
        container.innerHTML = "";
        const list = await api("/api/admin/list?path=" + encodeURIComponent(path) + "&branch=" + encodeURIComponent(GH_BRANCH_CLIENT));
        const items = Array.isArray(list.items) ? list.items : [];

        items.forEach(function (it) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "tree-item";
          btn.textContent = (it.type === "dir" ? "▸ " : "") + it.name;
          btn.style.marginLeft = String(depth * 10) + "px";

          btn.addEventListener("click", async function () {
            if (it.type === "dir") {
              // Expand/collapse with nested container.
              let next = btn.nextSibling;
              if (next && next.dataset && next.dataset.dir === it.path) {
                next.remove();
                return;
              }
              const wrap = document.createElement("div");
              wrap.dataset.dir = it.path;
              btn.insertAdjacentElement("afterend", wrap);
              wrap.style.marginTop = "6px";
              await renderTree(it.path, wrap, depth + 1);
              return;
            }
            await loadFile(it.path);
          });

          container.appendChild(btn);
        });
      }

      function renderEditorShell() {
        appEl.innerHTML =
          '<div class="layout">' +
          '<div class="sidebar">' +
          '<div style="font-weight:900;margin-bottom:8px">Редактор контента вики</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:10px">' +
          '<button type="button" class="primary" id="langRu" style="padding:8px 12px">RU</button>' +
          '<button type="button" id="langEn" style="padding:8px 12px">EN</button>' +
          "</div>" +
          '<div style="font-weight:900;margin-bottom:6px;color:var(--muted)">Разделы</div>' +
          '<div id="wikiNav"></div>' +
          "</div>" +
          '<div>' +
          '<div class="row" style="margin-top:0;margin-bottom:6px"><div id="editorModeLabel" style="font-weight:900">Слева выбери страницу</div></div>' +
          '<div id="editorWrap" style="margin-top:6px" class="muted">Загружаю контент...</div>' +
          '<div class="status" id="status" style="margin-top:12px"></div>' +
          "</div>" +
          "</div>";
      }

      let wikiNavDataRu = null;
      let wikiNavDataEn = null;
      let wikiLang = "ru";
      let wikiActiveBasePath = "index.html";

      function hrefToPagePath(href, lang) {
        const base = String(href || "").split("#")[0] || "index.html";
        if (lang === "en") {
          if (base === "index.html") return "en/index.html";
          if (base.startsWith("en/")) return base;
          return "en/" + base;
        }
        // ru
        if (base.startsWith("en/")) return base.slice(3);
        if (base === "index.html") return "index.html";
        return base;
      }

      async function loadWikiNav(lang) {
        if (lang === "ru") {
          if (!wikiNavDataRu) {
            const j = await api(
              "/api/admin/contents?path=" + encodeURIComponent("data/nav.json") + "&branch=" + encodeURIComponent(GH_BRANCH_CLIENT)
            );
            wikiNavDataRu = JSON.parse(String(j.content || "{}"));
          }
        } else {
          if (!wikiNavDataEn) {
            const j = await api(
              "/api/admin/contents?path=" + encodeURIComponent("data/nav-en.json") + "&branch=" + encodeURIComponent(GH_BRANCH_CLIENT)
            );
            wikiNavDataEn = JSON.parse(String(j.content || "{}"));
          }
        }
      }

      function renderWikiNav() {
        const holder = document.getElementById("wikiNav");
        if (!holder) return;
        holder.innerHTML = "";

        const nav = wikiLang === "en" ? wikiNavDataEn : wikiNavDataRu;
        const groups = (nav && Array.isArray(nav.groups) ? nav.groups : []) || [];

        groups.forEach(function (g) {
          const groupTitle = document.createElement("div");
          groupTitle.style.fontWeight = "900";
          groupTitle.style.margin = "10px 0 6px";
          groupTitle.style.color = "var(--muted)";
          groupTitle.textContent = String(g.label || "");
          holder.appendChild(groupTitle);

          const items = Array.isArray(g.items) ? g.items : [];
          items.forEach(function (it) {
            if (it.type === "expand" && Array.isArray(it.children) && it.children.length) {
              const parentBtn = document.createElement("button");
              parentBtn.type = "button";
              parentBtn.className = "tree-item";
              parentBtn.textContent = "▸ " + String(it.label || "");

              const childWrap = document.createElement("div");
              childWrap.style.marginLeft = "14px";
              childWrap.style.overflow = "hidden";
              childWrap.style.transition = "max-height 180ms ease";
              childWrap.style.maxHeight = "0px";

              let open = false;
              parentBtn.addEventListener("click", async function () {
                // If user clicks the parent, also open the corresponding page.
                await loadFile(hrefToPagePath(it.href || it.children[0].href, wikiLang));
                const base = String((it.href || it.children[0].href || "").split("#")[0] || "").replace(/^en\//, "");
                wikiActiveBasePath = base || wikiActiveBasePath;
                // Toggle children visibility.
                open = !open;
                parentBtn.textContent = (open ? "▾ " : "▸ ") + String(it.label || "");
                childWrap.style.maxHeight = open ? "600px" : "0px";
              });

              it.children.forEach(function (ch) {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "tree-item";
                b.textContent = String(ch.label || "");
                b.style.marginTop = "4px";
                b.style.padding = "7px 10px";
                b.addEventListener("click", async function () {
                  await loadFile(hrefToPagePath(ch.href || it.href, wikiLang));
                  wikiActiveBasePath = String((ch.href || it.href || "").split("#")[0] || "").replace(/^en\//, "") || wikiActiveBasePath;
                  renderWikiNav();
                });
                childWrap.appendChild(b);
              });

              holder.appendChild(parentBtn);
              holder.appendChild(childWrap);
            } else {
              const b = document.createElement("button");
              b.type = "button";
              b.className = "tree-item";
              const activeFile = wikiLang === "en" ? "en/" + wikiActiveBasePath : wikiActiveBasePath;
              const thisFile = hrefToPagePath(it.href || "index.html", wikiLang);
              if (String(thisFile) === String(activeFile)) b.classList.add("tree-item--active");
              b.textContent = String(it.label || "");
              b.addEventListener("click", async function () {
                await loadFile(hrefToPagePath(it.href || "index.html", wikiLang));
                wikiActiveBasePath = String((it.href || "index.html").split("#")[0] || "").replace(/^en\//, "") || wikiActiveBasePath;
                renderWikiNav();
              });
              holder.appendChild(b);
            }
          });
        });
      }

      async function selectInitialWiki() {
        // Default: RU index.html.
        wikiActiveBasePath = "index.html";
        document.getElementById("langRu").classList.add("primary");
        document.getElementById("langEn").classList.remove("primary");

        const editorWrap = document.getElementById("editorWrap");
        if (editorWrap) editorWrap.textContent = "Загружаю навигацию и контент...";

        // Even if the nav JSON fails, we still want the editor to load the default wiki page.
        try {
          await loadWikiNav("ru");
          wikiLang = "ru";
          renderWikiNav();
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          if (editorWrap) editorWrap.textContent = "Ошибка навигации: " + msg;
          setStatus("Ошибка навигации: " + msg);
        }

        try {
          await loadFile("index.html");
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          if (editorWrap) editorWrap.textContent = "Ошибка страницы: " + msg;
          setStatus("Ошибка страницы: " + msg);
          throw e;
        }
      }

      async function boot() {
        // Try authenticated state.
        try {
          await api("/api/admin/whoami", { method: "GET" });
        } catch (e) {
          renderLogin(e && e.message ? e.message : String(e));
          return;
        }

        renderEditorShell();
        setStatus("Подготовка...");
        const editorWrap = document.getElementById("editorWrap");
        if (editorWrap) editorWrap.textContent = "Загружаю навигацию и контент...";

        document.getElementById("langRu").addEventListener("click", async function () {
          if (wikiLang === "ru") return;
          wikiLang = "ru";
          document.getElementById("langRu").classList.add("primary");
          document.getElementById("langEn").classList.remove("primary");
          await loadWikiNav("ru");
          renderWikiNav();
          await loadFile(wikiActiveBasePath === "index.html" ? "index.html" : wikiActiveBasePath);
        });

        document.getElementById("langEn").addEventListener("click", async function () {
          if (wikiLang === "en") return;
          wikiLang = "en";
          document.getElementById("langEn").classList.add("primary");
          document.getElementById("langRu").classList.remove("primary");
          await loadWikiNav("en");
          renderWikiNav();
          await loadFile("en/" + wikiActiveBasePath);
        });

        try {
          await selectInitialWiki();
          setStatus("");
        } catch (e) {
          // selectInitialWiki already set detailed error in UI
          setStatus("Ошибка загрузки страницы. Проверь консоль.");
        }
      }

      boot();
    </script>
  </body>
</html>`;
}

app.get("/admin/", function (req, res) {
  res.set("Cache-Control", "no-store");
  res.type("html").send(adminFilesEditorHtml());
});

app.post("/api/admin/login", async function (req, res) {
  const body = req.body || {};
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) return res.status(400).json({ ok: false, message: "Missing credentials" });
  if (!ADMIN_USERS || !Object.keys(ADMIN_USERS).length) {
    return res.status(500).json({ ok: false, message: "ADMIN_USERS_JSON not configured on server" });
  }

  // SECURITY NOTE:
  // This demo compares passwords in constant-time on the server. Put real secrets on your server env.
  const expected = ADMIN_USERS[username];
  if (!expected || !constTimeEq(String(expected), password)) {
    return res.status(401).json({ ok: false, message: "Invalid credentials" });
  }

  req.session.adminUser = username;
  res.json({ ok: true, user: username });
});

app.get("/api/admin/whoami", requireAuth, function (req, res) {
  res.json({ ok: true, user: req.session.adminUser });
});

app.get("/api/admin/list", requireAuth, async function (req, res) {
  try {
    const branch = String(req.query.branch || GH_BRANCH);
    if (branch !== GH_BRANCH) return res.status(403).json({ ok: false, message: "Branch not allowed" });
    const inputPath = String(req.query.path || "").replace(/^\.?\//, "");

    // Empty path = repository root
    if (!inputPath) {
      const ghPath = "/repos/" + encodeURIComponent(GH_OWNER) + "/" + encodeURIComponent(GH_REPO) + "/contents?ref=" + encodeURIComponent(branch);
      const j = await ghFetchJson(ghPath, GITHUB_TOKEN);
      if (!Array.isArray(j)) return res.status(500).json({ ok: false, message: "Unexpected root list response" });
      return res.json({
        ok: true,
        path: "",
        branch: branch,
        items: j.map(function (it) {
          return {
            name: it.name,
            path: it.path,
            type: it.type,
            sha: it.sha,
            download_url: it.download_url,
            size: it.size,
            content_type: it.content_type,
          };
        }),
      });
    }

    const safe = validatePath(inputPath);
    if (!safe) return res.status(403).json({ ok: false, message: "Path not allowed" });

    const ghPath = "/repos/" + encodeURIComponent(GH_OWNER) + "/" + encodeURIComponent(GH_REPO) + "/contents/" + encodeGitHubPath(safe) + "?ref=" + encodeURIComponent(branch);
    const j = await ghFetchJson(ghPath, GITHUB_TOKEN);

    // Contents API returns object for file; array for directory.
    if (!Array.isArray(j)) {
      return res.json({
        ok: true,
        path: safe,
        branch: branch,
        items: [],
        file: true,
      });
    }

    return res.json({
      ok: true,
      path: safe,
      branch: branch,
      items: j.map(function (it) {
        return {
          name: it.name,
          path: it.path,
          type: it.type,
          sha: it.sha,
          download_url: it.download_url,
          size: it.size,
          content_type: it.content_type,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
});

function validatePath(inputPath) {
  var p = String(inputPath || "").replace(/^\.?\//, "");
  if (!p) return "";
  if (p.indexOf("..") !== -1) return "";
  if (p.indexOf("\0") !== -1) return "";
  if (p.indexOf("node_modules/") !== -1) return "";
  if (p.indexOf(".github/") !== -1) return "";
  if (p.indexOf("server/") !== -1) return "";

  // Allow editing "site" content. Keep server-only code out.
  var allowedPrefixes = ["data/", "en/", "css/", "js/", "images/"];
  for (var i = 0; i < allowedPrefixes.length; i++) {
    var pref = allowedPrefixes[i];
    if (p.indexOf(pref) === 0) return p;
    // Also allow listing directories (e.g. "data", "images").
    var trimmed = pref.slice(0, -1);
    if (p === trimmed) return p;
  }

  // Root pages and common assets.
  if (p === "index.html" || p.startsWith("page-") || p.endsWith(".html") || p.endsWith(".md")) return p;
  return "";
}

app.get("/api/admin/contents", requireAuth, async function (req, res) {
  try {
    const path = validatePath(req.query.path);
    const branch = String(req.query.branch || GH_BRANCH);
    if (!path) return res.status(403).json({ ok: false, message: "Path not allowed" });
    if (branch !== GH_BRANCH) return res.status(403).json({ ok: false, message: "Branch not allowed" });
    if (!GH_OWNER || !GH_REPO || !GITHUB_TOKEN) return res.status(500).json({ ok: false, message: "GitHub env not configured" });

    const ghPath = "/repos/" + encodeURIComponent(GH_OWNER) + "/" + encodeURIComponent(GH_REPO) + "/contents/" + encodeGitHubPath(path);
    const j = await ghFetchJson(ghPath + "?ref=" + encodeURIComponent(branch), GITHUB_TOKEN);
    const content = decodeGithubContent(j.content || "");
    res.json({ ok: true, path, branch, content });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
});

app.post("/api/admin/commit", requireAuth, async function (req, res) {
  try {
    const body = req.body || {};
    const path = validatePath(body.path);
    const branch = String(body.branch || GH_BRANCH);
    const text = String(body.text || "");
    const contentBase64 = body.contentBase64 != null ? String(body.contentBase64) : "";
    const isBinary = !!contentBase64;

    if (!path) return res.status(403).json({ ok: false, message: "Path not allowed" });
    if (branch !== GH_BRANCH) return res.status(403).json({ ok: false, message: "Branch not allowed" });
    if (!GH_OWNER || !GH_REPO || !GITHUB_TOKEN) return res.status(500).json({ ok: false, message: "GitHub env not configured" });

    // Load sha from GitHub.
    const ghPath =
      "/repos/" +
      encodeURIComponent(GH_OWNER) +
      "/" +
      encodeURIComponent(GH_REPO) +
      "/contents/" +
      encodeGitHubPath(path) +
      "?ref=" +
      encodeURIComponent(branch);

    const putPath = "/repos/" + encodeURIComponent(GH_OWNER) + "/" + encodeURIComponent(GH_REPO) + "/contents/" + encodeGitHubPath(path);

    // For existing files, GitHub requires sha. For new files, sha should be omitted.
    let sha = null;
    try {
      const current = await ghFetchJson(ghPath, GITHUB_TOKEN);
      sha = current && current.sha;
    } catch (e) {
      if (e && e.status === 404) sha = null;
      else throw e;
    }

    const payload = {
      message: (isBinary ? "Upload " : "Update ") + path + " via Timeweb admin proxy",
      content: isBinary ? contentBase64 : Buffer.from(text, "utf8").toString("base64"),
      branch: branch,
    };

    if (sha) payload.sha = sha;

    await ghFetchJson(putPath, GITHUB_TOKEN, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
});

app.listen(PORT, function () {
  // eslint-disable-next-line no-console
  console.log("Admin API listening on port " + PORT);
});

