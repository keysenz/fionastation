import Head from "next/head";
import Image from "next/image";
import Background from "./background";
import { useEffect, useRef, useState } from "react";
import "react-responsive-carousel/lib/styles/carousel.min.css"; 
import CarouselComponent from "./useCarousel";
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
    
    const carousel = [
        {
            image: '/banner1.jpeg',
            alt: 'Single',
            title: 'Single',
            url: 'https://docs.google.com/forms/d/e/1FAIpQLSd0H2LYO9YCQiBv3Z2f744aoKn_B4y1f6qHtB9SsU_XhEImlg/viewform'
        },
        {
            image: '/banner2.jpeg',
            alt: 'Bundle',
            title: 'Bundle',
            url: 'https://docs.google.com/forms/d/e/1FAIpQLSd0H2LYO9YCQiBv3Z2f744aoKn_B4y1f6qHtB9SsU_XhEImlg/viewform'
        },
        {
            image: '/banner3.jpeg',
            alt: 'Gacha PIP',
            title: 'Gacha PIP',
            url: 'https://docs.google.com/forms/d/e/1FAIpQLSd0H2LYO9YCQiBv3Z2f744aoKn_B4y1f6qHtB9SsU_XhEImlg/viewform'
        },
    ]
    return (
        <>
            <Head>
                <title>Fiona&#39; Station </title>
            </Head>
            <div className="relative flex min-h-screen flex-col overflow-x-hidden">
            {now < localDeadline &&
                <CarouselComponent items={carousel}/>
            }

            <Background/>
            {children}
            </div>
        </>
    )
}