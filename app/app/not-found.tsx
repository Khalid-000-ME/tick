import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function NotFound() {
  return (
    <>
      <header className="site-header wrap"><Brand /></header>
      <main id="main-content" className="closing-section wrap">
        <span className="eyebrow">404 / OUT OF PLAY</span>
        <h1 className="mt-7 text-5xl tracking-tight">This moment has passed.</h1>
        <p className="my-8 text-fg-dim">The page isn’t here. There’s another moment in the arena.</p>
        <Link href="/live" className="button-acid">Enter the arena <span aria-hidden="true">↗</span></Link>
      </main>
    </>
  );
}
