import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "The legacy reporter-market API has been retired." }, { status: 410 });
}

export function POST() {
  return NextResponse.json({ error: "Markets are now derived from Pyth terms and require no creation API." }, { status: 410 });
}
