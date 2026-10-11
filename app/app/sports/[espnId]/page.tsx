import { SportsMarketView } from "@/components/SportsMarketView";

export const metadata = { title: "Match | Tick" };

export default async function SportsMarketPage({ params }: { params: Promise<{ espnId: string }> }) {
  const { espnId } = await params;
  return <SportsMarketView espnId={espnId} />;
}
