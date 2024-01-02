import Head from "next/head";
import Image from "next/image";
import Background from "./background";
import { useEffect, useRef } from "react";

export default function Layout({ children }) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Create a Date object for the deadline in UTC
    const utcDeadline = new Date(Date.UTC(2024, 1, 7, 16, 59, 59)); // December 30, 2023, 13:00 UTC
    
    // Convert the UTC deadline to the user's local time zone
    const userTimeZoneOffset = new Date().toLocaleString("en-US", { timeZone: userTimeZone });
    const localDeadline = new Date(utcDeadline.toLocaleString("en-US", { timeZone: userTimeZone }));
    
    // Get the current time in the user's time zone
    const now = new Date(userTimeZoneOffset);
    const banner = now < localDeadline;

    const promotion = useRef();
    const bannerRef = useRef();
    

    const handleButtonClick = () => {
        const anchorClone = bannerRef.current.cloneNode(true);
        anchorClone.classList.add('animate-to-bottom-right');

        document.body.appendChild(anchorClone); // Add cloned anchor to body

        bannerRef.current.remove();
        promotion.current.remove();

    };
    useEffect(() => {
  
    const pathname = window.location.pathname;
    //   if (pathname !== '/') {
        // promotion.current.remove();
    //   }
    }, [bannerRef, promotion]);
    return (
        <>
            <Head>
                <title>Fiona&#39; Station </title>
            </Head>
            <div className="relative flex min-h-screen flex-col overflow-x-hidden">

            <Background/>
            
            <div className="fixed top-0 left-0 z-50 flex h-screen w-screen flex-col items-center justify-center bg-gray-900/50 px-2" ref={promotion}>
                {
                banner ? 
                <>
                <a href='https://www.tokopedia.com/paopoa' target="_blank" rel="noreferrer" ref={bannerRef}>
                    <Image src={"/banner.jpg"} 
                    width={500}
                    height={500}
                    alt="banner"
                    style={{objectFit: "contain"}}
                    className="aspect-ratio"
                    />
                </a>
                <div className="flex md:mt-8 gap-4">
                    <a href="https://www.tokopedia.com/paopoa" target="_blank" rel="noreferrer" className="blinking rounded bg-[#03AC0E] px-2 text-xl text-white">Go to Tokopedia</a>
                    <button className="rounded bg-gray-500 px-2 text-xl text-white hover:bg-amber-200/50" onClick={() =>handleButtonClick()}>Skip Fiona&apos;s Merch</button>
                    </div>
                </>
                :
                <>
                    <iframe src="https://www.youtube.com/embed/jmFyo0pYC08?playlist=jmFyo0pYC08&loop=1&cc_load_policy=1"
                    className="mb-4 aspect-video w-full rounded sm:w-3/4 md:w-2/3 lg:w-4/5"
                    title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; loop" allowFullScreen />
                    <div className="flex gap-4">
                    <a href="https://www.youtube.com/channel/UCb-cLXWVOGVJHfkIfHt8Dfg?sub_confirmation=1" target="_blank" rel="noreferrer" className="blinking rounded bg-[#ff0000] px-2 text-xl">Subscribe Fiona~~</a>
                    <button className="rounded bg-gray-500 px-2 text-xl hover:bg-amber-200" onClick={() => promotion.current.remove()}>Skip Fiona&apos;s Owi Song</button>
                    </div>
                </>
                }
                </div>
            {children}
            </div>
        </>
    )
}