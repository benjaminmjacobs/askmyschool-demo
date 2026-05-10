const { GoogleAuth } = require("google-auth-library");

function getCurrentDateForAgent() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return `${formatter.format(new Date())}[America/New_York]`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing message",
        details: "Request body must include a message string.",
      });
    }

    const currentDate = getCurrentDateForAgent();

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();

    const endpoint =
      "https://us-west1-aiplatform.googleapis.com/v1/projects/346318948573/locations/us-west1/reasoningEngines/6128000514060713984:streamQuery";

    const response = await client.request({
      url: endpoint,
      method: "POST",
      data: {
        input: {
          user_id: "demo-user",
          session_id: "demo-session",
          message: message,
          state: {
            current_date: currentDate,
          },
        },
      },
    });

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("AskMySchool API error:", error);

    return res.status(500).json({
      error: "Chat request failed",
      details:
        error.response?.data ||
        error.message ||
        "Unknown server error",
    });
  }
};
