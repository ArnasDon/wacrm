const OpenAI = require("openai");

async function run() {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-nano",
    input: "Reply with only: OK",
  });

  console.log("SUCCESS:");
  console.log(response.output_text);
}

run().catch((err) => {
  console.error("ERROR:");
  console.error(err);
});
