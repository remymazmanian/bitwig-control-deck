import Link from "next/link";

export function BrandHeader({ active }: { active: "deck" | "connect" | "settings" }) {
  return (
    <header className="topbar">
      <Link className="brand-lockup" href="/" aria-label="Bitwig Control Deck home">
        <span className="brand-mark" aria-hidden="true">C</span>
        <div>
          <div className="brand-name">CONTROL <span>DECK</span></div>
          <div className="brand-subtitle">LOCAL BRIDGE · BITWIG</div>
        </div>
      </Link>

      <div className="topbar-actions">
        <nav className="deck-nav" aria-label="Primary">
          <Link className={active === "deck" ? "active" : ""} href="/">Deck</Link>
          <Link className={active === "connect" ? "active" : ""} href="/connect">Connect</Link>
          <Link className={active === "settings" ? "active" : ""} href="/settings">Settings</Link>
        </nav>
        <div className="local-pill"><span className="local-dot" />LOCAL ONLY</div>
      </div>
    </header>
  );
}
