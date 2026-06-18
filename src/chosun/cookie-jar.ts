interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt?: number;
  secure: boolean;
}

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  addFromHeaders(url: string, headers: Headers): void {
    for (const header of getSetCookieHeaders(headers)) {
      const cookie = parseSetCookie(url, header);
      if (!cookie) {
        continue;
      }

      const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now()) {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, cookie);
      }
    }
  }

  getHeader(url: string): string | undefined {
    const target = new URL(url);
    const now = Date.now();
    const values: string[] = [];

    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && target.protocol !== "https:") {
        continue;
      }
      if (!domainMatches(target.hostname, cookie.domain)) {
        continue;
      }
      if (!target.pathname.startsWith(cookie.path)) {
        continue;
      }

      values.push(`${cookie.name}=${cookie.value}`);
    }

    return values.length > 0 ? values.join("; ") : undefined;
  }

  count(): number {
    return this.cookies.size;
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetter.getSetCookie?.();
  if (values && values.length > 0) {
    return values;
  }

  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookie(combined) : [];
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((part) => part.trim());
}

function parseSetCookie(url: string, header: string): StoredCookie | undefined {
  const target = new URL(url);
  const parts = header.split(";").map((part) => part.trim());
  const [nameValue, ...attributes] = parts;
  const separator = nameValue.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }

  const name = nameValue.slice(0, separator);
  const value = nameValue.slice(separator + 1);
  const cookie: StoredCookie = {
    name,
    value,
    domain: target.hostname,
    path: defaultPath(target.pathname),
    secure: false,
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValue] = attribute.split("=");
    const attrName = rawName.trim().toLowerCase();
    const attrValue = rawValue.join("=").trim();

    if (attrName === "domain" && attrValue) {
      cookie.domain = attrValue.replace(/^\./, "").toLowerCase();
    } else if (attrName === "path" && attrValue) {
      cookie.path = attrValue;
    } else if (attrName === "secure") {
      cookie.secure = true;
    } else if (attrName === "max-age") {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        cookie.expiresAt = Date.now() + seconds * 1000;
      }
    } else if (attrName === "expires") {
      const expiresAt = Date.parse(attrValue);
      if (Number.isFinite(expiresAt)) {
        cookie.expiresAt = expiresAt;
      }
    }
  }

  return cookie;
}

function defaultPath(pathname: string): string {
  if (!pathname || !pathname.startsWith("/")) {
    return "/";
  }

  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash + 1);
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}
