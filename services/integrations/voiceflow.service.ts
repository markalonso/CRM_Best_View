export class VoiceflowIntegrationService {
  async sendEvent(_event: string, _payload: Record<string, unknown>) {
    return { status: "not_implemented" as const };
  }
}
