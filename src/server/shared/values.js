/** 业务共用的日期、文字、ID 和 D1 查询结果处理。 */

export function nowIso() {
  return new Date().toISOString();
}

/*
 * 游客统计按站点日历日汇总。默认使用北京时间，部署时可通过
 * ANALYTICS_TIMEZONE 改成其他 IANA 时区（例如 America/New_York）。
 */
export function analyticsDay(env, date = new Date()) {
  const timeZone = clampText(env?.ANALYTICS_TIMEZONE || "Asia/Shanghai", 80);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function clampText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function clampMultilineText(value, maxLength) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").slice(0, maxLength);
}

export function validId(value) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(String(value ?? ""));
}

export function rows(result) {
  return result?.results || [];
}
