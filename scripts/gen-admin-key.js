/**
 * Генерирует локальный ключ admin.key (не коммитить) и печатает SHA-256 для admin-gate.json.
 * Запуск: node scripts/gen-admin-key.js
 */
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var outPath = path.join(root, "admin.key");
var bytes = crypto.randomBytes(32);
fs.writeFileSync(outPath, bytes);
var hex = crypto.createHash("sha256").update(bytes).digest("hex");
console.log("Создан файл admin.key (добавьте в .gitignore, не заливайте в репозиторий).");
console.log('В data/admin-gate.json укажите:\n  "keyFileSha256": "' + hex + '"');
console.log("На GitHub Pages попадёт только хеш — без файла войти нельзя.");
