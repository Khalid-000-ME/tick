import { notFound } from "next/navigation";
import { GroupsApp } from "@/components/groups/GroupsApp";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <GroupsApp selected={n} />;
}
