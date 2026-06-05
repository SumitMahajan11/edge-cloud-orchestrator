const fs = require("fs");
const path = require("path");
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith(".ts")) {
      results.push(file);
    }
  });
  return results;
}

const files = walk("apps/api/src/routes");
let modifiedCount = 0;

files.forEach((file) => {
  let content = fs.readFileSync(file, "utf8");
  let original = content;

  // Pattern to find standard pagination blocks missing hasNext/hasPrev
  const regex =
    /pagination:\s*\{\s*page,?\s*limit,?\s*total,?\s*totalPages:\s*([^,}]+),?\s*\}/g;

  content = content.replace(regex, (match, totalPagesExpr) => {
    return `pagination: {
          page,
          limit,
          total,
          totalPages: ${totalPagesExpr},
          hasNext: page * limit < total,
          hasPrev: page > 1,
        }`;
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log("Updated", file);
    modifiedCount++;
  }
});
console.log("Total files updated by simple replace: ", modifiedCount);
