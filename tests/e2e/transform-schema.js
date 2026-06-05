const fs = require("fs");
const path = require("path");

const schemaPath = path.resolve(__dirname, "schema.prisma");
let content = fs.readFileSync(schemaPath, "utf8");

// Change provider
content = content.replace(
  /provider\s+=\s+"postgresql"/g,
  'provider = "sqlite"',
);
content = content.replace(
  /url\s+=\s+env\("DATABASE_URL"\)/g,
  'url = "file:./test.db"',
);

// 1. Collect and Remove Enums
const enumRegex = /enum\s+(\w+)\s+\{([\s\S]*?)\}/g;
const enums = [];
const allEnumValues = new Set();
const enumNames = new Set();
content = content.replace(enumRegex, (match, name, values) => {
  const vals = values
    .trim()
    .split(/\s+/)
    .filter((v) => v && !v.startsWith("//"));
  enums.push({ name, values: vals });
  vals.forEach((v) => allEnumValues.add(v));
  enumNames.add(name);
  return "";
});

// 2. Replace Enum types with String
for (const e of enums) {
  const fieldRegex = new RegExp(`(\\w+)\\s+${e.name}(\\b)`, "g");
  content = content.replace(fieldRegex, "$1 String$2");
}

// 3. Fix defaults (quote them)
content = content.replace(/@default\((\w+)\)/g, (match, value) => {
  if (allEnumValues.has(value)) {
    return `@default("${value}")`;
  }
  return match;
});

// 4. Remove Postgres specific attributes
content = content.replace(/@db\.\w+(\([^)]*\))?/g, "");

// 5. Change Json to String for SQLite compatibility
content = content.replace(/Json\??/g, "String?"); // Make them all optional String for simplicity

// 6. SQLite doesn't support arrays of primitive types or enums.
for (const name of enumNames) {
  const arrayRegex = new RegExp(`\\b${name}\\[\\]`, "g");
  content = content.replace(arrayRegex, "String");
}
content = content.replace(/String\[\]/g, "String");
content = content.replace(/Int\[\]/g, "String");
content = content.replace(/Float\[\]/g, "String");
content = content.replace(/Boolean\[\]/g, "String");

// 7. Remove indexes and unique constraints
content = content.replace(/@@index\(\[[^\]]+\]\)/g, "");
content = content.replace(/@@unique\(\[[^\]]+\]\)/g, "");

fs.writeFileSync(schemaPath, content);
console.log("Schema transformed for SQLite (v5)");
