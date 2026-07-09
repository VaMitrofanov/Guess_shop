import { createSign } from "crypto";

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_BASE = "https://sheets.googleapis.com";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

export type GoogleSheetInfo = {
  title: string;
  sheetId: number;
  index: number;
  hidden: boolean;
};

export type GoogleSheetRows = {
  range: string;
  values: unknown[][];
};

export type GoogleSheetsValueUpdate = {
  range: string;
  values: unknown[][];
};

export class GoogleSheetsError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "GOOGLE_SHEETS_ERROR") {
    super(message);
    this.name = "GoogleSheetsError";
    this.status = status;
    this.code = code;
  }
}

let tokenCache: TokenCache | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getServiceAccount() {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new GoogleSheetsError("Google Sheets service account is not configured", 500, "GOOGLE_SHEETS_NOT_CONFIGURED");
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("client_email/private_key are required");
    }
    return parsed as ServiceAccount;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new GoogleSheetsError(`Invalid GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: ${detail}`, 500, "GOOGLE_SHEETS_BAD_CONFIG");
  }
}

export function isGoogleSheetsConfigured() {
  return Boolean(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim());
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) return tokenCache.accessToken;

  const account = getServiceAccount();
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + 3600;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: account.token_uri || GOOGLE_TOKEN_URL,
    exp: expiresAt,
    iat: issuedAt,
  }));
  const unsignedJwt = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const assertion = `${unsignedJwt}.${base64Url(signer.sign(account.private_key))}`;

  const response = await fetch(account.token_uri || GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new GoogleSheetsError(json.error_description || json.error || "Google OAuth token request failed", response.status, "GOOGLE_OAUTH_FAILED");
  }

  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + Math.max(60, json.expires_in || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

async function googleFetch<T>(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${GOOGLE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string; status?: string } };
  if (!response.ok) {
    throw new GoogleSheetsError(data.error?.message || "Google Sheets request failed", response.status, data.error?.status || "GOOGLE_SHEETS_REQUEST_FAILED");
  }
  return data;
}

export function quoteGoogleSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

export function googleCellRange(title: string, column: string, row: number) {
  return `${quoteGoogleSheetTitle(title)}!${column}${row}`;
}

export async function listGoogleSheets(spreadsheetId: string) {
  const fields = "sheets(properties(title,sheetId,index,hidden))";
  const data = await googleFetch<{
    sheets?: Array<{ properties?: { title?: string; sheetId?: number; index?: number; hidden?: boolean } }>;
  }>(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`);

  return (data.sheets || [])
    .map((sheet) => sheet.properties)
    .filter((sheet): sheet is NonNullable<typeof sheet> & { title: string; sheetId: number } => Boolean(sheet?.title && sheet.sheetId !== undefined))
    .map((sheet) => ({
      title: sheet.title,
      sheetId: sheet.sheetId,
      index: sheet.index ?? 0,
      hidden: Boolean(sheet.hidden),
    }))
    .filter((sheet) => !sheet.hidden)
    .sort((a, b) => a.index - b.index);
}

export async function readGoogleSheetRows(spreadsheetId: string, title: string, range = "A:F") {
  const encodedRange = encodeURIComponent(`${quoteGoogleSheetTitle(title)}!${range}`);
  const data = await googleFetch<GoogleSheetRows>(
    `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  return {
    range: data.range,
    values: data.values || [],
  };
}

export async function batchUpdateGoogleSheetValues(spreadsheetId: string, updates: GoogleSheetsValueUpdate[]) {
  if (updates.length === 0) return { totalUpdatedCells: 0 };

  return googleFetch<{ totalUpdatedCells?: number }>(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates,
    }),
  });
}
