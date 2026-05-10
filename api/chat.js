const { GoogleAuth } = require("google-auth-library");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();

    const endpoint =
     "https://us-west1-aiplatform.googleapis.com/v1/projects/pinevera-askmyschool/locations/us-west1/reasoningEngines/5673699901649715200:query";

    const response = await client.request({
      url: endpoint,
      method: "POST",
      data: {
        input: {
          text: message
        }
      }
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Chat request failed",
      details: error.message
    });
  }
};
