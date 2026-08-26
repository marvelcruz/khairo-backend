import crypto from "crypto";

function encryptionKey() {
  const raw = String(
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ||
      process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      ""
  ).trim();

  if (!raw) {
    throw new Error("Secure connection storage is not configured.");
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptConnectionSecret(value) {
  if (!value) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptConnectionSecret(value) {
  if (!value) return "";

  const [version, ivHex, tagHex, dataHex] = String(value).split(":");
  if (version !== "v1" || !ivHex || !tagHex || !dataHex) {
    throw new Error("Stored connection credential is invalid.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
