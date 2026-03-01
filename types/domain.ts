export type CRMEntityType = "sale" | "rent" | "buyer" | "client" | "other";

export interface IntakeSession {
  id: string;
  rawText: string;
  mediaPaths: string[];
  suggestedType: CRMEntityType;
  selectedType: CRMEntityType;
  confidence: number;
  extractedData: Record<string, unknown>;
  status: "draft" | "review_required" | "ready" | "saved";
}

export interface TimelineEvent {
  id: string;
  entityType: CRMEntityType;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
