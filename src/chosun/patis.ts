import { createCipheriv } from "node:crypto";

export interface AcademicSession {
  sessionUser: string;
  serviceContextPath: string;
  ssoUserStatus?: string;
}

export interface PatisDataset {
  columns: string[];
  rows: Record<string, string>[];
}

export interface PatisParsedResponse {
  datasets: Record<string, PatisDataset>;
  metadata: Record<string, unknown>;
}

const GRADUATION_MENU_CD = "8021901000";

export function extractAcademicSession(html: string): AcademicSession {
  const match = /initParameter\((\{[\s\S]*?\})\);cpr\.core\.Platform/.exec(html);
  if (!match) {
    throw new Error("Could not find academic system initParameter payload.");
  }

  const params = JSON.parse(match[1]) as Record<string, unknown>;
  const sessionUser = stringValue(params.gv_sessionUser);
  if (!sessionUser) {
    throw new Error("Could not find academic system session user.");
  }

  return {
    sessionUser,
    serviceContextPath: stringValue(params.gv_serviceContextPath),
    ssoUserStatus: stringValue(params.gv_ssoUserSt) || undefined,
  };
}

export function inferCorsGb(session: AcademicSession): string {
  const match = /_(\d+)$/.exec(session.ssoUserStatus ?? "");
  return match?.[1] ?? "1";
}

export function buildPatisPayload(
  session: AcademicSession,
  serviceName: string,
  methodName: string,
  params: Record<string, string>,
  menuCd = GRADUATION_MENU_CD,
): string {
  const transactionId = createTransactionId();
  const entries: Array<[string, string]> = [
    ...Object.entries(params),
    ["FRAMEWORK_SERVICE_NAME", serviceName],
    ["FRAMEWORK_METHOD_NAME", methodName],
    ["FRAMEWORK_LANGUAGE_GB", "ko"],
    ["FRAMEWORK_TRANSACTION_ID", transactionId],
    ["FRAMEWORKLOG_PROTOCOL", "JSON"],
    ["FRAMEWORK_SESSION_USER", session.sessionUser],
    ["FRAMEWORK_FRAME_GB", "1"],
    ["FRAMEWORK_FRAME_INFO", "default"],
    ["FRAMEWORKLOG_SITE_MAP_YN", "0"],
    ["FRAMEWORK_MENU_CD", menuCd],
  ];

  const payload: Record<string, string[]> = {};
  let index = 1;
  for (const [key, value] of entries) {
    if (key === "FRAMEWORK_TRANSACTION_ID") {
      payload.FRAMEWORKLOG_PARAM0 = [encryptDataForAes(key, session.sessionUser)];
      payload.FRAMEWORKLOG_VALUE0 = [encryptDataForAes(value, session.sessionUser)];
    } else {
      payload[`FRAMEWORKLOG_PARAM${index}`] = [encryptDataForAes(key, transactionId)];
      payload[`FRAMEWORKLOG_VALUE${index}`] = [encryptDataForAes(value, transactionId)];
    }
    index += 1;
  }

  return JSON.stringify({ param: payload });
}

export function parsePatisTsv(text: string): PatisParsedResponse {
  const lines = text.split(/\r?\n/);
  const datasets: Record<string, PatisDataset> = {};
  const metadata: Record<string, unknown> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("@d#")) {
      continue;
    }

    const marker = line.slice(3);
    if (marker.startsWith("_METADATA_;CONTENT-TYPE=JSON")) {
      const jsonLine = lines[index + 1];
      if (jsonLine) {
        Object.assign(metadata, parseJsonObject(jsonLine));
        index += 1;
      }
      continue;
    }

    const [name, value] = marker.split("\t");
    if (!name.startsWith("ds_")) {
      metadata[name] = value ?? "";
      continue;
    }

    const header = lines[index + 1];
    if (!header || header.startsWith("@d#")) {
      datasets[name] = { columns: [], rows: [] };
      continue;
    }

    const columns = header.split("\t");
    const rows: Record<string, string>[] = [];
    index += 1;

    while (index + 1 < lines.length && !lines[index + 1].startsWith("@d#")) {
      index += 1;
      if (!lines[index]) {
        continue;
      }

      const values = lines[index].split("\t");
      rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex] ?? ""])));
    }

    datasets[name] = { columns, rows };
  }

  for (const [name, dataset] of Object.entries(datasets)) {
    if (dataset.columns.length > 0) {
      continue;
    }

    const columnMeta = metadata[`${name}_COLMETA`];
    if (Array.isArray(columnMeta) && columnMeta[0] && typeof columnMeta[0] === "object") {
      dataset.columns = Object.keys(columnMeta[0] as Record<string, unknown>);
    }
  }

  return { datasets, metadata };
}

export function patisContextForService(serviceName: string): string {
  const upper = serviceName.toUpperCase();
  if (upper.includes("CH_9999999_SERVICE")) {
    return "";
  }
  if (upper.includes("PATISHAKSA") || upper.startsWith("H")) {
    return "/haksa";
  }
  if (upper.startsWith("G")) {
    return "/haengjeong";
  }
  if (upper.startsWith("N")) {
    return "/ipsi";
  }
  if (upper.startsWith("R")) {
    return "/yeongu";
  }
  if (upper.startsWith("B")) {
    return "/danwieopmu";
  }
  if (upper.startsWith("C") || upper.startsWith("E")) {
    return "/common";
  }

  return "";
}

function createTransactionId(): string {
  const random = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  return `${Date.now()}${random}`.slice(0, 20);
}

function encryptDataForAes(data: string, key: string): string {
  if (!data || !key) {
    return data;
  }

  const aesKey = Buffer.from(key.replaceAll("-", "").slice(0, 16), "utf8");
  const cipher = createCipheriv("aes-128-cbc", aesKey, aesKey);
  return cipher.update(data, "utf8", "base64") + cipher.final("base64");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
