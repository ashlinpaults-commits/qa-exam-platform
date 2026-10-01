import fs from "fs";
import path from "path";

const homeDir = process.env.USERPROFILE || process.env.HOME || "";
const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
console.log("Scopes:", config.tokens.scopes);
console.log("User:", config.user);
