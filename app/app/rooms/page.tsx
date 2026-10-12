import { redirect } from "next/navigation";

/** Rooms and groups are one place now. */
export default function RoomsPage() {
  redirect("/groups");
}
