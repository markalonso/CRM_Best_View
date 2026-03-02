import { IntakeAIService } from "@/services/ai/intake-ai.service";

const intakeAI = new IntakeAIService();

export async function classifyIntakeInput(rawText: string) {
  return intakeAI.classify(rawText);
}
