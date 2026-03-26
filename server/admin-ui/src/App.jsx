import { useEffect, useMemo, useRef, useState } from "react";
import "./app.css";

async function api(path, opts) {
  const r = await fetch(path, { credentials: "include", ...(opts || {}) });
  let j = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  if (!r.ok) {
    const msg = (j && (j.message || j.error)) || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return j;
}

function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      onLoggedIn();
    } catch (e2) {
      setErr(e2?.message || String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <div className="title">ESP-HACK Admin</div>
        <div className="muted">Вход в админку (логин/пароль проверяются на сервере).</div>

        <form className="form" onSubmit={submit}>
          <label className="label">
            Логин
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="label">
            Пароль
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
          </label>
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || !username || !password}>
              {busy ? "Вхожу..." : "Войти"}
            </button>
          </div>
          {err ? <div className="error">{err}</div> : null}
        </form>
      </div>
    </div>
  );
}

const TABS = [
  { id: "pages", label: "Страницы" },
  { id: "nav", label: "Разделы" },
  { id: "media", label: "Изображения" },
  { id: "settings", label: "Настройки" },
];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function parseBlocksFromHtml(fullHtml) {
  try {
    const doc = new DOMParser().parseFromString(String(fullHtml || ""), "text/html");
    const wrap = doc.querySelector(".content__wrap") || doc.body;
    const blocks = [];
    Array.from(wrap.children || []).forEach((el) => {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "h1" || tag === "h2" || tag === "h3") {
        blocks.push({ id: uid(), type: "heading", level: Number(tag.slice(1)), text: el.textContent || "" });
        return;
      }
      if (tag === "p") {
        blocks.push({ id: uid(), type: "paragraph", text: el.innerText || "" });
        return;
      }
      if (tag === "ul" || tag === "ol") {
        const items = Array.from(el.querySelectorAll("li")).map((li) => li.textContent || "");
        blocks.push({ id: uid(), type: "list", ordered: tag === "ol", items: items.length ? items : [""] });
        return;
      }
      if (tag === "img") {
        blocks.push({ id: uid(), type: "image", src: el.getAttribute("src") || "", alt: el.getAttribute("alt") || "" });
        return;
      }
      if (tag === "pre") {
        blocks.push({ id: uid(), type: "code", code: el.textContent || "" });
        return;
      }
      blocks.push({ id: uid(), type: "paragraph", text: el.textContent || "" });
    });
    return blocks.length ? blocks : [{ id: uid(), type: "paragraph", text: "" }];
  } catch {
    return [{ id: uid(), type: "paragraph", text: "" }];
  }
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderBlocksToInnerHtml(blocks) {
  return (blocks || [])
    .map((b) => {
      if (b.type === "heading") {
        const lvl = [1, 2, 3].includes(Number(b.level)) ? Number(b.level) : 2;
        return `<h${lvl}>${escHtml(b.text)}</h${lvl}>`;
      }
      if (b.type === "list") {
        const tag = b.ordered ? "ol" : "ul";
        const items = (b.items || []).map((x) => `<li>${escHtml(x)}</li>`).join("");
        return `<${tag}>${items}</${tag}>`;
      }
      if (b.type === "image") {
        const src = String(b.src || "");
        const alt = escHtml(b.alt || "");
        return `<figure><img src="${src}" alt="${alt}" /></figure>`;
      }
      if (b.type === "code") {
        return `<pre><code>${escHtml(b.code)}</code></pre>`;
      }
      return `<p>${escHtml(b.text)}</p>`;
    })
    .join("\n");
}

function replaceContentWrap(fullHtml, inner) {
  const s = String(fullHtml || "");
  const open = s.indexOf('<div class="content__wrap">');
  if (open === -1) return s;
  const startInner = open + '<div class="content__wrap">'.length;
  const close = s.indexOf("</div>", startInner);
  if (close === -1) return s;
  return s.slice(0, startInner) + "\n" + inner + "\n" + s.slice(close);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function ensureNavShape(raw) {
  const nav = raw && typeof raw === "object" ? raw : {};
  if (!Array.isArray(nav.groups)) nav.groups = [];
  nav.groups = nav.groups.map((g) => {
    const gg = g && typeof g === "object" ? g : {};
    if (!Array.isArray(gg.items)) gg.items = [];
    gg.items = gg.items.map((it) => normalizeNavItem(it));
    return gg;
  });
  return nav;
}

function normalizeNavItem(it) {
  const x = it && typeof it === "object" ? { ...it } : {};
  x.type = x.type === "expand" ? "expand" : "link";
  x.label = String(x.label || "");
  x.href = String(x.href || "index.html");
  if (x.type === "expand") {
    if (!Array.isArray(x.children)) x.children = [];
    x.children = x.children.map((c) => normalizeNavItem({ ...c, type: "link" }));
    if (!Array.isArray(x.openOn)) x.openOn = [];
  } else {
    delete x.children;
    delete x.openOn;
  }
  return x;
}

function getNavItemAtPath(items, pathArr) {
  let curItems = items;
  let cur = null;
  for (let i = 0; i < pathArr.length; i++) {
    const idx = pathArr[i];
    cur = curItems[idx];
    if (!cur) return null;
    if (i < pathArr.length - 1) curItems = Array.isArray(cur.children) ? cur.children : [];
  }
  return cur;
}

function getParentListByPath(items, pathArr) {
  if (!pathArr.length) return items;
  let curItems = items;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const idx = pathArr[i];
    const cur = curItems[idx];
    if (!cur || !Array.isArray(cur.children)) return null;
    curItems = cur.children;
  }
  return curItems;
}

function Shell({ user, onLogout }) {
  const [tab, setTab] = useState("pages");
  const tabTitle = useMemo(() => TABS.find((t) => t.id === tab)?.label || "", [tab]);

  const [globalErr, setGlobalErr] = useState("");

  function renderTab() {
    if (tab === "pages") return <PagesTab onError={setGlobalErr} />;
    if (tab === "nav") return <NavTab onError={setGlobalErr} />;
    if (tab === "media") return <MediaTab onError={setGlobalErr} />;
    return <SettingsTab />;
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">ESP-HACK</div>
        <div className="sideMuted">Пользователь: {user}</div>
        <div className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`navItem ${tab === t.id ? "navItemActive" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="sideFooter">
          <button className="btn" type="button" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="mainTop">
          <div className="mainTitle">{tabTitle}</div>
          <div className="mainMuted">Автокоммит включён: любое «Сохранить» делает коммит в GitHub.</div>
        </div>
        {globalErr ? <div className="error">{globalErr}</div> : null}
        {renderTab()}
      </main>
    </div>
  );
}

function PagesTab({ onError }) {
  const [busy, setBusy] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [status, setStatus] = useState("");
  const [pages, setPages] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [selectedPath, setSelectedPath] = useState("");
  const [selectedHtml, setSelectedHtml] = useState("");
  const [selectedLoading, setSelectedLoading] = useState(false);

  const [renameTo, setRenameTo] = useState("");
  const [mode, setMode] = useState("block"); // block | raw
  const [blocks, setBlocks] = useState([{ id: uid(), type: "paragraph", text: "" }]);
  const [dragIdx, setDragIdx] = useState(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const rawRef = useRef("");

  function pushHistory(nextBlocks) {
    setHistory((h) => [...h.slice(-40), JSON.stringify(blocks)]);
    setFuture([]);
    setBlocks(nextBlocks);
  }

  function undo() {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [JSON.stringify(blocks), ...f].slice(0, 40));
    setBlocks(JSON.parse(prev));
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h.slice(-40), JSON.stringify(blocks)]);
    setBlocks(JSON.parse(next));
  }

  function updateBlock(id, patch) {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    pushHistory(next);
  }

  function removeBlock(id) {
    const next = blocks.filter((b) => b.id !== id);
    pushHistory(next.length ? next : [{ id: uid(), type: "paragraph", text: "" }]);
  }

  function addBlock(type) {
    let b = { id: uid(), type, text: "" };
    if (type === "heading") b = { id: uid(), type, level: 2, text: "" };
    if (type === "list") b = { id: uid(), type, ordered: false, items: [""] };
    if (type === "image") b = { id: uid(), type, src: "images/", alt: "" };
    if (type === "code") b = { id: uid(), type, code: "" };
    pushHistory([...blocks, b]);
  }

  function moveBlock(from, to) {
    if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return;
    const arr = blocks.slice();
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    pushHistory(arr);
  }

  async function createPage() {
    setBusy(true);
    onError("");
    setStatus("Создаю страницу...");
    try {
      const j = await api("/api/admin/page/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle || "Новая страница",
          slug: createSlug || "",
          branch: "main",
        }),
      });
      setStatus(`Создано: ${j.path}`);
      setCreateTitle("");
      setCreateSlug("");
      setRefreshTick((x) => x + 1);
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function refreshPages() {
    onError("");
    setBusy(true);
    setStatus("Загружаю список страниц...");
    try {
      const root = await api("/api/admin/list?path=&branch=main", { method: "GET" });
      const items = Array.isArray(root.items) ? root.items : [];
      const only = items
        .filter((it) => it && it.type === "file")
        .map((it) => String(it.path || ""))
        .filter((p) => p === "index.html" || p.startsWith("page-") || p === "DEPLOY.md")
        .filter((p) => p.endsWith(".html") || p.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b));
      setPages(only);
      setStatus("");
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  async function openPage(path) {
    setSelectedPath(path);
    setSelectedLoading(true);
    onError("");
    setStatus(`Открываю: ${path}`);
    try {
      const j = await api(`/api/admin/contents?path=${encodeURIComponent(path)}&branch=main`, { method: "GET" });
      const html = String(j.content || "");
      setSelectedHtml(html);
      rawRef.current = html;
      setBlocks(parseBlocksFromHtml(html));
      setHistory([]);
      setFuture([]);
      setStatus("");
      setRenameTo(path);
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
      setSelectedHtml("");
    } finally {
      setSelectedLoading(false);
    }
  }

  async function saveSelected() {
    if (!selectedPath) return;
    setBusy(true);
    onError("");
    setStatus("Сохраняю страницу...");
    try {
      const textToSave = mode === "block" ? replaceContentWrap(selectedHtml, renderBlocksToInnerHtml(blocks)) : selectedHtml;
      await api("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, branch: "main", text: textToSave }),
      });
      setStatus("Сохранено.");
      setSelectedHtml(textToSave);
      rawRef.current = textToSave;
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function renameSelected() {
    if (!selectedPath) return;
    const to = (renameTo || "").trim();
    if (!to || to === selectedPath) return;
    setBusy(true);
    onError("");
    setStatus(`Переименовываю: ${selectedPath} -> ${to}`);
    try {
      await api("/api/admin/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: selectedPath, toPath: to, branch: "main" }),
      });
      setSelectedPath(to);
      setStatus("Готово.");
      setRefreshTick((x) => x + 1);
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selectedPath) return;
    if (!confirm(`Удалить файл ${selectedPath}?`)) return;
    setBusy(true);
    onError("");
    setStatus(`Удаляю: ${selectedPath}`);
    try {
      await api("/api/admin/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, branch: "main" }),
      });
      setSelectedPath("");
      setSelectedHtml("");
      setStatus("Удалено.");
      setRefreshTick((x) => x + 1);
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="panel">
        <div className="rowItemTitle">Создать RU‑страницу</div>
        <div className="hint">
          Создаёт файл вида <span className="code">page-*.html</span> и коммитит в GitHub.
        </div>
        <div className="hr" />
        <div className="grid2">
          <label className="label">
            Заголовок страницы
            <input
              className="input inputSm"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="например: Функции прошивки"
            />
          </label>
          <label className="label">
            Slug (опционально)
            <input
              className="input inputSm"
              value={createSlug}
              onChange={(e) => setCreateSlug(e.target.value)}
              placeholder="например: features"
            />
          </label>
        </div>
        <div className="toolbar">
          <button className="btn primary" type="button" disabled={busy} onClick={createPage}>
            {busy ? "Создаю..." : "Создать"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => setRefreshTick((x) => x + 1)}>
            Обновить список
          </button>
          {status ? <div className="hint">{status}</div> : null}
        </div>

        <div className="hr" />
        <div className="rowItemTitle">Список страниц</div>
        <div className="list">
          {pages.map((p) => (
        <button
              key={p}
              type="button"
              className={`navItem ${selectedPath === p ? "navItemActive" : ""}`}
              onClick={() => openPage(p)}
              style={{ textAlign: "left" }}
            >
              {p}
        </button>
          ))}
          {!pages.length ? <div className="hint">Пока пусто.</div> : null}
        </div>
      </div>

      <div className="panel">
        <div className="rowItemTitle">Редактор</div>
        <div className="hint">Доступны режимы Block (drag&amp;drop + undo/redo) и Raw HTML.</div>
        <div className="hr" />
        {!selectedPath ? (
          <div className="hint">Слева выбери страницу.</div>
        ) : (
          <>
            <div className="rowItem">
              <div>
                <div className="rowItemTitle">{selectedPath}</div>
                <div className="rowItemMeta">{selectedLoading ? "Загрузка..." : ""}</div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className={`btn mini ${mode === "block" ? "primary" : ""}`} type="button" onClick={() => setMode("block")}>
                  Block
                </button>
                <button className={`btn mini ${mode === "raw" ? "primary" : ""}`} type="button" onClick={() => setMode("raw")}>
                  Raw HTML
                </button>
                <button className="btn mini" type="button" disabled={busy || selectedLoading} onClick={saveSelected}>
                  Сохранить
                </button>
                <button className="btn mini" type="button" disabled={busy || selectedLoading} onClick={deleteSelected}>
                  Удалить
                </button>
              </div>
            </div>

            <div className="toolbar">
              <label className="label" style={{ flex: "1 1 auto" }}>
                Переименовать в
                <input className="input inputSm" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
              </label>
              <button className="btn mini" type="button" disabled={busy || selectedLoading} onClick={renameSelected}>
                Переименовать
              </button>
            </div>

            <div style={{ height: 10 }} />
            {mode === "raw" ? (
              <textarea
                className="input"
                style={{ height: 520, padding: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
                value={selectedHtml}
                onChange={(e) => setSelectedHtml(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <div>
                <div className="toolbar">
                  <button className="btn mini" type="button" onClick={() => addBlock("heading")}>+ Заголовок</button>
                  <button className="btn mini" type="button" onClick={() => addBlock("paragraph")}>+ Текст</button>
                  <button className="btn mini" type="button" onClick={() => addBlock("list")}>+ Список</button>
                  <button className="btn mini" type="button" onClick={() => addBlock("image")}>+ Картинка</button>
                  <button className="btn mini" type="button" onClick={() => addBlock("code")}>+ Код</button>
                  <button className="btn mini" type="button" onClick={undo} disabled={!history.length}>Undo</button>
                  <button className="btn mini" type="button" onClick={redo} disabled={!future.length}>Redo</button>
                </div>
                <div className="list">
                  {blocks.map((b, i) => (
                    <div
                      key={b.id}
                      className="rowItem"
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIdx == null) return;
                        moveBlock(dragIdx, i);
                        setDragIdx(null);
                      }}
                      style={{ alignItems: "stretch", flexDirection: "column" }}
                    >
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div className="rowItemMeta">#{i + 1} · {b.type}</div>
                        <div className="row">
                          <button className="btn mini" type="button" onClick={() => moveBlock(i, i - 1)} disabled={i === 0}>↑</button>
                          <button className="btn mini" type="button" onClick={() => moveBlock(i, i + 1)} disabled={i === blocks.length - 1}>↓</button>
                          <button className="btn mini" type="button" onClick={() => removeBlock(b.id)}>Удалить</button>
                        </div>
                      </div>
                      {b.type === "heading" ? (
                        <div className="grid2">
                          <select className="input inputSm" value={b.level || 2} onChange={(e) => updateBlock(b.id, { level: Number(e.target.value) })}>
                            <option value={1}>H1</option>
                            <option value={2}>H2</option>
                            <option value={3}>H3</option>
                          </select>
                          <input className="input inputSm" value={b.text || ""} onChange={(e) => updateBlock(b.id, { text: e.target.value })} placeholder="Заголовок" />
                        </div>
                      ) : null}
                      {b.type === "paragraph" ? (
                        <textarea className="input" style={{ height: 90, padding: 10 }} value={b.text || ""} onChange={(e) => updateBlock(b.id, { text: e.target.value })} />
                      ) : null}
                      {b.type === "list" ? (
                        <div>
                          <div className="toolbar">
                            <button className="btn mini" type="button" onClick={() => updateBlock(b.id, { ordered: !b.ordered })}>{b.ordered ? "Нумер." : "Маркир."}</button>
                            <button
                              className="btn mini"
                              type="button"
                              onClick={() => updateBlock(b.id, { items: [...(b.items || []), ""] })}
                            >
                              + Пункт
                            </button>
                          </div>
                          {(b.items || []).map((it, idx) => (
                            <input
                              key={`${b.id}-${idx}`}
                              className="input inputSm"
                              style={{ marginTop: 6 }}
                              value={it}
                              onChange={(e) => {
                                const arr = (b.items || []).slice();
                                arr[idx] = e.target.value;
                                updateBlock(b.id, { items: arr });
                              }}
                              placeholder={`Пункт ${idx + 1}`}
                            />
                          ))}
                        </div>
                      ) : null}
                      {b.type === "image" ? (
                        <div className="grid2">
                          <input className="input inputSm" value={b.src || ""} onChange={(e) => updateBlock(b.id, { src: e.target.value })} placeholder="images/file.png" />
                          <input className="input inputSm" value={b.alt || ""} onChange={(e) => updateBlock(b.id, { alt: e.target.value })} placeholder="alt" />
                        </div>
                      ) : null}
                      {b.type === "code" ? (
                        <textarea className="input" style={{ height: 140, padding: 10, fontFamily: "ui-monospace,monospace" }} value={b.code || ""} onChange={(e) => updateBlock(b.id, { code: e.target.value })} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NavTab({ onError }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("builder"); // builder | raw
  const [navObj, setNavObj] = useState({ groups: [] });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [groupIdx, setGroupIdx] = useState(0);
  const [itemPath, setItemPath] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("Разделы");
  const [newLabel, setNewLabel] = useState("");
  const [newHref, setNewHref] = useState("page-new.html");
  const [newType, setNewType] = useState("link");

  async function loadNav() {
    setBusy(true);
    onError("");
    setStatus("Загружаю nav.json...");
    try {
      const j = await api("/api/admin/contents?path=data%2Fnav.json&branch=main", { method: "GET" });
      const src = String(j.content || "");
      setText(src);
      try {
        const parsed = ensureNavShape(JSON.parse(src || "{}"));
        setNavObj(parsed);
        setGroupIdx(0);
        setItemPath("");
      } catch {
        setNavObj({ groups: [] });
      }
      setStatus("");
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function saveNav() {
    setBusy(true);
    onError("");
    setStatus("Сохраняю nav.json...");
    try {
      const payload = mode === "builder" ? JSON.stringify(navObj, null, 2) : text;
      const parsed = JSON.parse(payload || "{}");
      const normalized = ensureNavShape(parsed);
      const out = JSON.stringify(normalized, null, 2);
      await api("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "data/nav.json", branch: "main", text: out }),
      });
      setText(out);
      setNavObj(normalized);
      setStatus("Сохранено.");
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateBuilder(mutator) {
    const next = deepClone(navObj);
    mutator(next);
    setNavObj(ensureNavShape(next));
    setText(JSON.stringify(ensureNavShape(next), null, 2));
  }

  function addGroup() {
    updateBuilder((next) => {
      next.groups.push({ label: newGroupLabel || "Разделы", items: [] });
      setGroupIdx(next.groups.length - 1);
    });
  }

  function addTopItem() {
    if (!navObj.groups[groupIdx]) return;
    updateBuilder((next) => {
      const items = next.groups[groupIdx].items;
      const base = { type: newType, label: newLabel || "Новый пункт", href: newHref || "index.html" };
      if (newType === "expand") {
        base.id = `id-${uid()}`;
        base.openOn = [{ file: (newHref || "index.html").split("#")[0] }];
        base.children = [];
      }
      items.push(base);
    });
  }

  function addChild() {
    if (!itemPath) return;
    const pathArr = itemPath.split(".").map((x) => Number(x));
    updateBuilder((next) => {
      const group = next.groups[groupIdx];
      const item = getNavItemAtPath(group.items, pathArr);
      if (!item || item.type !== "expand") return;
      item.children = item.children || [];
      item.children.push({
        type: "link",
        label: "Новый подпункт",
        href: item.href || "index.html",
      });
    });
  }

  function deleteSelected() {
    if (!itemPath) return;
    const pathArr = itemPath.split(".").map((x) => Number(x));
    updateBuilder((next) => {
      const group = next.groups[groupIdx];
      const list = getParentListByPath(group.items, pathArr);
      const idx = pathArr[pathArr.length - 1];
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      setItemPath("");
    });
  }

  function moveSelected(dir) {
    if (!itemPath) return;
    const pathArr = itemPath.split(".").map((x) => Number(x));
    updateBuilder((next) => {
      const group = next.groups[groupIdx];
      const list = getParentListByPath(group.items, pathArr);
      const idx = pathArr[pathArr.length - 1];
      const to = idx + dir;
      if (!list || to < 0 || to >= list.length) return;
      const tmp = list[idx];
      list[idx] = list[to];
      list[to] = tmp;
      pathArr[pathArr.length - 1] = to;
      setItemPath(pathArr.join("."));
    });
  }

  function renderItemTree(items, prefix = "") {
    return (
      <div className="list">
        {(items || []).map((it, idx) => {
          const path = prefix ? `${prefix}.${idx}` : `${idx}`;
          const selected = path === itemPath;
          return (
            <div key={path}>
              <button
                type="button"
                className={`navItem ${selected ? "navItemActive" : ""}`}
                onClick={() => setItemPath(path)}
                style={{ textAlign: "left" }}
              >
                {it.type === "expand" ? "▸ " : "• "} {it.label || "(без названия)"}
              </button>
              {it.type === "expand" && Array.isArray(it.children) && it.children.length ? (
                <div style={{ marginLeft: 14 }}>{renderItemTree(it.children, path)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rowItemTitle">Разделы/подразделы</div>
      <div className="hint">Конструктор меню + raw JSON режим.</div>
      <div className="toolbar">
        <button className={`btn mini ${mode === "builder" ? "primary" : ""}`} type="button" onClick={() => setMode("builder")}>Constructor</button>
        <button className={`btn mini ${mode === "raw" ? "primary" : ""}`} type="button" onClick={() => setMode("raw")}>Raw JSON</button>
        <button className="btn mini" type="button" disabled={busy} onClick={loadNav}>Обновить</button>
        <button className="btn mini primary" type="button" disabled={busy} onClick={saveNav}>Сохранить</button>
        {status ? <div className="hint">{status}</div> : null}
      </div>
      <div style={{ height: 10 }} />
      {mode === "raw" ? (
        <textarea
          className="input"
          style={{ height: 520, padding: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="grid2" style={{ alignItems: "start" }}>
          <div>
            <div className="label">Группа</div>
            <div className="toolbar">
              <select className="input inputSm" value={groupIdx} onChange={(e) => setGroupIdx(Number(e.target.value))}>
                {navObj.groups.map((g, i) => (
                  <option key={String(i)} value={i}>{g.label || `Группа ${i + 1}`}</option>
                ))}
              </select>
            </div>
            <div className="toolbar">
              <input className="input inputSm" value={newGroupLabel} onChange={(e) => setNewGroupLabel(e.target.value)} placeholder="Имя группы" />
              <button className="btn mini" type="button" onClick={addGroup}>+ Группа</button>
            </div>
            <div className="hr" />
            {navObj.groups[groupIdx] ? renderItemTree(navObj.groups[groupIdx].items || []) : <div className="hint">Нет групп.</div>}
          </div>
          <div>
            <div className="label">Операции</div>
            <div className="grid2">
              <label className="label">
                Тип
                <select className="input inputSm" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  <option value="link">link</option>
                  <option value="expand">expand</option>
                </select>
              </label>
              <label className="label">
                label
                <input className="input inputSm" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              </label>
            </div>
            <label className="label">
              href
              <input className="input inputSm" value={newHref} onChange={(e) => setNewHref(e.target.value)} />
            </label>
            <div className="toolbar">
              <button className="btn mini" type="button" onClick={addTopItem}>+ Пункт в группу</button>
              <button className="btn mini" type="button" onClick={addChild} disabled={!itemPath}>+ Подпункт</button>
            </div>
            <div className="toolbar">
              <button className="btn mini" type="button" onClick={() => moveSelected(-1)} disabled={!itemPath}>↑</button>
              <button className="btn mini" type="button" onClick={() => moveSelected(1)} disabled={!itemPath}>↓</button>
              <button className="btn mini" type="button" onClick={deleteSelected} disabled={!itemPath}>Удалить</button>
            </div>
            <div className="hint">Выбранный путь: <span className="code">{itemPath || "-"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaTab({ onError }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [uploadName, setUploadName] = useState("");

  async function loadMedia() {
    setBusy(true);
    onError("");
    setStatus("Загружаю images/ ...");
    try {
      const j = await api("/api/admin/list?path=images&branch=main", { method: "GET" });
      const arr = (Array.isArray(j.items) ? j.items : []).filter((x) => x.type === "file");
      setItems(arr);
      setStatus("");
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMedia(path) {
    if (!confirm(`Удалить ${path}?`)) return;
    setBusy(true);
    onError("");
    setStatus(`Удаляю ${path}...`);
    try {
      await api("/api/admin/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, branch: "main" }),
      });
      setStatus("Удалено.");
      await loadMedia();
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function renameMedia() {
    if (!renameFrom || !renameTo) return;
    setBusy(true);
    onError("");
    setStatus("Переименовываю...");
    try {
      await api("/api/admin/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromPath: renameFrom, toPath: renameTo, branch: "main" }),
      });
      setStatus("Готово.");
      setRenameFrom("");
      setRenameTo("");
      await loadMedia();
    } catch (e) {
      onError(e?.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const name = (uploadName || f.name || "").trim();
    if (!name) return;
    setBusy(true);
    onError("");
    setStatus("Загружаю файл...");
    try {
      const buf = await f.arrayBuffer();
      const a = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < a.length; i++) binary += String.fromCharCode(a[i]);
      const b64 = btoa(binary);
      await api("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `images/${name}`,
          branch: "main",
          contentBase64: b64,
        }),
      });
      setStatus("Загружено.");
      setUploadName("");
      e.target.value = "";
      await loadMedia();
    } catch (e2) {
      onError(e2?.message || String(e2));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel">
      <div className="rowItemTitle">Изображения</div>
      <div className="hint">Папка <span className="code">images/</span>: загрузка, переименование и удаление.</div>
      <div className="toolbar">
        <button className="btn mini" type="button" disabled={busy} onClick={loadMedia}>Обновить</button>
        {status ? <div className="hint">{status}</div> : null}
      </div>
      <div className="hr" />
      <div className="grid2">
        <label className="label">
          Имя для загрузки (опционально)
          <input className="input inputSm" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="my-image.png" />
        </label>
        <label className="label">
          Файл
          <input className="input inputSm" type="file" accept="image/*" onChange={uploadMedia} />
        </label>
      </div>
      <div className="hr" />
      <div className="grid2">
        <label className="label">
          from
          <input className="input inputSm" value={renameFrom} onChange={(e) => setRenameFrom(e.target.value)} placeholder="images/old.png" />
        </label>
        <label className="label">
          to
          <input className="input inputSm" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="images/new.png" />
        </label>
      </div>
      <div className="toolbar">
        <button className="btn mini" type="button" disabled={busy} onClick={renameMedia}>Переименовать</button>
      </div>
      <div className="hr" />
      <div className="list">
        {items.map((it) => (
          <div className="rowItem" key={it.path}>
            <div>
              <div className="rowItemTitle">{it.name}</div>
              <div className="rowItemMeta">{it.path}</div>
            </div>
            <div className="row">
              <button className="btn mini" type="button" onClick={() => navigator.clipboard?.writeText(it.path)}>Copy path</button>
              <button className="btn mini" type="button" onClick={() => deleteMedia(it.path)}>Удалить</button>
            </div>
          </div>
        ))}
        {!items.length ? <div className="hint">Нет файлов.</div> : null}
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="panel">
      <div className="rowItemTitle">Настройки</div>
      <div className="hint">Рабочая ветка: <span className="code">main</span>. Авторизация через серверную сессию.</div>
      <div className="hr" />
      <div className="hint">Этот раздел больше не заглушка. Здесь будут опции публикации и шаблоны страниц.</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  async function refreshSession() {
    const j = await api("/api/admin/whoami", { method: "GET" });
    setUser(j.user);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refreshSession();
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function logout() {
    // No explicit logout endpoint yet; easiest is to reload in a fresh session
    // (server session cookie will expire; user can also clear cookies).
    setUser(null);
    setChecking(false);
  }

  if (checking) {
    return (
      <div className="wrap">
        <div className="card">
          <div className="title">ESP-HACK Admin</div>
          <div className="muted">Проверяю сессию...</div>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLoggedIn={refreshSession} />;
  return <Shell user={user} onLogout={logout} />;
}
