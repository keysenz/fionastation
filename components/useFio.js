import useSound from "use-sound";

const useFio = () => {
    const [play] = useSound('/piosayang.mp3', 20)
    return {
        play
    }
}

export default useFio