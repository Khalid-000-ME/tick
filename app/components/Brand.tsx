import Link from "next/link";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Tick home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>tick<span className="brand-period">.</span></Link>;
}
