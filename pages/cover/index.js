import { useEffect, useState } from "react";
import { BsChevronCompactLeft, BsChevronCompactRight } from "react-icons/bs";
import { RxDotFilled } from "react-icons/rx";
import { supabase } from "../../lib/initSupabase";
import Link from "next/link";
import useSWR from "swr"
import useFio from "../../components/useFio";

const fetcher = (...args) => fetch(...args).then(res => res.json())
export default function Cover() {
  const {play} = useFio()
  const [currentIndex, setCurrentIndex] = useState(0);
  const {data, isLoading} = useSWR("/api/get-cover", fetcher)

  const [videoUrl, setVideoUrl] = useState(``);

  useEffect(() => {
    if(data)
      setVideoUrl(`https://www.youtube.com/embed/${data[currentIndex].video_id}?controls=1`)
  }, [data])

  useEffect(() => {
    if(data)
      setVideoUrl(
        `https://www.youtube.com/embed/${data[currentIndex].video_id}?controls=1`
      );
  }, [currentIndex]);

  const prevSlide = () => {
    const isFirstSlide = currentIndex === 0;
    const newIndex = isFirstSlide ? data.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
  };

  const nextSlide = () => {
    const isLastSlide = currentIndex === data.length - 1;
    const newIndex = isLastSlide ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
  };

  const goToSlide = (slideIndex) => {
    setCurrentIndex(slideIndex);
  };
  return (
    <>
      <main className="container flex min-h-border-screen flex-col items-center justify-center">
        <div className="relative z-0 mb-6 mt-24">
          <h1 className="z-0 text-center text-4xl font-black uppercase md:text-7xl text-[#446e92]">
            Fiona&apos;s Cover <br />
            <span className="hidden">and Original Song</span>
          </h1>
        </div>
        <div className="flex w-full lg:w-8/12 basis-4/12 flex-col items-center justify-center lg:overflow-hidden">
          {" "}
          <div className="w-full m-auto py-16 px-2 relative group">
            <div className="w-full rounded-2xl">
              <iframe
                className="aspect-video"
                src={videoUrl}
                title="Fiona"
                width="100%"
                height="100%"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              ></iframe>
            </div>
            <div className="flex justify-center py-2 self-stretch place-self-stretch place-items-stretch">
              {/* Left Arrow */}
              <div className="flex items-center justify-center text-2xl rounded-full p-2 bg-black/50 text-white cursor-pointer">
                <BsChevronCompactLeft onClick={prevSlide} size={30} />
              </div>

              <div className="flex-grow flex flex-col justify-center">
                <div className="mx-4 skew-x-30 border bg-black/50 px-5 rounded-full self-center">
                  <p className="-skew-x-30 text-center text-white">
                    {data && data[currentIndex].title}
                  </p>
                </div>
                <div className="flex flex-row justify-center gap-0">
                  {data?.map((slide, slideIndex) => (
                    <div
                      key={slideIndex}
                      onClick={() => goToSlide(slideIndex)}
                      className={"text-2xl cursor-pointer"}
                    >
                      <RxDotFilled color={currentIndex === slideIndex ? "white" : "black"} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Right Arrow */}
              <div className="flex items-center justify-center text-2xl  rounded-full p-2 bg-black/50 text-white cursor-pointer">
                <BsChevronCompactRight onClick={nextSlide} size={30} />
              </div>
            </div>
          </div>
        </div>
       <div className="grow"/>
       
       <p className="text-shadow text-center text-sm text-black backdrop-blur-lg">
          Background credits :{" "}
          <a  rel="noopener noreferrer"
          target="_blank"
          href="https://twitter.com/MaroonR19"
          className="hover:text-[#446e92]">Maroon</a>{" "}
        </p>
      </main>
      <Link href="/" className="fixed top-4 left-4">
        <i className="fa-arrow-left fa-2x fa-solid text-shadow text-[#446e92]"></i>
      </Link>
    </>
  );
}
