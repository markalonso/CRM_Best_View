import { google, sheets_v4 } from "googleapis";
import { env } from "@/lib/env";

export type SheetDataset = "sale" | "rent" | "buyer" | "client" | "inbox";

const TAB_NAMES: Record<SheetDataset, string> = {
  sale: "Sale",
  rent: "Rent",
  buyer: "Buyers",
  client: "Clients",
  inbox: "Inbox"
};

function parseSpreadsheetId(value: string) {
  if (!value) return "";
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || value.trim();
}

function getAuth() {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing Google service account configuration");
  }

  return new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

export class GoogleSheetsIntegrationService {
  private getSheetsClient() {
    const auth = getAuth();
    return google.sheets({ version: "v4", auth });
  }

  parseSpreadsheetId(input: string) {
    return parseSpreadsheetId(input);
  }

  async ensureSpreadsheet(spreadsheetIdOrUrl?: string) {
    const sheets = this.getSheetsClient();
    const parsed = parseSpreadsheetId(spreadsheetIdOrUrl || "") || env.GOOGLE_SHEETS_SPREADSHEET_ID || "";

    if (parsed) {
      const { data } = await sheets.spreadsheets.get({ spreadsheetId: parsed });
      return { spreadsheetId: parsed, spreadsheetUrl: data.spreadsheetUrl || "" };
    }

    const { data } = await sheets.spreadsheets.create({ requestBody: { properties: { title: `CRM Export ${new Date().toISOString().slice(0, 10)}` } } });
    return { spreadsheetId: String(data.spreadsheetId || ""), spreadsheetUrl: String(data.spreadsheetUrl || "") };
  }

  async ensureTab(spreadsheetId: string, tabName: string) {
    const sheets = this.getSheetsClient();
    const sheet = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = (sheet.data.sheets || []).some((s) => s.properties?.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
      });
    }
  }

  async exportRows(dataset: SheetDataset, rows: Array<Record<string, unknown>>, spreadsheetIdOrUrl?: string) {
    const tabName = TAB_NAMES[dataset];
    const { spreadsheetId, spreadsheetUrl } = await this.ensureSpreadsheet(spreadsheetIdOrUrl);
    const sheets = this.getSheetsClient();

    await this.ensureTab(spreadsheetId, tabName);

    const keys = Array.from(
      rows.reduce((acc, row) => {
        Object.keys(row).forEach((key) => {
          if (key !== "media_counts") acc.add(key);
        });
        return acc;
      }, new Set<string>())
    );

    const values = [keys, ...rows.map((row) => keys.map((key) => {
      const value = row[key];
      if (Array.isArray(value)) return value.join(" | ");
      if (value == null) return "";
      return String(value);
    }))];

    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A:ZZ` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values }
    });

    return { spreadsheetId, spreadsheetUrl, tabName, rowCount: rows.length, columns: keys };
  }

  async previewTab(spreadsheetIdOrUrl: string, tabName: string) {
    const spreadsheetId = parseSpreadsheetId(spreadsheetIdOrUrl);
    if (!spreadsheetId) throw new Error("Spreadsheet ID is required");
    const sheets = this.getSheetsClient();

    const range = `${tabName}!A1:ZZ200`;
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = data.values || [];
    const headers = (rows[0] || []).map((h) => String(h));
    const sampleRows = rows.slice(1, 21).map((row) => row.map((v) => String(v)));

    return { spreadsheetId, tabName, headers, sampleRows };
  }

  async readTab(spreadsheetIdOrUrl: string, tabName: string) {
    const spreadsheetId = parseSpreadsheetId(spreadsheetIdOrUrl);
    if (!spreadsheetId) throw new Error("Spreadsheet ID is required");
    const sheets = this.getSheetsClient();
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:ZZ5000` });
    const rows = data.values || [];
    const headers = (rows[0] || []).map((h) => String(h));
    const records = rows.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, String(row[i] || "")])));
    return { spreadsheetId, headers, records };
  }

  getTabName(dataset: SheetDataset) {
    return TAB_NAMES[dataset];
  }
}

export const googleSheetsIntegrationService = new GoogleSheetsIntegrationService();
