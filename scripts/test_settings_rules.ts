import fs from "fs";
import path from "path";

async function getAdminToken(): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

async function testSettingsPermissions() {
  const adminToken = await getAdminToken();

  // Find an auditor user
  const usersRes = await fetch("https://firestore.googleapis.com/v1/projects/moodle-adf67/databases/(default)/documents/users", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const usersData = await usersRes.json();
  const docs = usersData.documents || [];
  
  let auditorUid: string | null = null;
  let agentUid: string | null = null;

  for (const doc of docs) {
    const fields = doc.fields || {};
    const role = fields.role?.stringValue;
    const uid = doc.name.split("/").pop();
    if (role === "auditor" && !auditorUid) {
      auditorUid = uid;
    } else if (role === "agent" && !agentUid) {
      agentUid = uid;
    }
  }

  console.log("Found auditor UID:", auditorUid);
  console.log("Found agent UID:", agentUid);

  const rules = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");

  // Test auditor writing settings
  const testRes = await fetch("https://firebaserules.googleapis.com/v1/projects/moodle-adf67:test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: {
        files: [{ name: "firestore.rules", content: rules }],
      },
      testSuite: {
        testCases: [
          {
            request: {
              auth: { uid: auditorUid },
              method: "update",
            },
            path: "databases/(default)/documents/settings/application",
            expectation: "ALLOW",
          },
          {
            request: {
              auth: { uid: agentUid },
              method: "update",
            },
            path: "databases/(default)/documents/settings/application",
            expectation: "DENY",
          },
          {
            request: {
              auth: { uid: auditorUid },
              method: "create",
            },
            path: "databases/(default)/documents/audit_logs/log-test",
            expectation: "ALLOW",
          },
          {
            request: {
              auth: { uid: agentUid },
              method: "create",
            },
            path: "databases/(default)/documents/audit_logs/log-test",
            expectation: "DENY",
          }
        ],
      },
    }),
  });

  const testData = await testRes.json();
  console.log("Rules Test Result:", JSON.stringify(testData, null, 2));
}

testSettingsPermissions().catch(console.error);
