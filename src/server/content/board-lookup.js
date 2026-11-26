/** 校验和查找资源所属的板块与层级。 */
import { HttpError } from "../http/responses.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { validId } from "../shared/values.js";

export async function portfolioSectionRecord(env, requestedId) {
  if (!validId(requestedId)) throw new HttpError(400, "请选择有效的大板块");
  const section = await env.DB.prepare(
    "SELECT id, kind, category, visibility FROM portfolio_sections WHERE id = ?",
  ).bind(String(requestedId)).first();
  if (!section) throw new HttpError(400, "请选择有效的大板块");
  return section.id === RESOURCE_SECTION_ID || section.category === "resources" ? { ...section, kind: "resources" } : section;
}

export async function subsectionIdForSection(env, requestedId, sectionId) {
  if (!validId(requestedId)) return null;
  const subsection = await env.DB.prepare(
    "SELECT id FROM portfolio_subsections WHERE id = ? AND section_id = ?",
  ).bind(String(requestedId), sectionId).first();
  if (!subsection) throw new HttpError(400, "请选择当前大板块下的有效小板块");
  return subsection.id;
}

export async function contentSectionId(env, requestedId, legacyType = "article") {
  const fallback = legacyType === "guide" ? "section-guides" : "section-essays";
  const sectionId = validId(requestedId) ? String(requestedId) : fallback;
  const section = await env.DB.prepare(
    "SELECT id FROM portfolio_sections WHERE id = ? AND kind = 'content' AND COALESCE(category,'') <> 'resources' AND id <> ?",
  ).bind(sectionId, RESOURCE_SECTION_ID).first();
  if (!section) throw new HttpError(400, "请选择有效的文章类板块");
  return sectionId;
}

export async function gallerySectionId(env, requestedId, allowEmpty = false) {
  if (allowEmpty && !requestedId) return null;
  const sectionId = validId(requestedId) ? String(requestedId) : "section-photos";
  const section = await env.DB.prepare(
    "SELECT id FROM portfolio_sections WHERE id = ? AND kind = 'gallery'",
  ).bind(sectionId).first();
  if (!section) throw new HttpError(400, "请选择有效的图片类板块");
  return sectionId;
}
