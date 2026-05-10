const { GoogleAuth } = require("google-auth-library");

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

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();

    const endpoint =
      "https://us-west1-aiplatform.googleapis.com/v1/projects/346318948573/locations/us-west1/reasoningEngines/3007568922246381568:query";

    const response = await client.request({
      url: endpoint,
      method: "POST",
      data: {
        classMethod: "stream_query",
        input: {
          message: message,
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
