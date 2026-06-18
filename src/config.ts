import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ChosunConfig {
  id: string;
  password: string;
}

export interface ChosunClcConfig extends ChosunConfig {
  enabled: boolean;
}

export interface ChosunClcConfigStatus {
  enabled: boolean;
  hasId: boolean;
  hasPassword: boolean;
}

export interface ChosunOjConfig extends ChosunConfig {
  enabled: boolean;
}

export interface ChosunOjConfigStatus {
  enabled: boolean;
  hasId: boolean;
  hasPassword: boolean;
}

export function loadEnvFile(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseEnvValue(rawValue);
  }
}

export function loadChosunConfig(): ChosunConfig {
  loadEnvFile();

  const id = process.env.chosun_id ?? process.env.CHOSUN_ID;
  const password = process.env.chosun_psw ?? process.env.CHOSUN_PSW;

  if (!id || !password) {
    throw new Error("Missing chosun_id/chosun_psw. Add them to .env or pass them as environment variables.");
  }

  return { id, password };
}

export function loadChosunClcConfig(): ChosunClcConfig {
  const status = getChosunClcConfigStatus();
  if (!status.enabled) {
    throw new Error("CLC/e-Class tools are disabled. Set chosun_clc_enabled=true in .env to enable them.");
  }

  const id = process.env.chosun_clc_id ?? process.env.CHOSUN_CLC_ID;
  const password = process.env.chosun_clc_psw ?? process.env.CHOSUN_CLC_PSW;

  if (!id || !password) {
    throw new Error("Missing chosun_clc_id/chosun_clc_psw. Add separate CLC credentials to .env or pass CHOSUN_CLC_ID/CHOSUN_CLC_PSW.");
  }

  return { enabled: true, id, password };
}

export function getChosunClcConfigStatus(): ChosunClcConfigStatus {
  loadEnvFile();

  const enabled = parseBoolean(process.env.chosun_clc_enabled ?? process.env.CHOSUN_CLC_ENABLED, false);
  const id = process.env.chosun_clc_id ?? process.env.CHOSUN_CLC_ID;
  const password = process.env.chosun_clc_psw ?? process.env.CHOSUN_CLC_PSW;

  return {
    enabled,
    hasId: Boolean(id),
    hasPassword: Boolean(password),
  };
}

export function isChosunClcEnabled(): boolean {
  return getChosunClcConfigStatus().enabled;
}

export function loadChosunOjConfig(): ChosunOjConfig {
  const status = getChosunOjConfigStatus();
  if (!status.enabled) {
    throw new Error("OJ tools are disabled. Set chosun_oj_enabled=true in .env to enable them.");
  }

  const id = process.env.chosun_oj_id ?? process.env.CHOSUN_OJ_ID;
  const password = process.env.chosun_oj_psw ?? process.env.CHOSUN_OJ_PSW;

  if (!id || !password) {
    throw new Error("Missing chosun_oj_id/chosun_oj_psw. Add separate OJ credentials to .env or pass CHOSUN_OJ_ID/CHOSUN_OJ_PSW.");
  }

  return { enabled: true, id, password };
}

export function getChosunOjConfigStatus(): ChosunOjConfigStatus {
  loadEnvFile();

  const enabled = parseBoolean(process.env.chosun_oj_enabled ?? process.env.CHOSUN_OJ_ENABLED, false);
  const id = process.env.chosun_oj_id ?? process.env.CHOSUN_OJ_ID;
  const password = process.env.chosun_oj_psw ?? process.env.CHOSUN_OJ_PSW;

  return {
    enabled,
    hasId: Boolean(id),
    hasPassword: Boolean(password),
  };
}

export function isChosunOjEnabled(): boolean {
  return getChosunOjConfigStatus().enabled;
}

function parseEnvValue(rawValue: string): string {
  let value = rawValue.trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }

  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "f", "no", "n", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return fallback;
}
