const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "346318948573";
const LOCATION = "us-west1";
const REASONING_ENGINE_ID = "8691674601941368832";

const FIRESTORE_PROJECT_ID = "pinevera-askmyschool";
const FIRESTORE_DATABASE = "%28default%29";

const DEFAULT_DISTRICT_ID = "ben_hill_demo";
const DEFAULT_SCHOOL_ID = "districtwide";

const BASE_URL =
  `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/reasoningEngines/${REASONING_ENGINE_ID}`;

function firestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents`;
}

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
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/datastore",
    ],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  return tokenResponse.token;
}

function readField(document, fieldName) {
  const field = document?.fields?.[fieldName];

  if (!field) return "";

  return (
    field.stringValue ??
    field.booleanValue ??
    field.integerValue ??
    field.timestampValue ??
    ""
  );
}

function toFirestoreString(value) {
  return { stringValue: String(value || "") };
}

function toFirestoreBoolean(value) {
  return { booleanValue: Boolean(value) };
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

async function firestoreRunQuery(token, structuredQuery) {
  const url = `${firestoreBaseUrl()}:runQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.filter((item) => item.document).map((item) => item.document);
}

async function updateFirestoreDocument(token, documentName, fields) {
  const fieldPaths = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");

  const url = `https://firestore.googleapis.com/v1/${documentName}?${fieldPaths}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function getEmergencyUpdates(token, districtId, schoolId) {
  const documents = await firestoreRunQuery(token, {
    from: [{ collectionId: "emergency_updates" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: "district_id" },
              op: "EQUAL",
              value: { stringValue: districtId },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: "status" },
              op: "EQUAL",
              value: { stringValue: "active" },
            },
          },
        ],
      },
    },
  });

  const now = new Date();
  const activeUpdates = [];

  for (const doc of documents) {
    const activeUntil = new Date(readField(doc, "active_until"));

    if (activeUntil < now) {
      await updateFirestoreDocument(token, doc.name, {
        status: toFirestoreString("expired"),
        can_display: toFirestoreBoolean(false),
      });

      continue;
    }

    const updateSchoolId = readField(doc, "school_id");

    const appliesToSchool =
      updateSchoolId === "districtwide" ||
      updateSchoolId === schoolId;

    if (!appliesToSchool) {
      continue;
    }

    activeUpdates.push({
      title: readField(doc, "title"),
      message: readField(doc, "message"),
      district_id: readField(doc, "district_id"),
      school_id: updateSchoolId,
      school_scope: readField(doc, "school_label"),
      category: readField(doc, "category"),
      active_from: readField(doc, "active_from"),
      active_until: readField(doc, "active_until"),
      priority: readField(doc, "priority"),
      created_by: readField(doc, "created_by"),
    });
  }

  return {
    status: "success",
    has_active_notice: activeUpdates.length > 0,
    match_count: activeUpdates.length,
    updates: activeUpdates,
  };
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
        `District ID: ${update.district_id || ""}`,
        `School ID: ${update.school_id || ""}`,
        `School Scope: ${update.school_scope || ""}`,
        `Category: ${update.category || ""}`,
        `Active From: ${update.active_from || ""}`,
        `Active Until: ${update.active_until || ""}`,
        `Priority: ${update.priority || ""}`,
        `Created By: ${update.created_by || ""}`,
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
4. If the user's question is unrelated to the notice, answer normally.
5. Do not mention Firestore, databases, internal systems, or implementation details.

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
        chunk.content?.parts
          ?.map((part) => part.text)
          .filter(Boolean)
          .join("") ||
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
      token,
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
