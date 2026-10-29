import { DESIGN_INIT_SCRIPT } from "@/components/DesignProvider";
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, no user input */}
                <script dangerouslySetInnerHTML={{ __html: DESIGN_INIT_SCRIPT }} />
            </Head>
            <body data-bs-theme="dark">
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
