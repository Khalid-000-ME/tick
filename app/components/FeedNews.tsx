"use client";

import { NewsPanel } from "@/components/NewsPanel";

/** Live headlines under the market list, so a post, a price and a story sit in one glance. */
export function FeedNews() {
  return (
    <div className="rail-news">
      <NewsPanel title="What's moving" topic="markets" limit={7} variant="panel" foldKey="tick.feed.news" />
    </div>
  );
}
