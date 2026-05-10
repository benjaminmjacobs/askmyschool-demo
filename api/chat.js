const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "346318948573";
const LOCATION = "us-west1";
const REASONING_ENGINE_ID = "6841821054998937600";

const BASE_URL =
  `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/reasoningEngines/${REASONING_ENGINE_ID}`;

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
    }),
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Session response was not JSON: ${text}`);
  }

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  const sessionName = data.response?.name || data.name;

  if (!sessionName) {
    throw new Error(`Could not create session: ${JSON.stringify(data)}`);
  }

  return sessionName.split("/").pop();
}

function parseStreamResponse(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = [];

  for (const line of lines) {
    try {
      chunks.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON stream lines
    }
  }

  const collectedText = chunks
    .map((chunk) => {
      return (
        chunk.content?.parts?.map((part) => part.text).filter(Boolean).join("") ||
        chunk.output?.text ||
        chunk.response?.text ||
        chunk.text ||
        ""
      );
    })
    .filter(Boolean)
    .join("");

  return {
    text: collectedText || JSON.stringify(chunks, null, 2),
    raw: chunks,
  };
}

async function sendMessage(token, userId, sessionId, message) {
  const messageWithDate =
    `[current_date: ${getCurrentDateForAgent()}]\n\n${message}`;

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
        message: messageWithDate,
      },
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return parseStreamResponse(text);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
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
      text: data.text,
      raw: data.raw,
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
