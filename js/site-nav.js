(function () {
  function dataBase() {
    return location.pathname.indexOf("/en/") !== -1 ? "../" : "";
  }

  function enNavFile() {
    return dataBase() + "data/" + (location.pathname.indexOf("/en/") !== -1 ? "nav-en.json" : "nav.json");
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function currentFile() {
    var p = (location.pathname.split("/").pop() || "").toLowerCase();
    if (!p || p === "") return "index.html";
    return p;
  }

  function currentHash() {
    return (location.hash || "").toLowerCase();
  }

  function splitHref(href) {
    var h = String(href || "");
    var i = h.indexOf("#");
    var file = (i >= 0 ? h.slice(0, i) : h).toLowerCase();
    var hash = i >= 0 ? h.slice(i).toLowerCase() : "";
    return { file: file, hash: hash };
  }

  function isCurrentPage(href, cf, ch) {
    var p = splitHref(href);
    if (!p.file) return false;
    if (p.file !== cf) return false;
    if (!p.hash) return true;
    return p.hash === ch;
  }

  function isParentCurrent(href, cf) {
    var p = splitHref(href);
    return p.file === cf;
  }

  var chevronSvg =
    '<svg class="nav-expandable__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 1L7 5l-4.5 4V1z" fill="currentColor"/></svg>';

  function renderChildLink(c, cf, ch) {
    var cur = isCurrentPage(c.href, cf, ch) ? ' aria-current="page"' : "";
    return "<li><a href=\"" + esc(c.href) + "\"" + cur + ">" + esc(c.label) + "</a></li>";
  }

  function openOnList(on) {
    if (!on || !on.length) return [];
    return on
      .map(function (x) {
        if (typeof x === "string") return x.toLowerCase();
        if (x && typeof x.file === "string") return String(x.file).toLowerCase();
        return "";
      })
      .filter(Boolean);
  }

  function renderExpand(item, cf, ch) {
    var id = "nav-sub-" + esc(item.id);
    var open = openOnList(item.openOn).some(function (f) {
      return f === cf;
    });
    var hiddenAttr = open ? "" : " hidden";
    var expanded = open ? "true" : "false";
    var parentCur = isParentCurrent(item.href, cf) ? ' aria-current="page"' : "";
    var kids = (item.children || []).map(function (c) {
      return renderChildLink(c, cf, ch);
    }).join("");
    var subLabel =
      location.pathname.indexOf("/en/") !== -1 ? "Subsections: " : "Подразделы: ";
    return (
      '<li class="nav-expandable">' +
      '<div class="nav-expandable__row">' +
      '<a href="' +
      esc(item.href) +
      '" class="nav-expandable__link"' +
      parentCur +
      ">" +
      esc(item.label) +
      "</a>" +
      '<button type="button" class="nav-expandable__toggle" aria-expanded="' +
      expanded +
      '" aria-controls="' +
      id +
      '" aria-label="' +
      esc(subLabel + item.label) +
      '">' +
      chevronSvg +
      "</button></div>" +
      '<ul id="' +
      id +
      '" class="nav-sub"' +
      hiddenAttr +
      ">" +
      kids +
      "</ul></li>"
    );
  }

  function renderItem(item, cf, ch) {
    var hasKids = item.children && item.children.length > 0;
    if (item.type === "expand") {
      if (!hasKids) {
        return renderLinkItem(item, cf, ch);
      }
      return renderExpand(normalizeExpand(item), cf, ch);
    }
    if (hasKids) {
      return renderExpand(normalizeExpand(item), cf, ch);
    }
    return renderLinkItem(item, cf, ch);
  }

  function normalizeExpand(item) {
    var ex = Object.assign({}, item);
    if (!ex.id) {
      ex.id =
        "nav-" +
        String(ex.label || "g")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") ||
        "group";
    }
    if (!ex.openOn) ex.openOn = [];
    return ex;
  }

  function renderLinkItem(item, cf, ch) {
    var cur = isCurrentPage(item.href, cf, ch) ? ' aria-current="page"' : "";
    return "<li><a href=\"" + esc(item.href) + "\"" + cur + ">" + esc(item.label) + "</a></li>";
  }

  function renderGroup(group, cf, ch) {
    var items = (group.items || []).map(function (it) {
      return renderItem(it, cf, ch);
    }).join("");
    return (
      '<div class="nav-group">' +
      '<div class="nav-group__title">' +
      esc(group.label) +
      "</div><ul>" +
      items +
      "</ul></div>"
    );
  }

  function bindToggles() {
    document.querySelectorAll(".nav-expandable__toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("aria-controls");
        var panel = id ? document.getElementById(id) : null;
        if (!panel) return;
        var isOpen = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
        panel.hidden = isOpen;
      });
    });
  }

  function renderFallback(container) {
    var en = location.pathname.indexOf("/en/") !== -1;
    if (en) {
      container.innerHTML =
        '<div class="nav-group"><div class="nav-group__title">Sections</div><ul>' +
        '<li><a href="index.html">Home</a></li>' +
        '<li><a href="page-flash.html">Flashing</a></li>' +
        '<li><a href="page-modules.html">Modules</a></li></ul></div>';
    } else {
      container.innerHTML =
        '<div class="nav-group"><div class="nav-group__title">Разделы</div><ul>' +
        '<li><a href="index.html">Главная</a></li>' +
        '<li><a href="page-flash.html">Прошивка</a></li>' +
        '<li><a href="page-modules.html">Модули</a></li></ul></div>';
    }
  }

  function run(data) {
    var container = document.getElementById("site-nav-container");
    if (!container) return;
    var cf = currentFile();
    var ch = currentHash();
    var html = (data.groups || []).map(function (g) {
      return renderGroup(g, cf, ch);
    }).join("");
    container.innerHTML = html;
    bindToggles();
  }

  var container = document.getElementById("site-nav-container");
  if (!container) return;

  fetch(enNavFile(), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("nav");
      return r.json();
    })
    .then(run)
    .catch(function () {
      renderFallback(container);
      bindToggles();
    });
})();
