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
      // Для SameSite=None браузер требует Secure.
      // Поэтому secure=true по умолчанию, а выключать можно только явно через COOKIE_SECURE="false".
      secure: process.env.COOKIE_SECURE === "false" ? false : true,
      sameSite: "none",
    },
  })
);

app.get("/healthz", function (req, res) {
  res.json({ ok: true });
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

function validatePath(inputPath) {
  const p = String(inputPath || "").replace(/^\.?\//, "");
  return ALLOWED_PATHS.includes(p) ? p : "";
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

    const current = await ghFetchJson(ghPath, GITHUB_TOKEN);
    const sha = current && current.sha;
    if (!sha) return res.status(500).json({ ok: false, message: "Cannot read current file SHA" });

    const putPath = "/repos/" + encodeURIComponent(GH_OWNER) + "/" + encodeURIComponent(GH_REPO) + "/contents/" + encodeGitHubPath(path);
    const payload = {
      message: "Update " + path + " via Timeweb admin proxy",
      content: Buffer.from(text, "utf8").toString("base64"),
      sha: sha,
      branch: branch,
    };

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

