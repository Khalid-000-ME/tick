"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Upload a photo as a profile picture. The browser centre-crops to a square and shrinks it,
 * so a phone photo is a few dozen kilobytes on the wire; the server re-draws it again and
 * does not trust this (app/api/avatar).
 */
export function useAvatarUpload(onDone: (avatar: string) => void) {
  const { getAccessToken } = usePrivy();
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function upload(file: File) {
    setNote(null);
    if (!file.type.startsWith("image/")) return setNote("Choose an image file.");
    setUploading(true);
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(512, side);
      canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
      if (!blob) throw new Error("encode");
      const token = await getAccessToken();
      const res = await fetch("/api/avatar", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: blob });
      const body = (await res.json()) as { ok: boolean; avatar?: string; error?: string };
      if (!body.ok || !body.avatar) return setNote(body.error ?? "Upload failed.");
      onDone(body.avatar);
    } catch {
      setNote("Could not read that image. Try a JPG, PNG or WebP.");
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, note };
}
