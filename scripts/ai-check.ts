/** Verifies OPENAI_API_KEY / OPENAI_MODEL with one tiny structured-output call.  npm run ai:check */
import "./env";
import { aiModel, generateJson } from "../lib/ai/llm";

(async () => {
  const out = await generateJson({
    system: "Answer in JSON only.",
    input: "How many wheels does a car have?",
    schema: { type: "object", properties: { wheels: { type: "integer" } }, required: ["wheels"] },
  });
  console.log(`OK ${aiModel()} in ${out.latencyMs} ms → ${out.text} (tokens in ${out.inputTokens}, out ${out.outputTokens})`);
})().catch((e) => {
  console.error(`AI check failed: ${String(e).slice(0, 300)}`);
  process.exit(1);
});
