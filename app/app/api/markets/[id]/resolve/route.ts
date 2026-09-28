import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json({ error: "Settlement is permissionless and no longer uses an operator route." }, { status: 410 });
}
