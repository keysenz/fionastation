import React, { useState, useEffect } from 'react';
// import './Carousel.css';

const Carousel = ({ items }) => {
  const [isPopupClosed, setIsPopupClosed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const popupClosed = localStorage.getItem('carouselPopupClosed');
    if (popupClosed === 'true') {
      setIsPopupClosed(true);
    }
  }, []);

  const closePopup = () => {
    setIsPopupClosed(true);
    localStorage.setItem('carouselPopupClosed', 'true');
  };

  const nextSlide = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % items.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prevIndex) => (prevIndex - 1 + items.length) % items.length);
  };

  if (!isPopupClosed) {
    return (
      <div className="carousel-popup">
        <button className="close-button" onClick={closePopup}>
          &times;
        </button>
        <div className="carousel-content">
          <img src={items[currentIndex].image} alt={items[currentIndex].title} />
          <h3>{items[currentIndex].title}</h3>
          <p>{items[currentIndex].description}</p>
        </div>
        <div className="carousel-controls">
          <button onClick={prevSlide}>&lt;</button>
          <button onClick={nextSlide}>&gt;</button>
        </div>
      </div>
    );
  }

  return (
    <div className="carousel-minimized">
      <div className="carousel-content">
        <img src={items[currentIndex].image} alt={items[currentIndex].title} />
        <h3>{items[currentIndex].title}</h3>
      </div>
      <div className="carousel-controls">
        <button onClick={prevSlide}>&lt;</button>
        <button onClick={nextSlide}>&gt;</button>
      </div>
    </div>
  );
};

export default Carousel;
