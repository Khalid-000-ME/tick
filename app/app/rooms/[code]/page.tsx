import { RoomView } from "@/components/RoomView";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomView code={code.toUpperCase()} />;
}
