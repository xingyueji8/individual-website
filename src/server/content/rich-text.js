/** 文章内容的 HTML 清理、纯文本和 URL 校验。 */
import { sanitizeTextStyle } from "./presentation.js";
import { validId } from "../shared/values.js";

const MAX_RICH_TEXT_LENGTH = 120_000;

export function slugify(value) {
  const base = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `content-${Date.now()}`;
}

export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeUrl(value, allowImage = false) {
  const url = String(value ?? "").trim();
  if (url.startsWith("/media/")) return true;
  /* 图片仍只允许 HTTPS；普通文章链接可以保留 http://，但公开页面会在跳转前确认。 */
  if (/^https:\/\//i.test(url)) return true;
  if (!allowImage && /^http:\/\//i.test(url)) return true;
  if (!allowImage && /^(mailto:|tel:)/i.test(url)) return true;
  return false;
}

function sanitizeAttributes(tag, rawAttributes) {
  const allowed = {
    a: new Set(["href", "title", "target"]),
    img: new Set(["src", "alt", "title"]),
    /* 资源嵌入只保存类型和数据库 ID，不允许 Studio 写入任意样式或事件。 */
    div: new Set(["class", "data-resource-type", "data-resource-id"]),
  };
  const textTags = new Set(["p", "strong", "b", "em", "i", "u", "s", "blockquote", "li", "h2", "h3", "h4", "a", "div", "span"]);
  const attributes = new Set(allowed[tag] || []);
  if (textTags.has(tag)) attributes.add("style");
  if (!attributes.size) return "";

  const output = [];
  const attributePattern = /([a-zA-Z0-9:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attributePattern.exec(rawAttributes))) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) continue;
    let value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "style") {
      value = sanitizeTextStyle(value.replace(/&quot;/gi, '"').replace(/&#39;/gi, "'"));
      if (!value) continue;
    }
    value = value.replace(/[\u0000-\u001f"<>]/g, "");
    if ((name === "href" || name === "src") && !isSafeUrl(value, tag === "img")) continue;
    if (name === "target" && value !== "_blank") continue;
    if (tag === "div" && name === "class") {
      const classes = value.split(/\s+/);
      if (!classes.includes("resource-embed") || classes.some(item => !["resource-embed", "is-selected"].includes(item))) continue;
      value = "resource-embed";
    }
    if (tag === "div" && name === "data-resource-type" && !["asset", "folder"].includes(value)) continue;
    if (tag === "div" && name === "data-resource-id" && !validId(value)) continue;
    output.push(`${name}="${value}"`);
  }

  if (tag === "a" && output.some((item) => item === 'target="_blank"')) {
    output.push('rel="noopener noreferrer"');
  }
  return output.length ? ` ${output.join(" ")}` : "";
}

export function sanitizeRichHtml(value) {
  const allowedTags = new Set([
    "p", "br", "strong", "b", "em", "i", "u", "s", "blockquote",
    "ul", "ol", "li", "h2", "h3", "h4", "a", "img", "figure",
    "figcaption", "code", "pre", "hr", "div", "span",
  ]);
  let html = String(value ?? "").slice(0, MAX_RICH_TEXT_LENGTH);
  html = html
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");

  return html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (whole, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!allowedTags.has(tag)) return "";
    const closing = /^<\//.test(whole);
    if (closing) return `</${tag}>`;
    const safeAttrs = sanitizeAttributes(tag, attrs || "");
    return `<${tag}${safeAttrs}>`;
  });
}
