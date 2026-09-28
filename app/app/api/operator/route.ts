import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "The outcome path has no operator." }, { status: 410 });
}
