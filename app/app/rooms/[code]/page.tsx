import { notFound } from "next/navigation";
import { RoomView } from "@/components/RoomView";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const id = Number(code);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <RoomView id={id} />;
}
