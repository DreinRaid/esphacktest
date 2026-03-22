(function () {
  var root = document.getElementById("admin-root");
  if (!root) return;

  var SESSION_PANEL = "wiki_admin_panel_ok";
  var SESSION_GH_USER = "wiki_admin_gh_user";
  var SESSION_GH_TOKEN = "wiki_admin_gh_token";
  var SESSION_REPO = "wiki_admin_repo";
  var SESSION_BRANCH = "wiki_admin_branch";

  var EDITABLE = [
    { path: "data/github-release.json", label: "Релизы GitHub (конфиг API)" },
    { path: "data/nav.json", label: "Меню навигации (RU)" },
    { path: "data/nav-en.json", label: "Меню навигации (EN)" },
    { path: "data/downloads.json", label: "Ручной список файлов" },
  ];

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

  function utf8ToB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function b64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  function ghHeaders(token) {
    var h = new Headers();
    h.set("Authorization", "token " + token);
    h.set("Accept", "application/vnd.github+json");
    h.set("X-GitHub-Api-Version", "2022-11-28");
    return h;
  }

  function ghFetch(path, token, opts) {
    opts = opts || {};
    var h = ghHeaders(token);
    if (opts.headers) {
      opts.headers.forEach(function (value, name) {
        h.set(name, value);
      });
    }
    return fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: h,
      body: opts.body,
    });
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_PANEL);
    sessionStorage.removeItem(SESSION_GH_USER);
    sessionStorage.removeItem(SESSION_GH_TOKEN);
    sessionStorage.removeItem(SESSION_REPO);
    sessionStorage.removeItem(SESSION_BRANCH);
  }

  function renderError(msg) {
    return '<div class="admin-error" role="alert">' + esc(msg) + "</div>";
  }

  function renderPanelGate(gate, err) {
    var hint = gate.githubLoginHint
      ? '<p class="admin-muted">Подсказка логина GitHub: <code>' +
        esc(gate.githubLoginHint) +
        "</code></p>"
      : "";
    root.innerHTML =
      '<div class="admin-wrap">' +
      '<div class="admin-card">' +
      "<h1>Вход в админку</h1>" +
      "<p>Сначала логин и пароль из настроек сайта (<code>data/admin-gate.json</code>). После этого попросим токен GitHub для сохранения файлов.</p>" +
      hint +
      '<form id="gate-form">' +
      '<div class="admin-field"><label for="pl">Логин панели</label><input id="pl" name="pl" type="text" autocomplete="username" required /></div>' +
      '<div class="admin-field"><label for="pp">Пароль панели</label><input id="pp" name="pp" type="password" autocomplete="current-password" required /></div>' +
      '<div class="admin-actions"><button type="submit" class="admin-btn admin-btn--primary">Далее</button></div>' +
      "</form>" +
      (err ? renderError(err) : "") +
      "</div></div>";

    document.getElementById("gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pl = document.getElementById("pl").value.trim();
      var pp = document.getElementById("pp").value;
      if (pl !== gate.panelLogin || pp !== gate.panelPassword) {
        renderPanelGate(gate, "Неверный логин или пароль.");
        return;
      }
      sessionStorage.setItem(SESSION_PANEL, "1");
      renderGhGate(gate, "", gate.githubLoginHint || "");
    });
  }

  function renderGhGate(gate, err, prefillUser) {
    var u = prefillUser || gate.githubLoginHint || "";
    var backBtn = gate.usePanel
      ? '<button type="button" class="admin-btn" id="btn-back">Назад</button>'
      : "";
    root.innerHTML =
      '<div class="admin-wrap">' +
      '<div class="admin-card">' +
      "<h1>Доступ к GitHub</h1>" +
      "<p>Нужны <strong>логин GitHub</strong> и <strong>Personal Access Token</strong> с правом записи в репозиторий вики (классический токен: scope <code>repo</code>). Токен в репозиторий не кладётся — только вводишь здесь.</p>" +
      '<form id="gh-form">' +
      '<div class="admin-field"><label for="ghu">Логин GitHub</label><input id="ghu" name="ghu" type="text" autocomplete="username" required value="' +
      esc(u) +
      '" /></div>' +
      '<div class="admin-field"><label for="ght">Токен</label><input id="ght" name="ght" type="password" autocomplete="off" required /></div>' +
      '<div class="admin-actions">' +
      '<button type="submit" class="admin-btn admin-btn--primary">Войти</button>' +
      backBtn +
      "</div></form>" +
      (err ? renderError(err) : "") +
      '<p class="admin-muted">Токен хранится только в памяти браузера (session), пока открыта вкладка.</p>' +
      "</div></div>";

    var backEl = document.getElementById("btn-back");
    if (backEl) {
      backEl.addEventListener("click", function () {
        sessionStorage.removeItem(SESSION_PANEL);
        loadGate();
      });
    }

    document.getElementById("gh-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var ghu = document.getElementById("ghu").value.trim();
      var ght = document.getElementById("ght").value.trim();
      if (!ghu || !ght) return;

      ghFetch("/user", ght)
        .then(function (r) {
          if (!r.ok) throw new Error("Токен не подходит или нет сети.");
          return r.json();
        })
        .then(function (user) {
          if (user.login.toLowerCase() !== ghu.toLowerCase()) {
            throw new Error("Логин не совпадает с владельцем токена.");
          }
          return fetch(dataPrefix() + "data/github-release.json", { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("Не удалось прочитать data/github-release.json");
            return r.json();
          });
        })
        .then(function (cfg) {
          var owner = cfg.owner;
          var repo = cfg.repo;
          if (!owner || !repo) throw new Error("В github-release.json нет owner/repo");
          sessionStorage.setItem(SESSION_GH_USER, ghu);
          sessionStorage.setItem(SESSION_GH_TOKEN, ght);
          sessionStorage.setItem(SESSION_REPO, owner + "/" + repo);
          sessionStorage.setItem(SESSION_BRANCH, gate.branch || "main");
          renderEditor(owner, repo, ght, gate.branch || "main");
        })
        .catch(function (err) {
          renderGhGate(gate, err.message || String(err), ghu);
        });
    });
  }

  function renderEditor(owner, repo, token, branch) {
    var opts = EDITABLE.map(function (f) {
      return '<option value="' + esc(f.path) + '">' + esc(f.label) + "</option>";
    }).join("");

    root.innerHTML =
      '<div class="admin-wrap">' +
      '<div class="admin-card">' +
      "<h1>Редактор данных</h1>" +
      "<p>Репозиторий: <strong>" +
      esc(owner + "/" + repo) +
      "</strong> · ветка <code>" +
      esc(branch) +
      "</code></p>" +
      '<div class="admin-field"><label for="filesel">Файл</label><select id="filesel">' +
      opts +
      "</select></div>" +
      '<div class="admin-actions">' +
      '<button type="button" class="admin-btn admin-btn--primary" id="btn-load">Загрузить</button>' +
      '<button type="button" class="admin-btn admin-btn--primary" id="btn-save">Сохранить</button>' +
      '<button type="button" class="admin-btn" id="btn-out">Выйти</button>' +
      "</div>" +
      ("") +
      "</div>" +
      '<div class="admin-card admin-editor">' +
      '<label for="jsonarea" class="admin-field" style="margin-bottom:8px">Содержимое (JSON)</label>' +
      '<textarea id="jsonarea" spellcheck="false"></textarea>' +
      '<div id="edit-err"></div>' +
      "</div>" +
      "</div>";

    var ta = document.getElementById("jsonarea");
    var sel = document.getElementById("filesel");
    var fileSha = null;

    function showErr(msg) {
      var el = document.getElementById("edit-err");
      el.innerHTML = msg ? renderError(msg) : "";
    }

    function loadFile() {
      showErr("");
      var path = sel.value;
      ghFetch("/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + encodeURIComponent(branch), token)
        .then(function (r) {
          if (!r.ok) throw new Error("Не удалось загрузить файл (" + r.status + ")");
          return r.json();
        })
        .then(function (data) {
          if (!data.content) throw new Error("Пустой ответ API");
          fileSha = data.sha;
          ta.value = b64ToUtf8(data.content.replace(/\n/g, ""));
        })
        .catch(function (e) {
          ta.value = "";
          fileSha = null;
          showErr(e.message || String(e));
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
      if (!fileSha) {
        showErr("Сначала нажми «Загрузить», чтобы получить sha файла.");
        return;
      }
      var body = JSON.stringify({
        message: "Update " + path + " via wiki admin",
        content: utf8ToB64(text),
        sha: fileSha,
        branch: branch,
      });

      ghFetch("/repos/" + owner + "/" + repo + "/contents/" + path, token, {
        method: "PUT",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: body,
      })
        .then(function (r) {
          if (!r.ok) {
            return r.json().then(function (j) {
              throw new Error(j.message || "Ошибка " + r.status);
            });
          }
          return r.json();
        })
        .then(function (res) {
          fileSha = res.content && res.content.sha;
          showErr("");
          alert("Сохранено. Через минуту обновится сайт (если включены Actions / Pages).");
        })
        .catch(function (e) {
          showErr(e.message || String(e));
        });
    });

    document.getElementById("btn-out").addEventListener("click", function () {
      clearSession();
      loadGate();
    });

    sel.addEventListener("change", function () {
      ta.value = "";
      fileSha = null;
      showErr("");
    });

    loadFile();
  }

  function defaultGate() {
    return {
      usePanel: false,
      branch: "main",
      githubLoginHint: "",
    };
  }

  function normalizeGate(raw) {
    if (!raw || !raw.panelLogin || raw.panelPassword == null || raw.panelPassword === "") {
      var g = defaultGate();
      if (raw && raw.githubLoginHint) g.githubLoginHint = raw.githubLoginHint;
      if (raw && raw.branch) g.branch = raw.branch;
      return g;
    }
    return {
      usePanel: true,
      panelLogin: raw.panelLogin,
      panelPassword: raw.panelPassword,
      branch: raw.branch || "main",
      githubLoginHint: raw.githubLoginHint || "",
    };
  }

  function loadGate() {
    fetch(dataPrefix() + "data/admin-gate.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return defaultGate();
        return r.json().then(normalizeGate);
      })
      .then(function (gate) {
        var tok = sessionStorage.getItem(SESSION_GH_TOKEN);
        var repo = sessionStorage.getItem(SESSION_REPO);
        var br = sessionStorage.getItem(SESSION_BRANCH) || gate.branch || "main";
        if (tok && repo) {
          var parts = repo.split("/");
          renderEditor(parts[0], parts[1], tok, br);
          return;
        }
        if (gate.usePanel) {
          if (sessionStorage.getItem(SESSION_PANEL) === "1") {
            renderGhGate(gate, "", sessionStorage.getItem(SESSION_GH_USER) || gate.githubLoginHint || "");
            return;
          }
          renderPanelGate(gate, "");
          return;
        }
        renderGhGate(gate, "", gate.githubLoginHint || "");
      })
      .catch(function (e) {
        root.innerHTML =
          '<div class="admin-wrap"><div class="admin-card">' +
          renderError(e.message || String(e)) +
          "</div></div>";
      });
  }

  loadGate();
})();
