(function () {
  var root = document.getElementById("downloads-root");
  if (!root) return;

  function dataBase() {
    return location.pathname.indexOf("/en/") !== -1 ? "../" : "";
  }

  function isEn() {
    return location.pathname.indexOf("/en/") !== -1;
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtSize(bytes) {
    if (bytes == null || bytes === 0) return "";
    var n = Number(bytes);
    var u = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    if (i === 0) return n + " " + u[i];
    return (i >= 2 ? n.toFixed(2) : n.toFixed(1)) + " " + u[i];
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(isEn() ? "en-US" : "ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function renderItem(it) {
    var url = esc(it.url || "#");
    var name = esc(it.name || "file");
    var parts = [];
    if (it.sha256 && String(it.sha256).trim()) {
      parts.push('<span class="release-assets__hash">sha256: ' + esc(it.sha256) + "</span>");
    }
    if (it.sizeLabel) {
      parts.push("<span>" + esc(it.sizeLabel) + "</span>");
    }
    if (it.dateLabel) {
      parts.push("<span>" + esc(it.dateLabel) + "</span>");
    }
    var meta =
      parts.length > 0
        ? '<div class="release-assets__meta">' + parts.join("") + "</div>"
        : "";
    var downloadAttr = it.skipDownloadAttr ? "" : " download";
    return (
      '<li class="release-assets__row">' +
      '<a href="' +
      url +
      '"' +
      downloadAttr +
      ' rel="noopener noreferrer">' +
      name +
      "</a>" +
      meta +
      "</li>"
    );
  }

  function renderSection(title, subtitle, items) {
    var rows = items.map(renderItem).join("");
    var sub =
      subtitle && subtitle.length
        ? '<div class="release-assets__subtitle">' + esc(subtitle) + "</div>"
        : "";
    return (
      '<div class="release-assets" aria-label="' +
      esc(title) +
      '">' +
      '<div class="release-assets__title">' +
      esc(title) +
      "</div>" +
      sub +
      '<ul class="release-assets__list">' +
      rows +
      "</ul></div>"
    );
  }

  function renderFromStatic(data) {
    function mapStaticItem(it) {
      return {
        name: it.name,
        url: it.url,
        sha256: it.sha256,
        sizeLabel: it.size,
        dateLabel: it.date,
        skipDownloadAttr: false,
      };
    }
    var html = (data.sections || []).map(function (sec) {
      var items = (sec.items || []).map(mapStaticItem);
      var defaultTitle = isEn() ? "Files" : "Файлы";
      return renderSection(sec.title || defaultTitle, "", items);
    }).join("");
    root.innerHTML =
      html || (isEn() ? "<p>No files in the list.</p>" : "<p>Нет файлов в списке.</p>");
  }

  function normalizeExclude(raw) {
    if (!raw || !raw.length) return [];
    return raw
      .map(function (x) {
        if (typeof x === "string") return x;
        if (x && typeof x.substring === "string") return x.substring;
        return "";
      })
      .filter(Boolean);
  }

  function filterAssets(assets, exclude) {
    if (!exclude || !exclude.length) return assets;
    return assets.filter(function (a) {
      var name = a.name || "";
      return !exclude.some(function (sub) {
        return sub && name.indexOf(sub) >= 0;
      });
    });
  }

  function sourceArchivesFromRelease(release) {
    var out = [];
    var published = release.published_at;
    if (release.zipball_url) {
      out.push({
        name: "Source code (zip)",
        browser_download_url: release.zipball_url,
        size: 0,
        updated_at: published,
      });
    }
    if (release.tarball_url) {
      out.push({
        name: "Source code (tar.gz)",
        browser_download_url: release.tarball_url,
        size: 0,
        updated_at: published,
      });
    }
    return out;
  }

  function renderFromGithub(cfg, release) {
    var uploaded = filterAssets(
      release.assets || [],
      normalizeExclude(cfg.excludeNameSubstrings)
    );
    var fromSource = filterAssets(
      sourceArchivesFromRelease(release),
      normalizeExclude(cfg.excludeNameSubstrings)
    );
    var combined = uploaded.concat(fromSource);
    if (!combined.length) {
      root.innerHTML = isEn()
        ? "<p>No files to show in the latest release.</p>"
        : "<p>В последнем релизе нет файлов для отображения.</p>";
      return;
    }
    var items = combined.map(function (a) {
      return {
        name: a.name,
        url: a.browser_download_url,
        sha256: "",
        sizeLabel: a.size ? fmtSize(a.size) : "",
        dateLabel: fmtDate(a.updated_at),
        skipDownloadAttr: true,
      };
    });
    var title = cfg.sectionTitle || "Assets";
    var subtitleParts = [];
    if (release.tag_name)
      subtitleParts.push((isEn() ? "Release: " : "Релиз: ") + release.tag_name);
    if (release.name && release.name !== release.tag_name) subtitleParts.push(release.name);
    if (release.published_at) subtitleParts.push(fmtDate(release.published_at));
    var subtitle = subtitleParts.filter(Boolean).join(" · ");
    root.innerHTML = renderSection(title, subtitle, items);
  }

  function loadGithub(cfg) {
    var url =
      "https://api.github.com/repos/" +
      encodeURIComponent(cfg.owner) +
      "/" +
      encodeURIComponent(cfg.repo) +
      "/releases/latest";
    return fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    }).then(function (r) {
      if (r.status === 403) {
        throw new Error("rate");
      }
      if (!r.ok) throw new Error("github");
      return r.json();
    });
  }

  function fetchStatic() {
    return fetch(dataBase() + "data/downloads.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("static");
      return r.json();
    });
  }

  fetch(dataBase() + "data/github-release.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("cfg");
      return r.json();
    })
    .then(function (cfg) {
      if (cfg.useGithubApi === false) {
        return fetchStatic().then(renderFromStatic);
      }
      return loadGithub(cfg)
        .then(function (release) {
          renderFromGithub(cfg, release);
        })
        .catch(function () {
          return fetchStatic().then(renderFromStatic);
        });
    })
    .catch(function () {
      root.innerHTML = isEn()
        ? '<p class="downloads-error">Could not load files. Open <a href="https://github.com/Teapot174/ESP-HACK/releases">releases on GitHub</a>.</p>'
        : '<p class="downloads-error">Не удалось загрузить файлы. Откройте <a href="https://github.com/Teapot174/ESP-HACK/releases">релизы на GitHub</a>.</p>';
    });
})();
