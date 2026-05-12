const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "pinevera-askmyschool";
const FIRESTORE_DATABASE = "%28default%29";

const SCHOOL_OPTIONS = {
  "1": { school_id: "districtwide", label: "Districtwide" },
  "2": { school_id: "ben_hill_primary", label: "Ben Hill Primary School" },
  "3": { school_id: "ben_hill_elementary", label: "Ben Hill Elementary School" },
  "4": { school_id: "ben_hill_middle", label: "Ben Hill Middle School" },
  "5": { school_id: "fitzgerald_high", label: "Fitzgerald High School" },
};

const CATEGORY_OPTIONS = {
  "1": { category: "closure", title: "School Closure", priority: "high" },
  "2": { category: "delay", title: "School Delay", priority: "high" },
  "3": { category: "bus_delay", title: "Bus Delay", priority: "normal" },
  "4": { category: "event_change", title: "Event Change", priority: "normal" },
  "5": { category: "other", title: "Emergency Update", priority: "normal" },
};

async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  return tokenResponse.token;
}

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message
  )}</Message></Response>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePhone(value) {
  return String(value || "").trim();
}

function getIncomingBody(req) {
  if (typeof req.body === "object" && req.body !== null) {
    return req.body;
  }

  const params = new URLSearchParams(req.body || "");
  return Object.fromEntries(params.entries());
}

function firestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents`;
}

async function firestoreRunQuery(token, collectionId, whereField, whereValue) {
  const url = `${firestoreBaseUrl()}:runQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: whereField },
            op: "EQUAL",
            value: { stringValue: whereValue },
          },
        },
        limit: 1,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  const found = data.find((item) => item.document);
  return found?.document || null;
}

async function createFirestoreDocument(token, collectionId, fields) {
  const url = `${firestoreBaseUrl()}/${collectionId}`;

  const response = await fetch(url, {
    method: "POST",
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

async function deleteFirestoreDocument(token, documentName) {
  const url = `https://firestore.googleapis.com/v1/${documentName}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(JSON.stringify(data));
  }
}

function toFirestoreString(value) {
  return { stringValue: String(value || "") };
}

function toFirestoreBoolean(value) {
  return { booleanValue: Boolean(value) };
}

function toFirestoreTimestamp(date) {
  return { timestampValue: date.toISOString() };
}

function toFirestoreInteger(value) {
  return { integerValue: String(value || 0) };
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

function addHours(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

function easternDateAt(hour, dayOffset = 0) {
  const now = new Date();

  const easternNow = new Date(
    now.toLocaleString("en-US", {
      timeZone: "America/New_York",
    })
  );

  easternNow.setDate(easternNow.getDate() + dayOffset);
  easternNow.setHours(hour, 0, 0, 0);

  return easternNow;
}

function endOfSchoolDay() {
  return easternDateAt(18, 0);
}

function tomorrowAtSixPm() {
  return easternDateAt(18, 1);
}

function getExpiration(option) {
  if (option === "1") return addHours(2);
  if (option === "2") return endOfSchoolDay();
  if (option === "3") return tomorrowAtSixPm();
  return tomorrowAtSixPm();
}

function formatTimestampForText(value) {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function startMessage() {
  return (
    "AskMySchool Rapid Notice\n\n" +
    "Who should this update apply to?\n" +
    "1 Districtwide\n" +
    "2 Primary\n" +
    "3 Elementary\n" +
    "4 Middle\n" +
    "5 High School\n\n" +
    "Reply with a number."
  );
}

function categoryMessage() {
  return (
    "What type of update is this?\n" +
    "1 School Closure\n" +
    "2 School Delay\n" +
    "3 Bus Delay\n" +
    "4 Event Change\n" +
    "5 Other\n\n" +
    "Reply with a number."
  );
}

function expirationMessage() {
  return (
    "When should this update expire?\n" +
    "1 In 2 hours\n" +
    "2 End of school day\n" +
    "3 Tomorrow at 6 PM\n\n" +
    "Reply with a number."
  );
}

function confirmMessage(session) {
  const schoolLabel = readField(session, "school_label");
  const title = readField(session, "title");
  const message = readField(session, "message");
  const activeUntil = readField(session, "active_until");

  return (
    "Review this update:\n\n" +
    `Scope: ${schoolLabel}\n` +
    `Type: ${title}\n` +
    `Message: ${message}\n` +
    `Expires: ${formatTimestampForText(activeUntil)}\n\n` +
    "Reply YES to publish or NO to cancel."
  );
}

async function createOrResetSession(token, senderDoc, fromPhone) {
  const districtId = readField(senderDoc, "district_id");
  const staffName = readField(senderDoc, "staff_name");

  return await createFirestoreDocument(token, "emergency_update_sessions", {
    phone_number: toFirestoreString(fromPhone),
    district_id: toFirestoreString(districtId),
    staff_name: toFirestoreString(staffName),
    step: toFirestoreString("scope"),
    status: toFirestoreString("in_progress"),
    created_at: toFirestoreTimestamp(new Date()),
    updated_at: toFirestoreTimestamp(new Date()),
  });
}

async function publishEmergencyUpdate(token, session, fromPhone) {
  const now = new Date();
  const activeUntilValue = readField(session, "active_until");
  const activeUntil = new Date(activeUntilValue);

  await createFirestoreDocument(token, "emergency_updates", {
    district_id: toFirestoreString(readField(session, "district_id")),
    school_id: toFirestoreString(readField(session, "school_id")),
    school_label: toFirestoreString(readField(session, "school_label")),
    status: toFirestoreString("active"),
    category: toFirestoreString(readField(session, "category")),
    title: toFirestoreString(readField(session, "title")),
    message: toFirestoreString(readField(session, "message")),
    priority: toFirestoreString(readField(session, "priority")),
    source: toFirestoreString("sms"),
    created_by: toFirestoreString(readField(session, "staff_name")),
    sender_phone: toFirestoreString(fromPhone),
    active_from: toFirestoreTimestamp(now),
    active_until: toFirestoreTimestamp(activeUntil),
    created_at: toFirestoreTimestamp(now),
    can_display: toFirestoreBoolean(true),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Content-Type", "text/xml");
    return res.status(405).send(twiml("Method not allowed."));
  }

  try {
    const body = getIncomingBody(req);

    const fromPhone = normalizePhone(body.From);
    const messageText = String(body.Body || "").trim();
    const normalizedMessage = messageText.toUpperCase();

    const token = await getAccessToken();

    const senderDoc = await firestoreRunQuery(
      token,
      "authorized_senders",
      "phone_number",
      fromPhone
    );

    if (!senderDoc) {
      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(
          twiml(
            "This number is not authorized to create AskMySchool emergency updates."
          )
        );
    }

    const senderStatus = readField(senderDoc, "status");

    if (senderStatus !== "active") {
      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(
          twiml(
            "This number is currently inactive for AskMySchool emergency updates."
          )
        );
    }

    let sessionDoc = await firestoreRunQuery(
      token,
      "emergency_update_sessions",
      "phone_number",
      fromPhone
    );

    if (normalizedMessage === "CANCEL" || normalizedMessage === "NO") {
      if (sessionDoc) {
        await deleteFirestoreDocument(token, sessionDoc.name);
      }

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml("Rapid Notice canceled."));
    }

    if (
      !sessionDoc ||
      normalizedMessage === "UPDATE" ||
      normalizedMessage === "START"
    ) {
      if (sessionDoc) {
        await deleteFirestoreDocument(token, sessionDoc.name);
      }

      await createOrResetSession(token, senderDoc, fromPhone);

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml(startMessage()));
    }

    const step = readField(sessionDoc, "step");

    if (step === "scope") {
      const selectedSchool = SCHOOL_OPTIONS[messageText];

      if (!selectedSchool) {
        res.setHeader("Content-Type", "text/xml");
        return res
          .status(200)
          .send(twiml("Please reply with 1, 2, 3, 4, or 5."));
      }

      await updateFirestoreDocument(token, sessionDoc.name, {
        school_id: toFirestoreString(selectedSchool.school_id),
        school_label: toFirestoreString(selectedSchool.label),
        step: toFirestoreString("category"),
        updated_at: toFirestoreTimestamp(new Date()),
      });

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml(categoryMessage()));
    }

    if (step === "category") {
      const selectedCategory = CATEGORY_OPTIONS[messageText];

      if (!selectedCategory) {
        res.setHeader("Content-Type", "text/xml");
        return res
          .status(200)
          .send(twiml("Please reply with 1, 2, 3, 4, or 5."));
      }

      await updateFirestoreDocument(token, sessionDoc.name, {
        category: toFirestoreString(selectedCategory.category),
        title: toFirestoreString(selectedCategory.title),
        priority: toFirestoreString(selectedCategory.priority),
        step: toFirestoreString("message"),
        updated_at: toFirestoreTimestamp(new Date()),
      });

      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(
          twiml(
            "What message should parents see? Example: School is canceled tomorrow due to severe weather."
          )
        );
    }

    if (step === "message") {
      if (!messageText || messageText.length < 5) {
        res.setHeader("Content-Type", "text/xml");
        return res
          .status(200)
          .send(twiml("Please send the full message parents should see."));
      }

      await updateFirestoreDocument(token, sessionDoc.name, {
        message: toFirestoreString(messageText),
        step: toFirestoreString("expiration"),
        updated_at: toFirestoreTimestamp(new Date()),
      });

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml(expirationMessage()));
    }

    if (step === "expiration") {
      if (!["1", "2", "3"].includes(messageText)) {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(twiml("Please reply with 1, 2, or 3."));
      }

      const activeUntil = getExpiration(messageText);

      await updateFirestoreDocument(token, sessionDoc.name, {
        active_until: toFirestoreTimestamp(activeUntil),
        expiration_choice: toFirestoreInteger(messageText),
        step: toFirestoreString("confirm"),
        updated_at: toFirestoreTimestamp(new Date()),
      });

      const updatedSession = await firestoreRunQuery(
        token,
        "emergency_update_sessions",
        "phone_number",
        fromPhone
      );

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml(confirmMessage(updatedSession)));
    }

    if (step === "confirm") {
      if (normalizedMessage !== "YES") {
        res.setHeader("Content-Type", "text/xml");
        return res
          .status(200)
          .send(twiml("Reply YES to publish or NO to cancel."));
      }

      await publishEmergencyUpdate(token, sessionDoc, fromPhone);
      await deleteFirestoreDocument(token, sessionDoc.name);

      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(
          twiml(
            "Update published. AskMySchool will show this notice while it is active."
          )
        );
    }

    await deleteFirestoreDocument(token, sessionDoc.name);

    res.setHeader("Content-Type", "text/xml");
    return res
      .status(200)
      .send(twiml("Something got out of sync. Text UPDATE to start over."));
  } catch (error) {
    console.error("Twilio webhook error:", error);

    res.setHeader("Content-Type", "text/xml");
    return res
      .status(200)
      .send(
        twiml("AskMySchool could not process that update. Please try again.")
      );
  }
};
