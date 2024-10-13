import React, { useState, useEffect, useRef } from "react";
// import './Carousel.css';
import { Carousel } from "antd";
import Image from "next/image";

const CarouselComponent = ({ items }) => {
  const [isPopupClosed, setIsPopupClosed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const carouselRef = useRef(null);

  useEffect(() => {
    const popupClosed = localStorage.getItem("carouselPopupClosed");
    if (popupClosed === "true") {
      setIsPopupClosed(true);
    }

    const handleClickOutside = (event) => {
      if (
        carouselRef.current &&
        !carouselRef.current.contains(event.target) &&
        !isPopupClosed
      ) {
        closePopup();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isPopupClosed]);

  const closePopup = () => {
    setIsPopupClosed(true);
    localStorage.setItem("carouselPopupClosed", "true");
  };

  const nextSlide = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % items.length);
  };

  const prevSlide = () => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + items.length) % items.length
    );
  };

  if (!isPopupClosed) {
    return (
      <div className="fixed top-0 left-0 z-50 flex h-screen w-screen flex-col items-center justify-center bg-gray-900/50 px-2">
        <div className="h-1/2 w-1/2" ref={carouselRef}>
          <Carousel autoplay autoplaySpeed={2000}>
            {items.map((v, i) => (
              <div className="flex h-full" key={i}>
                <div>
                  <a href={v.url} target="_blank" rel="noreferrer" className="">
                    <Image
                      src={v.image}
                      loading="lazy"
                      width="0"
                      height="0"
                      sizes="100vw"
                      className="w-full h-auto"
                    />
                  </a>
                </div>
              </div>
            ))}
          </Carousel>
        </div>
      </div>
    );
  }

  return (
    <div className="sm:h-48 sm:w-48 md:h-56 md:w-96 animate-to-bottom-right self-end place-self-end justify-self-end">
      <Carousel autoplay autoplaySpeed={2000}>
        {items.map((v, i) => (
          <div className="flex justify-center items-center h-full" key={i}>
            <div>
              <a href={v.url} target="_blank" rel="noreferrer" className="">
                <Image
                  src={v.image}
                  loading="lazy"
                  width="0"
                  height="0"
                  sizes="100vw"
                  className="w-full h-auto"
                />
              </a>
            </div>
          </div>
        ))}
      </Carousel>
    </div>
  );
};

export default CarouselComponent;
