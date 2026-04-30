import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

const htmlPath = resolve(import.meta.dirname, "..", "..", "minsimp-map-prototype.html");
const html = await readFile(htmlPath, "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);

if (!match) {
  throw new Error("minsimp-map-prototype.html script block not found");
}

new Script(match[1], { filename: "minsimp-map-prototype inline script" });
console.log("inline script syntax ok");
