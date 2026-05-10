const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "346318948573";
const LOCATION = "us-west1";
const REASONING_ENGINE_ID = "6128000514060713984";
const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/reasoningEngines/${REASONING_ENGINE_ID}`;

function getCurrentDateForAgent() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${formatter.format(new Date())}[America/New_York]`;
}

async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function createSession(token, userId) {
  const response = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      state: JSON.stringify({
        current_date: getCurrentDateForAgent(),
      }),
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(JSON.stringify(err));
  }

  const data = await response.json();
  const sessionId = data.name.split("/").pop();
  return sessionId;
}

async function sendMessage(token, userId, sessionId, message) {
  const response = await fetch(`${BASE_URL}:streamQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        user_id: userId,
        session_id: sessionId,
        message: message,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(JSON.stringify(err));
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, sessionId, userId } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing message",
        details: "Request body must include a message string.",
      });
    }

    const resolvedUserId = userId || "demo-user";
    const token = await getAccessToken();

    let resolvedSessionId = sessionId;
    if (!resolvedSessionId) {
      resolvedSessionId = await createSession(token, resolvedUserId);
    }

    const data = await sendMessage(
      token,
      resolvedUserId,
      resolvedSessionId,
      message
    );

    return res.status(200).json({
      response: data,
      sessionId: resolvedSessionId,
      userId: resolvedUserId,
    });

  } catch (error) {
    console.error("AskMySchool API error:", error);
    return res.status(500).json({
      error: "Chat request failed",
      details: error.message || "Unknown server error",
    });
  }
};
