import { BackendProvider } from "@/components/BackendProvider";
import "@/styles/globals.css";
import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
    return (
        <BackendProvider>
            <Component {...pageProps} />
        </BackendProvider>
    );
}
