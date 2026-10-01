import fs from "fs";
import path from "path";

async function getAdminToken(): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

async function testRulesApi() {
  const token = await getAdminToken();
  const rules = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");

  // Call firebaserules.projects.test
  const res = await fetch("https://firebaserules.googleapis.com/v1/projects/moodle-adf67:test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: {
        files: [
          {
            name: "firestore.rules",
            content: rules,
          },
        ],
      },
      testSuite: {
        testCases: [
          {
            request: {
              auth: {
                uid: "0WCtZLLiTAZvq8Ne0eQ2xmTlo3q1", // Anagha (agent)
                token: { email: "anaghaanil@carestack.com" },
              },
            },
            functionMocks: [],
            expectation: "ALLOW",
            expression: "signedIn()",
            path: "databases/(default)/documents/exams/SGS997Ls5QLN6HxnojuH",
          },
        ],
      },
    }),
  });

  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

testRulesApi().catch(console.error);
