import Image from "next/image";
import Link from "next/link";
import useFio from "./useFio";

export default function Menu({ href, src, children }) {
    const {play} = useFio()
    return (
        <Link href={href} onClick={play}>
            <div className="relative lg:my-[49px] lg:mx-[-2px] group">
                <div className='group-hover:scale-125 absolute p-4 h-16 w-16 -left-4 -top-4 rounded-full z-30'>
                    <Image src={"/"+src} fill alt="" className="rounded-full"
                        sizes="(max-width: 768px) 100vw,
                        (max-width: 1200px) 50vw,
                        33vw"
                    />
                </div>
                <div className="h-[90.07px] w-[156px]" />
                <div className='absolute top-1/2 left-1/2 z-0 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out'>
                    <div className='h-[90.07px] w-[156px]  transition-all duration-300 ease-out group-hover:border-x-[11px] group-hover:border-transparent' />
                    <div className='absolute top-0 -z-10 h-[90.07px] w-[156px] bg-white/50 group-hover:scale-110' />
                </div>
                <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                    {children}
                </div>
            </div>

        </Link>
    )
}