import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { verifyAccessToken } from "@/lib/server/privyAuth";
import { putAvatar } from "@/lib/server/avatarStore";

/**
 * Profile photo upload. Only a signed-in user may upload, and nothing the browser sends is
 * trusted: the bytes are decoded and re-drawn as a 256px square WebP, which drops metadata
 * (location, camera) and anything that is not really an image. The file is named by the
 * hash of the result, so the same photo is stored once and a name cannot be guessed to
 * overwrite another.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_500_000;
const PER_HOUR = 20;
const hits = new Map<string, number[]>();

const refuse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return refuse("Uploads are not set up on this server.", 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const did = token ? await verifyAccessToken(token, appId) : null;
  if (!did) return refuse("Log in to upload a photo.", 401);

  const now = Date.now();
  const recent = (hits.get(did) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) return refuse("Too many uploads. Try again later.", 429);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return refuse("That image is too large. Use one under 1.5 MB.", 413);
  const input = Buffer.from(await request.arrayBuffer());
  if (input.length === 0 || input.length > MAX_BYTES) return refuse("That image is too large. Use one under 1.5 MB.", 413);

  let out: Buffer;
  try {
    out = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  } catch {
    return refuse("That file is not a usable image. Use a JPG, PNG or WebP.", 400);
  }
  const id = createHash("sha256").update(out).digest("hex").slice(0, 32);
  try {
    await putAvatar(id, out);
  } catch {
    return refuse("Could not store the photo right now.", 500);
  }
  hits.set(did, [...recent, now]);
  return NextResponse.json({ ok: true, avatar: `/api/avatar/${id}` });
}
