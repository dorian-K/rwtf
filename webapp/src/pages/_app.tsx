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
                <meta name="description" content="RWTH Gym Utilisation" />
                <meta property="og:title" content="RWTF" />
                <meta property="og:description" content="RWTH Gym Utilisation" />
                <meta property="og:type" content="website" />
                <meta property="og:image" content="https://rwtf.dorianko.ch/embed_picture.png" />
                <meta property="og:image:width" content="900" />
                <meta property="og:image:height" content="530" />
            </Head>
            <BackendProvider>
                <Component {...pageProps} />
            </BackendProvider>
        </>
    );
}
