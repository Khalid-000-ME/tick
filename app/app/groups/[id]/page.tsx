import { notFound } from "next/navigation";
import { GroupView } from "@/components/GroupView";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <GroupView id={n} />;
}
