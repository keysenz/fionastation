import Head from "next/head";
import Image from "next/image";
import Background from "./background";

export default function Layout({ children }) {
    return (
        <>
            <Head>
                <title>Fiona&#39; Station </title>
            </Head>
            <div className="relative flex min-h-screen flex-col overflow-x-hidden">

            <Background/>
            {children}
            </div>
        </>
    )
}