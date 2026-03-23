(function () {
  var root = document.getElementById("admin-root");
  if (!root) return;

  var EDITABLE = [
    { path: "data/github-release.json", label: "Релизы GitHub (конфиг API)" },
    { path: "data/nav.json", label: "Меню навигации (RU)" },
    { path: "data/nav-en.json", label: "Меню навигации (EN)" },
    { path: "data/downloads.json", label: "Ручной список файлов" },
  ];

  var gateBranch = "main";

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function dataPrefix() {
    var p = location.pathname;
    if (p.indexOf("/en/") !== -1) return "../";
    if (p.indexOf("/admin/") !== -1) return "../";
    return "";
  }

  function renderError(msg) {
    return '<div class="admin-error" role="alert">' + esc(msg) + "</div>";
  }

  function renderLogin(apiBase, err) {
    root.innerHTML =
      '<div class="admin-wrap">' +
      '<div class="admin-card">' +
      "<h1>Вход в админку</h1>" +
      '<p>Включена серверная авторизация. Введите логин и пароль.</p>' +
      '<form id="login-form">' +
      '<div class="admin-field"><label for="ad-user">Логин</label><input id="ad-user" name="ad-user" type="text" autocomplete="username" required /></div>' +
      '<div class="admin-field"><label for="ad-pass">Пароль</label><input id="ad-pass" name="ad-pass" type="password" autocomplete="current-password" required /></div>' +
      '<div class="admin-actions"><button type="submit" class="admin-btn admin-btn--primary">Войти</button></div>' +
      "</form>" +
      (err ? renderError(err) : "") +
      "</div></div>";

    document.getElementById("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var u = document.getElementById("ad-user").value.trim();
      var p = document.getElementById("ad-pass").value;
      if (!u || !p) return;

      fetch(apiBase + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: u, password: p }),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || "Login failed"); });
          return r.json();
        })
        .then(function () {
          renderEditor(apiBase);
        })
        .catch(function (err2) {
          renderLogin(apiBase, err2.message || String(err2));
        });
    });
  }

  function renderEditor(apiBase) {
    root.innerHTML =
      '<div class="admin-wrap">' +
      '<div class="admin-card">' +
      "<h1>Редактор данных</h1>" +
      '<div class="admin-field"><label for="filesel">Файл</label><select id="filesel"></select></div>' +
      '<div class="admin-actions">' +
      '<button type="button" class="admin-btn admin-btn--primary" id="btn-load">Загрузить</button>' +
      '<button type="button" class="admin-btn admin-btn--primary" id="btn-save">Сохранить</button>' +
      '<button type="button" class="admin-btn" id="btn-out">Выйти</button>' +
      "</div>" +
      '<div class="admin-field" style="margin-top:10px"><small class="admin-muted">Токен GitHub не используется в браузере: чтение/запись делает сервер.</small></div>' +
      "</div>" +
      '<div class="admin-card admin-editor">' +
      '<label for="jsonarea" class="admin-field" style="margin-bottom:8px">Содержимое (JSON)</label>' +
      '<textarea id="jsonarea" spellcheck="false"></textarea>' +
      '<div id="edit-err"></div>' +
      "</div>" +
      "</div>";

    var sel = document.getElementById("filesel");
    var ta = document.getElementById("jsonarea");
    var fileSha = null; // теперь не нужен: sha делает сервер

    sel.innerHTML = EDITABLE.map(function (f) {
      return '<option value="' + esc(f.path) + '">' + esc(f.label) + "</option>";
    }).join("");

    function showErr(msg) {
      var el = document.getElementById("edit-err");
      el.innerHTML = msg ? renderError(msg) : "";
    }

    function getBranch() {
      return gateBranch;
    }

    function loadFile() {
      showErr("");
      var path = sel.value;
      fetch(
        apiBase +
          "/api/admin/contents?path=" +
          encodeURIComponent(path) +
          "&branch=" +
          encodeURIComponent(getBranch()),
        { credentials: "include" }
      )
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || "Load failed"); });
          return r.json();
        })
        .then(function (j) {
          ta.value = String(j.content || "");
          showErr("");
          fileSha = null;
        })
        .catch(function (err) {
          ta.value = "";
          fileSha = null;
          showErr(err.message || String(err));
        });
    }

    document.getElementById("btn-load").addEventListener("click", loadFile);

    document.getElementById("btn-save").addEventListener("click", function () {
      showErr("");
      var path = sel.value;
      var text = ta.value;
      try {
        JSON.parse(text);
      } catch (e) {
        showErr("Невалидный JSON: " + e.message);
        return;
      }

      fetch(apiBase + "/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ path: path, branch: getBranch(), text: text }),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || "Save failed"); });
          return r.json();
        })
        .then(function () {
          showErr("");
          alert("Сохранено. Через минуту обновится сайт (если включены Actions / Pages).");
        })
        .catch(function (err2) {
          showErr(err2.message || String(err2));
        });
    });

    document.getElementById("btn-out").addEventListener("click", function () {
      // Просто перезагружаем страницу, сессия будет сброшена на сервере при закрытии/истечении.
      location.reload();
    });

    sel.addEventListener("change", function () {
      ta.value = "";
      showErr("");
    });
  }

  function loadGate() {
    var prefix = dataPrefix();

    function tryLoad(file) {
      return fetch(prefix + "data/" + file, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("no " + file);
        return r.json();
      });
    }

    // admin-gate.json игнорируется в git (секреты не деплоим), поэтому fallback на example.
    return tryLoad("admin-gate.json").catch(function () {
      return tryLoad("admin-gate.example.json").catch(function () {
        return {};
      });
    });
  }

  loadGate().then(function (gate) {
    var apiBase =
      gate && gate.timewebApiBaseUrl
        ? String(gate.timewebApiBaseUrl).trim().replace(/\/+$/, "")
        : "";

    if (!apiBase) {
      root.innerHTML =
        '<div class="admin-wrap"><div class="admin-card">' +
        "<h1>Настройка</h1>" +
        "<p>Добавьте в <code>data/admin-gate.json</code> поле <code>timewebApiBaseUrl</code>, например:</p>" +
        '<pre style="white-space:pre-wrap;word-break:break-word;background:var(--gh-canvas-subtle);padding:12px;border:1px solid var(--gh-border);border-radius:8px;margin:0">{"timewebApiBaseUrl":"https://your-timeweb-domain.com"}</pre>' +
        "</div></div>";
      return;
    }

    gateBranch =
      gate && gate.branch ? String(gate.branch).trim() || "main" : "main";
    renderLogin(apiBase, "");
  });
})();

