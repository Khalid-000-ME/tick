import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Uploaded profile photos, by content hash.
 *
 * Kept on disk in .data/avatars. LIMIT, stated plainly: a serverless host has no persistent
 * disk, so there photos would vanish between cold starts and a profile would fall back to its
 * generated avatar. For production, back these two functions with object storage (Vercel
 * Blob, S3); they are the whole interface.
 */
const DIR = path.join(process.cwd(), ".data", "avatars");
export const AVATAR_ID = /^[a-f0-9]{32}$/;

export async function putAvatar(id: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${id}.webp`), bytes);
}

export async function getAvatar(id: string): Promise<Buffer | null> {
  if (!AVATAR_ID.test(id)) return null;
  try {
    return await fs.readFile(path.join(DIR, `${id}.webp`));
  } catch {
    return null;
  }
}
