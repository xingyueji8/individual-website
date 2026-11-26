/** 密码格式、带盐哈希和密码验证。 */
import { HttpError } from "../http/responses.js";
import { decodeBase64Url, encodeBase64Url, timingSafeEqualText } from "../shared/crypto.js";

/*
 * Cloudflare Workers 免费方案的单次 CPU 时间很短。600,000 次 PBKDF2 在本地
 * workerd 中约需 97ms，会导致正式站注册请求在密码处理阶段被中断。
 * 这里使用 50,000 次，并继续配合每个密码独立随机盐、登录限流和 HTTPS。
 * 迭代次数会随哈希一同保存，日后调整不会影响已有账号的校验。
 */
const PASSWORD_HASH_ITERATIONS = 50_000;

export function validatePassword(value, fieldName = "密码") {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, `${fieldName}须为 8—128 个字符`);
  }
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    throw new HttpError(400, `${fieldName}至少需要包含一个字母和一个数字`);
  }
  return password;
}

/*
 * PBKDF2-HMAC-SHA256 使用随机盐和固定工作因子。D1 中只保存推导结果、盐和
 * 工作因子，不保存原始密码；Studio 也没有任何返回这些字段的接口。
 */
async function derivePasswordHash(password, saltBytes, iterations = PASSWORD_HASH_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256,
  );
  return encodeBase64Url(new Uint8Array(bits));
}

export async function createPasswordRecord(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return {
    hash: await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS),
    salt: encodeBase64Url(salt),
    iterations: PASSWORD_HASH_ITERATIONS,
  };
}

export async function verifyPassword(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const storedIterations = Number(user.password_iterations);
  // 拒绝被篡改或明显异常的参数，避免数据库脏数据触发超大计算任务。
  if (!Number.isInteger(storedIterations) || storedIterations < 10_000 || storedIterations > 1_000_000) return false;
  let actual = "";
  try {
    actual = await derivePasswordHash(
      String(password || ""),
      decodeBase64Url(user.password_salt),
      storedIterations,
    );
  } catch {
    return false;
  }
  return timingSafeEqualText(actual, user.password_hash);
}
