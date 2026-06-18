import type { ChosunConfig } from "../config.js";
import { CookieJar } from "./cookie-jar.js";
import { decodeHtmlEntities, htmlToText } from "./html.js";

const OJ_ORIGIN = "https://oj.chosun.ac.kr";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface OjResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export interface OjLink {
  title: string;
  href: string;
}

export interface OjTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface OjPageSummary {
  url: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  links: OjLink[];
  tables: OjTable[];
  fields: Record<string, string>;
}

export interface OjSourceSummary extends OjPageSummary {
  sourceCode: string;
}

interface TextResponse {
  url: string;
  response: Response;
  text: string;
}

export class ChosunOjClient {
  private readonly jar = new CookieJar();
  private loginPromise?: Promise<void>;
  private authenticated = false;
  private lastLoginAt?: Date;

  constructor(private readonly config: ChosunConfig) {}

  getSessionInfo(): { authenticated: boolean; cookieCount: number; lastLoginAt?: string } {
    return {
      authenticated: this.authenticated,
      cookieCount: this.jar.count(),
      lastLoginAt: this.lastLoginAt?.toISOString(),
    };
  }

  async ensureLoggedIn(): Promise<void> {
    if (this.authenticated) {
      return;
    }

    this.loginPromise ??= this.login();
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = undefined;
    }
  }

  async judgeHome(): Promise<OjPageSummary> {
    return summarizePage(await this.ojGet("/index.php/judge"));
  }

  async studentMain(classId: string): Promise<OjPageSummary> {
    return summarizePage(await this.ojGet(`/index.php/judge/studentmain/${encodePathSegment(classId)}`));
  }

  async contestProblemList(classId: string, contestId: string): Promise<OjPageSummary> {
    return summarizePage(await this.ojGet(`/index.php/judge/contestproblemlist/${encodePathSegment(classId)}/${encodePathSegment(contestId)}`));
  }

  async status(classId: string, contestId: string, problemId: string, uid?: string): Promise<OjPageSummary> {
    const path = `/index.php/judge/status/${encodePathSegment(classId)}/${encodePathSegment(contestId)}/${encodePathSegment(problemId)}`;
    const query = uid ? `?uid=${encodeURIComponent(uid)}` : "";
    return summarizePage(await this.ojGet(`${path}${query}`));
  }

  async source(classId: string, problemId: string, submitId: string): Promise<OjSourceSummary> {
    const response = await this.ojGet(
      `/index.php/judge/showsource/${encodePathSegment(classId)}/${encodePathSegment(problemId)}/${encodePathSegment(submitId)}`,
    );
    return {
      ...summarizePage(response),
      sourceCode: truncateText(extractSourceCode(response.text), 50000),
    };
  }

  async problemInfo(classId: string, contestId: string, problemId: string): Promise<OjPageSummary> {
    return summarizePage(
      await this.ojGet(`/index.php/judge/contestprobleminfo/${encodePathSegment(classId)}/${encodePathSegment(contestId)}/${encodePathSegment(problemId)}`),
    );
  }

  private async login(): Promise<void> {
    this.authenticated = false;

    await this.requestText(`${OJ_ORIGIN}/index.php/auth/login/`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${OJ_ORIGIN}/index.php/judge`,
      },
      followRedirects: true,
    });

    const login = await this.requestText(`${OJ_ORIGIN}/index.php/auth/authentication?returnURL=`, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: OJ_ORIGIN,
        referer: `${OJ_ORIGIN}/index.php/auth/login/`,
      },
      body: new URLSearchParams({
        id: this.config.id,
        password: this.config.password,
        "g-recaptcha": "",
      }),
      followRedirects: true,
    });

    if (login.url.includes("/index.php/auth/login") || /name=["']password["']|g-recaptcha|auth\/authentication/i.test(login.text)) {
      throw new Error("OJ login did not complete. Check separate OJ credentials or captcha requirements.");
    }

    this.authenticated = true;
    this.lastLoginAt = new Date();
  }

  private async ojGet(path: string): Promise<OjResponse> {
    await this.ensureLoggedIn();

    const response = await this.requestText(`${OJ_ORIGIN}${path}`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${OJ_ORIGIN}/index.php/judge`,
      },
      followRedirects: true,
    });

    if (response.url.includes("/index.php/auth/login")) {
      this.authenticated = false;
      throw new Error("OJ request reached the login page. Session may be expired.");
    }

    return {
      url: response.url,
      status: response.response.status,
      contentType: response.response.headers.get("content-type") ?? "",
      text: response.text,
    };
  }

  private async requestText(url: string, init: RequestInit & { followRedirects: boolean }): Promise<TextResponse> {
    let currentUrl = url;
    let currentInit: RequestInit = { ...init };

    for (let redirectCount = 0; redirectCount <= 12; redirectCount += 1) {
      const response = await this.requestOnce(currentUrl, currentInit);

      if (
        init.followRedirects &&
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get("location")
      ) {
        const nextUrl = new URL(response.headers.get("location") ?? "", currentUrl).href;
        const method = (currentInit.method ?? "GET").toUpperCase();
        const shouldSwitchToGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST");
        currentInit = {
          ...currentInit,
          method: shouldSwitchToGet ? "GET" : currentInit.method,
          body: shouldSwitchToGet ? undefined : currentInit.body,
          headers: {
            ...headersToObject(currentInit.headers),
            referer: currentUrl,
          },
        };
        currentUrl = nextUrl;
        continue;
      }

      return {
        url: currentUrl,
        response,
        text: await decodeResponse(response),
      };
    }

    throw new Error(`Too many redirects while requesting ${url}.`);
  }

  private async requestOnce(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      ...headersToObject(init.headers),
    };

    const cookie = this.jar.getHeader(url);
    if (cookie) {
      headers.cookie = cookie;
    }

    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
    });

    this.jar.addFromHeaders(url, response.headers);
    return response;
  }
}

function summarizePage(response: OjResponse): OjPageSummary {
  return {
    url: response.url,
    status: response.status,
    contentType: response.contentType,
    title: pageTitle(response.text),
    text: truncateText(htmlToText(response.text), 20000),
    links: parseLinks(response.text).slice(0, 100),
    tables: parseTables(response.text).slice(0, 20),
    fields: parseFields(response.text),
  };
}

function pageTitle(html: string): string {
  return normalizeWhitespace(htmlToText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")) ||
    normalizeWhitespace(htmlToText(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)?.[1] ?? ""));
}

function parseLinks(html: string): OjLink[] {
  const links: OjLink[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[2] ?? "");
    if (!href || /^javascript:/i.test(href)) {
      continue;
    }
    const title = normalizeWhitespace(htmlToText(match[3] ?? "")) || getAttribute(match[0], "title") || href;
    const absoluteHref = new URL(href, OJ_ORIGIN).href;
    const key = `${title}\n${absoluteHref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({ title, href: absoluteHref });
  }
  return links;
}

function parseTables(html: string): OjTable[] {
  const tables: OjTable[] = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableMatch[0];
    const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((rowMatch) =>
        [...(rowMatch[1] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cellMatch) => normalizeWhitespace(htmlToText(cellMatch[1] ?? ""))),
      )
      .filter((row) => row.some(Boolean));
    if (rows.length === 0) {
      continue;
    }

    const firstRowIsHeader = /<th\b/i.test(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(tableHtml)?.[0] ?? "");
    tables.push({
      caption: normalizeWhitespace(htmlToText(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml)?.[1] ?? "")),
      headers: firstRowIsHeader ? rows[0] ?? [] : [],
      rows: firstRowIsHeader ? rows.slice(1) : rows,
    });
  }
  return tables;
}

function parseFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(rowMatch[1] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cellMatch) =>
      normalizeWhitespace(htmlToText(cellMatch[1] ?? "")),
    );
    if (cells.length === 2 && cells[0] && cells[1] && cells[0].length <= 80) {
      fields[cells[0]] = cells[1];
    }
  }
  return fields;
}

function extractSourceCode(html: string): string {
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(html)?.[1];
  if (pre !== undefined) {
    return decodeSourceHtml(pre);
  }
  const textarea = /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i.exec(html)?.[1];
  if (textarea !== undefined) {
    return decodeSourceHtml(textarea);
  }
  const code = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(html)?.[1];
  if (code !== undefined) {
    return decodeSourceHtml(code);
  }
  return "";
}

function decodeSourceHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\r\n/g, "\n").trim();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} characters]`;
}

function getAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  const value = match?.[2] ?? match?.[3] ?? match?.[4];
  return value === undefined ? undefined : decodeHtmlEntities(value);
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

async function decodeResponse(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "";
  const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.toLowerCase();

  if (charset) {
    return decodeBuffer(buffer, charset);
  }

  const utf8 = decodeBuffer(buffer, "utf-8");
  if (utf8.includes("\uFFFD") || /charset=["']?euc-kr/i.test(utf8)) {
    return decodeBuffer(buffer, "euc-kr");
  }

  return utf8;
}

function decodeBuffer(buffer: ArrayBuffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}
