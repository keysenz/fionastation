import Head from "next/head";
import Image from "next/image";
import Background from "./background";
import { useEffect, useRef, useState } from "react";
import "react-responsive-carousel/lib/styles/carousel.min.css"; 
import { Carousel } from "antd";

export default function Layout({ children }) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [bannerShow, setBannerShow] = useState(false);

    // Create a Date object for the deadline in UTC
    const utcDeadline = new Date(Date.UTC(2024, 0, 7, 16, 59, 59)); // December 30, 2023, 13:00 UTC
    // Convert the UTC deadline to the user's local time zone
    const userTimeZoneOffset = new Date().toLocaleString("en-US", { timeZone: userTimeZone });
    const localDeadline = new Date(utcDeadline.toLocaleString("en-US", { timeZone: userTimeZone }));
    
    // Get the current time in the user's time zone
    const now = new Date(userTimeZoneOffset);
    const banner = now < localDeadline;

    const promotion = useRef();
    const bannerRef = useRef();
    
    const carousel = [
    {
        image: '/banner.webp',
        alt: 'banner',
        url: 'https://www.tokopedia.com/paopoa'
    },
    {
        image: '/01.webp',
        alt: 'Paket A',
        url: 'https://www.tokopedia.com/paopoa/paket-a-keychain-pin-bundle-fioyo-winter-merchandise?extParam=ivf%3Dfalse?extParam=whid%3D16760202'
    },
    {
        image: '/02.webp',
        alt: 'Paket B',
        url: 'https://www.tokopedia.com/paopoa/paket-b-tumbler-pin-bundle-fioyo-winter-merchandise?extParam=whid%3D16760202'
    },
    {
        image: '/03.webp',
        alt: 'Paket C',
        url: 'https://www.tokopedia.com/paopoa/paket-c-deskmat-pin-bundle-fioyo-winter-merchandise?extParam=whid%3D16760202'
    },
    {
        image: '/04.webp',
        alt: 'Paket Royal',
        url: 'https://www.tokopedia.com/paopoa/paket-royal-edition-fioyo-winter-merchandise?extParam=whid%3D16760202'
    },

]
    

    const handleButtonClick = () => {
        // const anchorClone = bannerRef.current.cloneNode(true);
        setBannerShow(true);

        // document.body.appendChild(anchorClone); // Add cloned anchor to body
        promotion.current.remove();

    };
    const contentStyle = {
        margin: 0,
        height: '160px',
        color: '#fff',
        lineHeight: '160px',
        textAlign: 'center',
        background: '#364d79',
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
                <div className="h-96 w-96">
                    <Carousel autoplay autoplaySpeed={2000}>
                        {carousel.map((v,i)=>      
                        <div className="flex justify-center items-center h-full" key={i}>
                            <div >
                            <a href={v.url} target="_blank" rel="noreferrer" className="">
                                <Image src={v.image} loading="lazy"
                                width="0"
                                height="0"
                                sizes="100vw"
                                className="w-full h-auto"/>
                            </a>
                            </div>
                        </div>        
                        )}
                    </Carousel>
                </div>
                <div className="flex md:mt-4 gap-4">
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
                {bannerShow && <div className="h-96 w-96 animate-to-bottom-right" ref={bannerRef}>
                    <Carousel autoplay autoplaySpeed={2000} >
                            {carousel.map((v,i)=>      
                            <div className="flex justify-center items-center h-full" key={i}>
                                <div >
                                <a href={v.url} target="_blank" rel="noreferrer" className="">
                                    <Image src={v.image} loading="lazy"
                                    width="0"
                                    height="0"
                                    sizes="100vw"
                                    className="w-full h-auto"/>
                                </a>
                                </div>
                            </div>        
                            )}
                    </Carousel>
                </div>}
            {children}
            </div>
        </>
    )
}