import { BackendProvider } from "@/components/BackendProvider";
import "@/styles/globals.scss";
import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
    return (
        <>
            <Head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>RWTF</title>
            </Head>
            <BackendProvider>
                <Component {...pageProps} />
            </BackendProvider>
        </>
    );
}
