import { randomBytes } from "node:crypto";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hash } from "bcryptjs";

const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = resolve(outputArgument?.slice("--output=".length) || "KARIMOFF-admin-reset.env");

try {
  await stat(outputPath);
  throw new Error(`Refusing to overwrite existing credential file: ${outputPath}`);
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT") && !error.message.includes("no such file")) throw error;
}

const password = randomBytes(24).toString("base64url");
const passwordHash = await hash(password, 12);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `ADMIN_TEMP_PASSWORD=${password}\nADMIN_PASSWORD_HASH=${passwordHash}\n`,
  { encoding: "utf8", mode: 0o600 }
);
await chmod(outputPath, 0o600);
console.log(`Temporary admin credential saved securely: ${outputPath}`);
