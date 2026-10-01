import fs from "fs";
import path from "path";

// Read .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
}

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

async function getAdminToken(): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

async function main() {
  const adminToken = await getAdminToken();

  // Test: Can we get user details from Identity Toolkit using adminToken?
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/projects/moodle-adf67/accounts:batchGet?maxResults=10", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("batchGet status:", res.status);
  const data = await res.json();
  console.log("batchGet data:", JSON.stringify(data).slice(0, 500));
}

main().catch(console.error);
