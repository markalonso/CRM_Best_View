import { z } from "zod";
import { getOpenAIClient } from "./openai-client";

const classificationSchema = z.object({
  suggested_type: z.enum(["sale", "rent", "buyer", "client", "other"]),
  confidence: z.number().min(0).max(1),
  reason: z.string()
});

export class IntakeAIService {
  private readonly model = "gpt-4o-mini";

  async classify(rawText: string) {
    const completion = await getOpenAIClient().chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Classify intake into sale/rent/buyer/client/other and return JSON." },
        { role: "user", content: rawText }
      ]
    });

    return classificationSchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
  }
}
