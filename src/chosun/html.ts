export function extractInputValues(html: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = getAttribute(tag, "name");
    if (!name) {
      continue;
    }

    values.set(name, decodeHtmlEntities(getAttribute(tag, "value") ?? ""));
  }

  return values;
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|section|article|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "\u2022",
  copy: "\u00a9",
  gt: ">",
  hellip: "\u2026",
  ldquo: "\u201c",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  middot: "\u00b7",
  nbsp: " ",
  ndash: "\u2013",
  quot: "\"",
  rdquo: "\u201d",
  reg: "\u00ae",
  rsquo: "\u2019",
  trade: "\u2122",
};

function getAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity: string, hex: string) => decodeCodePointEntity(entity, Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (entity: string, decimal: string) => decodeCodePointEntity(entity, Number.parseInt(decimal, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (entity: string, name: string) => NAMED_HTML_ENTITIES[name.toLowerCase()] ?? entity);
}

function decodeCodePointEntity(entity: string, codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}
