import Link from "next/link";

// Keep in sync with what the code does: server/src/metrics.ts (usage counts), geoip.ts (Aachen
// check), nginx.conf (access log), docker-compose.yml (log rotation), and the rate limiters in
// server/src/index.ts.
export default function PrivacyPage() {
    return (
        <div className="container mt-4 mb-5" style={{ maxWidth: 800 }}>
            <div className="mb-4">
                <Link href="/" className="btn btn-outline-secondary">
                    &larr; Back to Live View
                </Link>
            </div>
            <h1 className="text-white">Privacy Notice</h1>
            <p className="text-muted">Last updated: October 2026</p>

            <p>
                RWTF is a non-commercial hobby project. It uses no cookies, no tracking, and no
                third-party services: everything is served from our own server, and no data is
                shared with or sold to anyone.
            </p>

            <h4 className="mt-4">Who is responsible</h4>
            <p>
                Dorian Koch,{" "}
                <a href="mailto:dorian.koch@rwth-aachen.de">dorian.koch@rwth-aachen.de</a>. Write to
                this address for any of the rights listed below.
            </p>

            <h4 className="mt-4">Visiting the website</h4>
            <p>
                To deliver the site, your browser necessarily sends us your IP address, the page
                requested, the referring page, and your browser&apos;s user agent. We use them as
                follows (legal basis: Art. 6(1)(f) GDPR, our legitimate interest in running a
                working and abuse-resistant site):
            </p>
            <ul>
                <li>
                    <strong>Access log:</strong> stores the IP address shortened to its network part
                    (IPv4: last of the four blocks removed; IPv6: everything after the first three
                    blocks removed), the time, the page without query parameters, the referrer, and
                    the user agent. Logs are rotated automatically and kept only briefly (a few
                    megabytes per service, typically days).
                </li>
                <li>
                    <strong>Rate limiting:</strong> your full IP address is held in memory only, to
                    limit how many requests one client can make. It is forgotten after the
                    respective limit window (at most 6 hours, for document downloads).
                </li>
                <li>
                    <strong>Study materials:</strong> these are only available from Aachen. To
                    check, your IP address is compared against the RWTH networks and an offline
                    geolocation database on our server; it is not sent anywhere and not stored.
                    Search terms are not logged. Documents are fetched by our server, so the
                    original source never sees your IP address.
                </li>
            </ul>

            <h4 className="mt-4">Usage statistics</h4>
            <p>
                We count how many people use the site, and publish the counts on the{" "}
                <Link href="/stats">usage stats</Link> page. When your browser loads the gym chart,
                the server computes a hash of your IP address and user agent combined with a random
                value (salt) that changes every day. This lets us count you once per day instead of
                once per request. The day&apos;s salt and hashes are stored only until midnight and
                then deleted; your IP address and user agent are not stored at all. What remains are
                plain numbers (visitors per day, and people with the site open per 5 minutes), kept
                for two years. They cannot be traced back to you. Requests from bots are not
                counted.
            </p>
            <p>
                Legal basis: Art. 6(1)(f) GDPR, our legitimate interest in knowing how much the site
                is used. Nothing is stored on or read from your device for this, so no consent is
                needed (§ 25 TDDDG). You can object at any time (Art. 21 GDPR) via the address
                above; since we cannot recognize you after the day ends, an objection applies to
                future counting.
            </p>

            <h4 className="mt-4">Stored in your browser</h4>
            <p>
                If you pick a prediction method for the gym chart, your choice is saved in your
                browser&apos;s local storage so it stays selected next time. It is never sent to us.
                This is strictly necessary for a function you asked for (§ 25(2) No. 2 TDDDG); you
                can remove it by clearing your browser&apos;s site data.
            </p>

            <h4 className="mt-4">RWTF WiFi Scanner app</h4>
            <p>
                If you use the Android app, it uploads WiFi access point scans together with the GPS
                position where each scan was made, and a device ID (random unless you enter one
                yourself). We use this to map where campus access points are (legal basis: Art.
                6(1)(f) GDPR). Uploads are kept until you ask us to delete them; mention your device
                ID so we can find them.
            </p>

            <h4 className="mt-4">Your rights</h4>
            <p>
                You have the right to access, rectification, erasure, restriction of processing,
                data portability, and to object (Art. 15–21 GDPR). You can also lodge a complaint
                with a supervisory authority, e.g. the{" "}
                <a href="https://www.ldi.nrw.de/">
                    Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen
                </a>
                .
            </p>

            <h4 className="mt-4">Credits</h4>
            <p>
                <a href="https://db-ip.com">IP Geolocation by DB-IP</a>, licensed under{" "}
                <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </p>
        </div>
    );
}
