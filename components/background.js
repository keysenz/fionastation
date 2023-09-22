import Image from 'next/image'
import { ImageBackground } from '../public'
export default function Background() {
    return (
      <Image
        alt="Background"
        src={ImageBackground}
        placeholder="background"
        quality={100}
        fill
        sizes="100vw"
        className='object-left lg:object-center'
        style={{
          objectFit: 'cover',
          zIndex: -10,
        }}
      />
    )
}