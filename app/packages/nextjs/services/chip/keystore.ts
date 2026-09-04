import { createDecipheriv, scryptSync } from "crypto";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { type Hex, keccak256 } from "viem";

/**
 * Decrypt a Web3 Secret Storage (v3) keystore, the format `cast wallet new` / `cast wallet import`
 * write to ~/.foundry/keystores. Lets the relay sign with a foundry keystore account so no raw
 * private key ever sits in a .env file. Node's built-in scrypt + aes-128-ctr; no extra deps.
 */
export function decryptKeystore(json: string, password: string): Hex {
  const ks = JSON.parse(json);
  const c = ks.crypto ?? ks.Crypto;
  if (!c) throw new Error("not a v3 keystore");
  if (c.kdf !== "scrypt") throw new Error(`unsupported kdf ${c.kdf}`);
  if (c.cipher !== "aes-128-ctr") throw new Error(`unsupported cipher ${c.cipher}`);
  const { n, r, p, dklen, salt } = c.kdfparams;
  const key = scryptSync(password, Buffer.from(salt, "hex"), dklen, { N: n, r, p, maxmem: 512 * 1024 * 1024 });
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(Buffer.concat([key.subarray(16, 32), ciphertext]));
  if (mac.slice(2) !== c.mac.toLowerCase()) throw new Error("wrong keystore password");
  const decipher = createDecipheriv("aes-128-ctr", key.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  const pk = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return `0x${pk.toString("hex")}`;
}

/** RELAYER_KEYSTORE=<name in ~/.foundry/keystores> + RELAYER_KEYSTORE_PASSWORD (or _FILE). */
export function relayerKeyFromKeystore(): Hex | undefined {
  const name = process.env.RELAYER_KEYSTORE;
  if (!name) return undefined;
  const path = name.includes("/") ? name : join(homedir(), ".foundry", "keystores", name);
  if (!existsSync(path)) throw new Error(`keystore not found: ${path}`);
  let password = process.env.RELAYER_KEYSTORE_PASSWORD;
  const pwFile = process.env.RELAYER_KEYSTORE_PASSWORD_FILE;
  if (!password && pwFile) password = readFileSync(pwFile, "utf8").trim();
  if (!password && existsSync(path + ".password.txt")) password = readFileSync(path + ".password.txt", "utf8").trim();
  if (!password) throw new Error("set RELAYER_KEYSTORE_PASSWORD or RELAYER_KEYSTORE_PASSWORD_FILE");
  return decryptKeystore(readFileSync(path, "utf8"), password);
}
