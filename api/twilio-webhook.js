const { GoogleAuth } = require("google-auth-library");

const PROJECT_ID = "pinevera-askmyschool";
const FIRESTORE_DATABASE = "%28default%29";

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

async function firestoreRunQuery(token, collectionId, whereField, whereValue) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents:runQuery`;

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
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents/${collectionId}`;

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

function toFirestoreString(value) {
  return { stringValue: String(value || "") };
}

function toFirestoreBoolean(value) {
  return { booleanValue: Boolean(value) };
}

function toFirestoreTimestamp(date) {
  return { timestampValue: date.toISOString() };
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

function getTomorrowAtSixPmEastern() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  return tomorrow;
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

    const districtId = readField(senderDoc, "district_id");
    const staffName = readField(senderDoc, "staff_name");

    if (!messageText || messageText.toUpperCase() === "UPDATE") {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(
        twiml(
          "AskMySchool Rapid Notice: reply with the emergency message you want parents to see. Example: School is canceled tomorrow due to severe weather."
        )
      );
    }

    const now = new Date();
    const activeUntil = getTomorrowAtSixPmEastern();

    await createFirestoreDocument(token, "emergency_updates", {
      district_id: toFirestoreString(districtId),
      school_id: toFirestoreString("districtwide"),
      status: toFirestoreString("active"),
      category: toFirestoreString("rapid_notice"),
      title: toFirestoreString("Emergency Update"),
      message: toFirestoreString(messageText),
      priority: toFirestoreString("high"),
      source: toFirestoreString("sms"),
      created_by: toFirestoreString(staffName),
      sender_phone: toFirestoreString(fromPhone),
      active_from: toFirestoreTimestamp(now),
      active_until: toFirestoreTimestamp(activeUntil),
      created_at: toFirestoreTimestamp(now),
      can_display: toFirestoreBoolean(true),
    });

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      twiml(
        "Update submitted. AskMySchool will now show this notice while it is active."
      )
    );
  } catch (error) {
    console.error("Twilio webhook error:", error);

    res.setHeader("Content-Type", "text/xml");
    return res
      .status(200)
      .send(twiml("AskMySchool could not save that update. Please try again."));
  }
};
