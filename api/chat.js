const { GoogleAuth } = require("google-auth-library");
const { BigQuery } = require("@google-cloud/bigquery");
const crypto = require("crypto");

const PROJECT_ID = "346318948573";
const LOCATION = "us-west1";
const REASONING_ENGINE_ID = "9058577234083708928";

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

function getCredentials() {
  return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

async function getAccessToken() {
  const credentials = getCredentials();

  const auth = new GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/bigquery",
    ],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  return tokenResponse.token;
}

function getBigQueryClient() {
  return new BigQuery({
    projectId: process.env.BIGQUERY_PROJECT_ID || "pinevera-askmyschool",
    credentials: getCredentials(),
  });
}

async function logChatInteraction(row) {
  const bigQueryStartTime = Date.now();

  try {
    if (
      !process.env.BIGQUERY_PROJECT_ID ||
      !process.env.BIGQUERY_DATASET ||
      !process.env.BIGQUERY_TABLE ||
      !process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ) {
      console.warn("BigQuery logging skipped: missing environment variable.");
      return;
    }

    const bigquery = getBigQueryClient();

    await bigquery
      .dataset(process.env.BIGQUERY_DATASET)
      .table(process.env.BIGQUERY_TABLE)
      .insert([
        {
          ...row,
          bigquery_latency_ms: 0,
        },
      ]);

    console.log("BigQuery logging completed in", Date.now() - bigQueryStartTime, "ms");
  } catch (error) {
    console.error("BigQuery logging failed:", error);
  }
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

function normalizeSelectedSchoolIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((schoolId) => String(schoolId || "").trim())
    .filter(Boolean);
}

function detectExplicitSchoolIdsFromMessage(message) {
  const text = String(message || "").toLowerCase();

  const schoolAliasRules = [
    {
      schoolId: "ben_hill_primary",
      aliases: ["ben hill primary", "primary school", "primary", "bhp"],
    },
    {
      schoolId: "ben_hill_elementary",
      aliases: ["ben hill elementary", "elementary school", "elementary", "bhe"],
    },
    {
      schoolId: "ben_hill_middle",
      aliases: ["ben hill middle", "middle school", "middle", "bhms"],
    },
    {
      schoolId: "fitzgerald_high",
      aliases: [
        "fitzgerald high school",
        "fitzgerald high",
        "high school",
        "fhsc",
        "fhscca",
        "fhs",
      ],
    },
    {
      schoolId: "ben_hill_prek",
      aliases: ["ben hill pre-k", "ben hill prek", "pre-k", "prek", "pre k"],
    },
  ];

  const matches = [];

  for (const rule of schoolAliasRules) {
    const matched = rule.aliases.some((alias) => text.includes(alias));

    if (matched) {
      matches.push(rule.schoolId);
    }
  }

  return [...new Set(matches)];
}

function buildEffectiveSchoolIds(selectedSchoolIds, userMessage) {
  const normalizedSelectedSchoolIds = normalizeSelectedSchoolIds(selectedSchoolIds);
  const explicitSchoolIds = detectExplicitSchoolIdsFromMessage(userMessage);

  return [
    ...new Set([
      DEFAULT_SCHOOL_ID,
      ...normalizedSelectedSchoolIds,
      ...explicitSchoolIds,
    ]),
  ];
}

function classifyQuestion(message, emergencyData) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("emergency") ||
    text.includes("update") ||
    text.includes("notice") ||
    text.includes("alert") ||
    text.includes("closed") ||
    text.includes("closure") ||
    text.includes("delay") ||
    text.includes("delayed") ||
    text.includes("early release") ||
    text.includes("cancel") ||
    text.includes("canceled") ||
    text.includes("cancelled") ||
    text.includes("weather") ||
    text.includes("storm") ||
    text.includes("is there school") ||
    text.includes("school tomorrow") ||
    text.includes("no school") ||
    text.includes("do we have school")
  ) {
    return "emergency_calendar_status";
  }

  if (
    text.includes("lunch") ||
    text.includes("breakfast") ||
    text.includes("menu") ||
    text.includes("eat") ||
    text.includes("food") ||
    text.includes("cafeteria") ||
    text.includes("meal")
  ) {
    return "menus";
  }

  if (
    text.includes("calendar") ||
    text.includes("when is") ||
    text.includes("what day") ||
    text.includes("holiday") ||
    text.includes("spring break") ||
    text.includes("fall break") ||
    text.includes("winter break") ||
    text.includes("thanksgiving break") ||
    text.includes("graduation") ||
    text.includes("honors day") ||
    text.includes("event") ||
    text.includes("open house") ||
    text.includes("picture day") ||
    text.includes("testing date") ||
    text.includes("last day of school") ||
    text.includes("first day of school")
  ) {
    return "calendars";
  }

  if (
    text.includes("discipline") ||
    text.includes("punishment") ||
    text.includes("suspended") ||
    text.includes("suspension") ||
    text.includes("expelled") ||
    text.includes("expulsion") ||
    text.includes("dress code") ||
    text.includes("attendance") ||
    text.includes("absent") ||
    text.includes("tardy") ||
    text.includes("handbook") ||
    text.includes("policy") ||
    text.includes("rules") ||
    text.includes("medicine") ||
    text.includes("medication") ||
    text.includes("phone policy") ||
    text.includes("cell phone") ||
    text.includes("bully") ||
    text.includes("bullying")
  ) {
    return "student_policies";
  }

  if (
    text.includes("grade") ||
    text.includes("grades") ||
    text.includes("test") ||
    text.includes("testing") ||
    text.includes("milestones") ||
    text.includes("eoc") ||
    text.includes("end of course") ||
    text.includes("homework") ||
    text.includes("academic") ||
    text.includes("class") ||
    text.includes("course") ||
    text.includes("credits") ||
    text.includes("graduation requirement") ||
    text.includes("promotion") ||
    text.includes("retention") ||
    text.includes("mtss") ||
    text.includes("rti") ||
    text.includes("504") ||
    text.includes("iep") ||
    text.includes("sped") ||
    text.includes("special education")
  ) {
    return "academics_support";
  }

  if (
    text.includes("address") ||
    text.includes("principal") ||
    text.includes("office") ||
    text.includes("contact") ||
    text.includes("phone number") ||
    text.includes("email") ||
    text.includes("superintendent") ||
    text.includes("who do i call") ||
    text.includes("who should i call") ||
    text.includes("number") ||
    text.includes("front desk") ||
    text.includes("teacher") ||
    text.includes("counselor")
  ) {
    return "directory_contacts";
  }

  if (
    text.includes("football") ||
    text.includes("baseball") ||
    text.includes("basketball") ||
    text.includes("softball") ||
    text.includes("soccer") ||
    text.includes("volleyball") ||
    text.includes("track") ||
    text.includes("tennis") ||
    text.includes("golf") ||
    text.includes("wrestling") ||
    text.includes("cheer") ||
    text.includes("athletic") ||
    text.includes("athletics") ||
    text.includes("sports") ||
    text.includes("club") ||
    text.includes("clubs") ||
    text.includes("band") ||
    text.includes("chorus") ||
    text.includes("drama") ||
    text.includes("theater") ||
    text.includes("extracurricular") ||
    text.includes("activity") ||
    text.includes("activities")
  ) {
    return "athletics_extracurricular";
  }

  if (
    text.includes("enroll") ||
    text.includes("enrollment") ||
    text.includes("registration") ||
    text.includes("register") ||
    text.includes("new student") ||
    text.includes("transfer") ||
    text.includes("withdraw") ||
    text.includes("withdrawal")
  ) {
    return "enrollment_registration";
  }

  if (
    text.includes("bus") ||
    text.includes("transportation") ||
    text.includes("pickup") ||
    text.includes("drop off") ||
    text.includes("drop-off") ||
    text.includes("car rider") ||
    text.includes("car line")
  ) {
    return "transportation";
  }

  if (
    text.includes("stupid") ||
    text.includes("idiot") ||
    text.includes("dumb") ||
    text.includes("hate this") ||
    text.includes("this sucks") ||
    text.includes("you suck") ||
    text.includes("useless")
  ) {
    return "frustrated_or_abusive_user";
  }

  return "general_school_question";
}

function determineAnswerStatus(finalResponse, errorMessage, emergencyData) {
  if (errorMessage) return "error";

  const responseText = String(finalResponse || "").toLowerCase();

  if (
    responseText.includes("couldn't find") ||
    responseText.includes("couldn’t find") ||
    responseText.includes("could not find") ||
    responseText.includes("i couldn't find") ||
    responseText.includes("i couldn’t find") ||
    responseText.includes("i could not find") ||
    responseText.includes("don't have that information") ||
    responseText.includes("don’t have that information") ||
    responseText.includes("do not have that information") ||
    responseText.includes("no information") ||
    responseText.includes("i don't see") ||
    responseText.includes("i don’t see") ||
    responseText.includes("not listed") ||
    responseText.includes("not available")
  ) {
    return "no_answer_found";
  }

  if (emergencyData?.has_active_notice) {
    return "answered_with_emergency_context";
  }

  return "answered";
}

function determineResponseSource(emergencyData, success) {
  if (!success) return "vercel_error";

  if (emergencyData?.has_active_notice) {
    return "agent_engine_with_emergency_context";
  }

  return "agent_engine";
}

function getEmergencyUpdateIds(emergencyData) {
  const updates = Array.isArray(emergencyData?.updates)
    ? emergencyData.updates
    : [];

  return updates
    .map((update) => update.update_id || update.title || "")
    .filter(Boolean)
    .join(", ");
}

function getFrontendSource(req, requestBody) {
  return (
    requestBody.frontendSource ||
    requestBody.source ||
    req.headers.origin ||
    req.headers.referer ||
    "unknown"
  );
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

async function getEmergencyUpdates(
  token,
  districtId,
  selectedSchoolIds = [],
  userMessage = ""
) {
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
  const effectiveSchoolIds = buildEffectiveSchoolIds(selectedSchoolIds, userMessage);

  for (const doc of documents) {
    const activeUntil = new Date(readField(doc, "active_until"));

    if (activeUntil < now) {
      await updateFirestoreDocument(token, doc.name, {
        status: toFirestoreString("expired"),
        can_display: toFirestoreBoolean(false),
      });

      continue;
    }

    const canDisplay = readField(doc, "can_display");

    if (canDisplay === false) {
      continue;
    }

    const updateSchoolId = readField(doc, "school_id");

    const appliesToSchool =
      updateSchoolId === DEFAULT_SCHOOL_ID ||
      effectiveSchoolIds.includes(updateSchoolId);

    if (!appliesToSchool) {
      continue;
    }

    activeUpdates.push({
      update_id: readField(doc, "update_id"),
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
    checked_school_ids: effectiveSchoolIds,
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
        `Update ID: ${update.update_id || ""}`,
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
2. If the user's question asks about an active notice, emergency update, delay, closure, cancellation, schedule change, or the affected school, mention the relevant notice before any other answer.
3. If the user's selected schools or question match a notice, the notice is relevant.
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
  const requestStartTime = Date.now();
  const requestId = crypto.randomUUID();

  let errorStage = "request_started";

  let message = "";
  let resolvedSessionId = "";
  let resolvedUserId = "demo-user";
  let resolvedDistrictId = DEFAULT_DISTRICT_ID;
  let resolvedChannel = "web";
  let selectedSchoolIds = [];
  let effectiveSchoolIds = [DEFAULT_SCHOOL_ID];
  let emergencyData = null;
  let frontendSource = "unknown";

  let firestoreLatencyMs = 0;
  let agentLatencyMs = 0;

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    errorStage = "parse_request";

    const requestBody = req.body || {};

    message = requestBody.message;
    resolvedSessionId = requestBody.sessionId || "";
    resolvedUserId = requestBody.userId || "demo-user";
    resolvedDistrictId = requestBody.districtId || DEFAULT_DISTRICT_ID;
    resolvedChannel = requestBody.channel || "web";
    frontendSource = getFrontendSource(req, requestBody);

    selectedSchoolIds = normalizeSelectedSchoolIds(requestBody.selectedSchoolIds);

    if (selectedSchoolIds.length === 0 && requestBody.schoolId) {
      selectedSchoolIds = normalizeSelectedSchoolIds([requestBody.schoolId]);
    }

    effectiveSchoolIds = buildEffectiveSchoolIds(selectedSchoolIds, message);

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing message",
        details: "Request body must include a message string.",
      });
    }

    errorStage = "get_access_token";
    const token = await getAccessToken();

    if (!resolvedSessionId) {
      errorStage = "create_session";
      resolvedSessionId = await createSession(token, resolvedUserId);
    }

    errorStage = "firestore_emergency_check";
    const firestoreStartTime = Date.now();

    emergencyData = await getEmergencyUpdates(
      token,
      resolvedDistrictId,
      selectedSchoolIds,
      message
    );

    firestoreLatencyMs = Date.now() - firestoreStartTime;

    errorStage = "agent_engine_request";
    const agentStartTime = Date.now();

    const data = await sendMessage(
      token,
      resolvedUserId,
      resolvedSessionId,
      message,
      emergencyData
    );

    agentLatencyMs = Date.now() - agentStartTime;

    const totalLatencyMs = Date.now() - requestStartTime;
    const routeHint = classifyQuestion(message, emergencyData);
    const finalText = data.text || "";

    errorStage = "bigquery_log_success";

    await logChatInteraction({
      timestamp: new Date().toISOString(),
      district_id: resolvedDistrictId,
      school_id: effectiveSchoolIds.join(", "),
      session_id: resolvedSessionId,
      user_id: resolvedUserId,
      request_id: requestId,
      environment: process.env.VERCEL_ENV || "unknown",

      user_question: message,
      final_response: finalText,

      question_category: routeHint,
      route_hint: routeHint,
      answer_status: determineAnswerStatus(finalText, null, emergencyData),
      response_source: determineResponseSource(emergencyData, true),
      channel: resolvedChannel,

      selected_school_ids: selectedSchoolIds.join(", "),
      effective_school_ids: effectiveSchoolIds.join(", "),
      emergency_triggered: Boolean(emergencyData?.has_active_notice),
      emergency_match_count: emergencyData?.match_count || 0,
      emergency_update_id: getEmergencyUpdateIds(emergencyData),

      latency_ms: totalLatencyMs,
      total_latency_ms: totalLatencyMs,
      firestore_latency_ms: firestoreLatencyMs,
      agent_latency_ms: agentLatencyMs,

      response_character_count: finalText.length,
      user_agent: req.headers["user-agent"] || "",
      frontend_source: frontendSource,

      success: true,
      error_message: "",
      error_stage: "",
      source: "vercel_api_chat",
      reasoning_engine_id: REASONING_ENGINE_ID,
    });

    return res.status(200).json({
      text: finalText,
      raw: data.raw,
      sessionId: resolvedSessionId,
      userId: resolvedUserId,
      districtId: resolvedDistrictId,
      schoolId: effectiveSchoolIds.join(", "),
      selectedSchoolIds,
      effectiveSchoolIds,
      requestId,
      timing: {
        total_latency_ms: totalLatencyMs,
        firestore_latency_ms: firestoreLatencyMs,
        agent_latency_ms: agentLatencyMs,
      },
      emergency: {
        status: emergencyData.status || "unknown",
        has_active_notice: Boolean(emergencyData.has_active_notice),
        match_count: emergencyData.match_count || 0,
        checked_school_ids: emergencyData.checked_school_ids || effectiveSchoolIds,
        updates: emergencyData.updates || [],
      },
    });
  } catch (error) {
    console.error("AskMySchool API error:", error);

    const totalLatencyMs = Date.now() - requestStartTime;
    const routeHint = classifyQuestion(message, emergencyData);

    await logChatInteraction({
      timestamp: new Date().toISOString(),
      district_id: resolvedDistrictId,
      school_id: effectiveSchoolIds.join(", "),
      session_id: resolvedSessionId || "unknown",
      user_id: resolvedUserId,
      request_id: requestId,
      environment: process.env.VERCEL_ENV || "unknown",

      user_question: message || "",
      final_response: "",

      question_category: routeHint,
      route_hint: routeHint,
      answer_status: "error",
      response_source: "vercel_error",
      channel: resolvedChannel,

      selected_school_ids: selectedSchoolIds.join(", "),
      effective_school_ids: effectiveSchoolIds.join(", "),
      emergency_triggered: Boolean(emergencyData?.has_active_notice),
      emergency_match_count: emergencyData?.match_count || 0,
      emergency_update_id: getEmergencyUpdateIds(emergencyData),

      latency_ms: totalLatencyMs,
      total_latency_ms: totalLatencyMs,
      firestore_latency_ms: firestoreLatencyMs,
      agent_latency_ms: agentLatencyMs,

      response_character_count: 0,
      user_agent: req.headers["user-agent"] || "",
      frontend_source: frontendSource,

      success: false,
      error_message: error.message || "Unknown server error",
      error_stage: errorStage,
      source: "vercel_api_chat",
      reasoning_engine_id: REASONING_ENGINE_ID,
    });

    return res.status(500).json({
      error: "Chat request failed",
      details: error.message || "Unknown server error",
      requestId,
      errorStage,
    });
  }
};
