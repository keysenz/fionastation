import Head from "next/head";
import Image from "next/image";
import Background from "./background";
import { useEffect, useRef, useState } from "react";
import "react-responsive-carousel/lib/styles/carousel.min.css"; 
import { Carousel } from "antd";

export default function Layout({ children }) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Create a Date object for the deadline in UTC
    const utcDeadline = new Date(Date.UTC(2024, 0, 7, 16, 59, 59)); // December 30, 2023, 13:00 UTC
    // Convert the UTC deadline to the user's local time zone
    const userTimeZoneOffset = new Date().toLocaleString("en-US", { timeZone: userTimeZone });
    const localDeadline = new Date(utcDeadline.toLocaleString("en-US", { timeZone: userTimeZone }));
    
    // Get the current time in the user's time zone
    const now = new Date(userTimeZoneOffset);
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