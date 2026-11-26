export const ARTICLE_LAYOUTS = ["article", "feed"];
export const GALLERY_LAYOUTS = ["grid", "masonry", "rows"];

export function presentationSettings(input, current = {}, inherit = false) {
  const result = {};
  for (const [field, column, choices, fallback] of [
    ["articleLayout", "article_layout", ARTICLE_LAYOUTS, "article"],
    ["galleryLayout", "gallery_layout", GALLERY_LAYOUTS, "grid"],
  ]) {
    const value = input[field] ?? current[column] ?? (inherit ? "inherit" : fallback);
    if (!choices.includes(value) && !(inherit && value === "inherit")) throw new Error("页面样式无效");
    result[column] = value;
  }
  return result;
}

// Rich text can change typography, never introduce executable CSS or position
// content over the website's controls. Word paste uses the same allowlist.
export function sanitizeTextStyle(source) {
  const output = new Map();
  for (const declaration of String(source || "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (/[&<>\\]|url\s*\(|expression|var\s*\(|!important/i.test(value)) continue;
    let safe = false;
    if (name === "color" || name === "background-color") {
      safe = /^(#[a-f0-9]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(value);
    } else if (name === "font-size") {
      const match = value.match(/^(\d+(?:\.\d+)?)(px|pt)$/i);
      safe = Boolean(match && Number(match[1]) >= 8 && Number(match[1]) <= 72);
    } else if (name === "font-family") {
      safe = value.length <= 150 && /^[\p{L}\d\s,'"-]+$/u.test(value);
    } else if (name === "font-weight") safe = /^(normal|bold|[1-9]00)$/.test(value);
    else if (name === "font-style") safe = /^(normal|italic|oblique)$/.test(value);
    else if (name === "text-decoration" || name === "text-decoration-line") safe = /^(none|underline|line-through|underline line-through)$/.test(value);
    else if (name === "text-align") safe = /^(left|center|right|justify)$/.test(value);
    if (safe) output.set(name, value.replace(/"/g, "'"));
  }
  return [...output].map(([name, value]) => `${name}:${value}`).join(";");
}
