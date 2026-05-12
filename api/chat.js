const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "346318948573";
const LOCATION = "us-west1";
const REASONING_ENGINE_ID = "8691674601941368832";

const EMERGENCY_UPDATES_URL =
  "https://script.google.com/macros/s/AKfycbzYg8OExvAIzsIfjxcmmViuF8AXYhVRQb12fT3tRAq-wsHjFOxwWDNbPj5ZqJtYADgy/exec";

const DEFAULT_DISTRICT_ID = "ben_hill_ga";
const DEFAULT_SCHOOL_ID = "districtwide";

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

async function getEmergencyUpdates(districtId, schoolId) {
  const url =
    `${EMERGENCY_UPDATES_URL}` +
    `?district_id=${encodeURIComponent(districtId)}` +
    `&school_id=${encodeURIComponent(schoolId)}` +
    `&format=json`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        status: "error",
        has_active_notice: false,
        match_count: 0,
        updates: [],
        error: `Emergency update response was not JSON: ${text}`,
      };
    }

    if (!response.ok) {
      return {
        status: "error",
        has_active_notice: false,
        match_count: 0,
        updates: [],
        error: JSON.stringify(data),
      };
    }

    return data;
  } catch (error) {
    return {
      status: "error",
      has_active_notice: false,
      match_count: 0,
      updates: [],
      error: error.message || "Emergency update check failed",
    };
  }
}

function buildEmergencyContext(emergencyData) {
  const updates = Array.isArray(emergencyData?.updates)
    ? emergencyData.updates
    : [];

  if (!emergencyData?.has_active_notice || updates.length === 0) {
    return "";
  }

  const updateBlocks = updates
    .map((update, index) => {
      return [
        `ACTIVE_NOTICE_${index + 1}:`,
        `Title: ${update.title || ""}`,
        `Message: ${update.message || ""}`,
        `District: ${update.district_name || ""}`,
        `District ID: ${update.district_id || ""}`,
        `School ID: ${update.school_id || ""}`,
        `School Scope: ${update.school_scope || ""}`,
        `Category: ${update.category || ""}`,
        `Event Date: ${update.event_date || ""}`,
        `Active From: ${update.active_from || ""}`,
        `Active Until: ${update.active_until || ""}`,
        `Priority: ${update.priority || ""}`,
        `Audience: ${update.audience || ""}`,
        `Keywords: ${update.keywords || ""}`,
      ].join("\n");
    })
    .join("\n\n");

  return `
[ACTIVE_EMERGENCY_OR_SCHOOL_NOTICE_CONTEXT]
There is one or more active district or school notices.

Rules:
1. Treat this notice as official district/school information.
2. If this is the first response in the session, mention the active notice before answering the user's question.
3. For later responses, do not repeat the notice unless it is relevant to the user's question.
4. If the user asks about the affected date, school, event, bus route, lunch, activity, or topic, apply the notice logically.
5. If the user's question is unrelated to the notice, answer normally.
6. Do not say the notice came from a spreadsheet, Apps Script, Vercel, or internal system.

${updateBlocks}
[/ACTIVE_EMERGENCY_OR_SCHOOL_NOTICE_CONTEXT]
`.trim();
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

async function sendMessage(token, userId, sessionId, message, emergencyData) {
  const emergencyContext = buildEmergencyContext(emergencyData);

  const messageWithContext = [
    `[current_date: ${getCurrentDateForAgent()}]`,
    emergencyContext,
    `[USER_MESSAGE]`,
    message,
    `[/USER_MESSAGE]`,
  ]
    .filter(Boolean)
    .join("\n\n");

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
        message: messageWithContext,
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
    const {
      message,
      sessionId,
      userId,
      districtId,
      schoolId,
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing message",
        details: "Request body must include a message string.",
      });
    }

    const resolvedUserId = userId || "demo-user";
    const resolvedDistrictId = districtId || DEFAULT_DISTRICT_ID;
    const resolvedSchoolId = schoolId || DEFAULT_SCHOOL_ID;

    const token = await getAccessToken();

    let resolvedSessionId = sessionId;

    if (!resolvedSessionId) {
      resolvedSessionId = await createSession(token, resolvedUserId);
    }

    const emergencyData = await getEmergencyUpdates(
      resolvedDistrictId,
      resolvedSchoolId
    );

    const data = await sendMessage(
      token,
      resolvedUserId,
      resolvedSessionId,
      message,
      emergencyData
    );

    return res.status(200).json({
      text: data.text,
      raw: data.raw,
      sessionId: resolvedSessionId,
      userId: resolvedUserId,
      districtId: resolvedDistrictId,
      schoolId: resolvedSchoolId,
      emergency: {
        status: emergencyData.status || "unknown",
        has_active_notice: Boolean(emergencyData.has_active_notice),
        match_count: emergencyData.match_count || 0,
        updates: emergencyData.updates || [],
        error: emergencyData.error || null,
      },
    });
  } catch (error) {
    console.error("AskMySchool API error:", error);

    return res.status(500).json({
      error: "Chat request failed",
      details: error.message || "Unknown server error",
    });
  }
};
