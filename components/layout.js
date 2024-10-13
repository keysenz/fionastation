import Head from "next/head";
import Image from "next/image";
import Background from "./background";
import { useEffect, useRef, useState } from "react";
import "react-responsive-carousel/lib/styles/carousel.min.css"; 
import Carousel from "./useCarousel";
// import { Carousel } from "antd";

export default function Layout({ children }) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Create a Date object for the deadline in UTC
    const utcDeadline = new Date(Date.UTC(2024, 9, 20, 16, 59, 59)); // October 20, 2024, 23:59 GMT+7
    // Convert the UTC deadline to the user's local time zone
    const userTimeZoneOffset = new Date().toLocaleString("en-US", { timeZone: userTimeZone });
    const localDeadline = new Date(utcDeadline.toLocaleString("en-US", { timeZone: userTimeZone }));
    
    // Get the current time in the user's time zone
    const now = new Date(userTimeZoneOffset);
    const promotion = useRef();
    const bannerRef = useRef();
    
    const carousel = [
        {
            image: '/banner.webp',
            alt: 'banner',
            title: 'banner',
            url: 'https://www.tokopedia.com/paopoa'
        },
        {
            image: '/01.webp',
            alt: 'Paket A',
            title: 'Paket A',
            url: 'https://www.tokopedia.com/paopoa/paket-a-keychain-pin-bundle-fioyo-winter-merchandise?extParam=ivf%3Dfalse?extParam=whid%3D16760202'
        },
        {
            image: '/02.webp',
            alt: 'Paket B',
            title: 'Paket B',
            url: 'https://www.tokopedia.com/paopoa/paket-b-tumbler-pin-bundle-fioyo-winter-merchandise?extParam=whid%3D16760202'
        },
        {
            image: '/03.webp',
            alt: 'Paket C',
            title: 'Paket C',
            url: 'https://www.tokopedia.com/paopoa/paket-c-deskmat-pin-bundle-fioyo-winter-merchandise?extParam=whid%3D16760202'
        },
        {
            image: '/04.webp',
            alt: 'Paket Royal',
            title: 'Paket Royal',
            url: 'https://www.tokopedia.com/paopoa/paket-royal-edition-fioyo-winter-merchandise?extParam=whid%3D16760202'
        },
    ]
    return (
        <>
            <Head>
                <title>Fiona&#39; Station </title>
            </Head>
            <div className="relative flex min-h-screen flex-col overflow-x-hidden">
            <Carousel items={carousel}/>

            <Background/>
            {children}
            </div>
        </>
    )
}