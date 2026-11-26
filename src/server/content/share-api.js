/** 分享链接的读写入口与共享鉴权适配。 */
import { sanitizeRichHtml } from "./rich-text.js";
import { ACCESS_TABLES } from "./visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { sha256 } from "../shared/crypto.js";

export function shareHooks() {
  return { error: (status, message) => new HttpError(status, message), hash: sha256,
    token: () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    readJson, accessTables: ACCESS_TABLES, sanitize: sanitizeRichHtml };
}
