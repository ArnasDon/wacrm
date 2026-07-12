const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function run() {
  console.log("API Key Exists:", !!apiKey);
  console.log("Model:", modelName);

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: modelName,
  });

  const result = await model.generateContent("Say hello in one sentence.");

  console.log(result.response.text());
}

run().catch(console.error);
