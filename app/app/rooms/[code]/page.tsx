import { notFound } from "next/navigation";
import { RoomArena } from "@/components/room/RoomArena";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const id = Number(code);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <RoomArena id={id} />;
}
