import Link from "next/link";

// Keep in sync with what the code does: server/src/metrics.ts (usage counts), geoip.ts (Aachen
// check), nginx.conf + nginx-logs.sh (logs, 7-day retention), and the rate limiters in
// server/src/index.ts.
export default function PrivacyPage() {
    return (
        <div className="container mt-4 mb-5" style={{ maxWidth: 800 }}>
            <div className="mb-4">
                <Link href="/" className="btn btn-outline-secondary">
                    &larr; Back to Live View
                </Link>
            </div>
            <h1 className="text-white">Privacy</h1>
            <p>
                RWTF is a non-commercial project. No cookies, no tracking, no third parties; no data
                is shared with anyone.
            </p>
            <p>
                <strong>Responsible:</strong> Dorian Koch,{" "}
                <a href="mailto:dorian.koch@rwth-aachen.de">dorian.koch@rwth-aachen.de</a>
            </p>
            <p className="mb-1">
                <strong>What we process</strong> (Art. 6(1)(f) GDPR, our interest in running the
                site):
            </p>
            <ul>
                <li>
                    Server logs: IP (shortened, e.g. 1.2.3.0, except in error logs), time, page,
                    referrer, browser; deleted after 7 days.
                </li>
                <li>Rate limiting: full IP, in memory only, for up to 6 hours.</li>
                <li>
                    Study materials: IP checked against RWTH networks and an offline location
                    database; not stored.
                </li>
                <li>
                    Usage stats: a salted hash of IP and browser counts each visitor once per day.
                    Salt and hashes are deleted at midnight; only totals remain (kept 2 years,
                    public on <Link href="/stats">Usage stats</Link>).
                </li>
            </ul>
            <p>
                Your browser only stores your chosen prediction method (local storage, never sent to
                us).
            </p>
            <p>
                <strong>Your rights:</strong> access, rectification, erasure, restriction,
                portability, objection (Art. 15–21 GDPR), and complaint to a supervisory authority,
                e.g. <a href="https://www.ldi.nrw.de/">LDI NRW</a>.
            </p>
            <p className="small text-muted">
                <a href="https://db-ip.com">IP Geolocation by DB-IP</a> (
                <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)
            </p>
        </div>
    );
}
