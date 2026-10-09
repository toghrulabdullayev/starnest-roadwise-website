/** Verifies GEMINI_API_KEY / GEMINI_MODEL with one tiny structured-output call.  npm run gemini:check */
import "./env";
import { GoogleGenAI } from "@google/genai";

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const t0 = Date.now();
  const i = await client.interactions.create({
    model,
    input: "How many wheels does a car have?",
    system_instruction: "Answer in JSON only.",
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: { type: "object", properties: { wheels: { type: "integer" } }, required: ["wheels"] },
    },
    generation_config: { temperature: 0.2 },
    store: false,
  });
  console.log(`OK ${model} in ${Date.now() - t0} ms → ${i.output_text} (usage ${JSON.stringify(i.usage)})`);
})().catch((e) => {
  console.error(`Gemini check failed: ${String(e).slice(0, 300)}`);
  process.exit(1);
});
