import { supabase } from "../../lib/initSupabase";

const pipUrl = [
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364413454237727/piplici.png",
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364413835902986/pip_bot.png",
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364414200815656/pipidol.png"
]

export default async function  getRandomPip(req, res){ 
    // get karaoke's title
    // get video url
    // make array
    // show title on off
    let {video_id} = req.query
    let { data, error } = await supabase.from('karaoke_video_duplicate')
    .select(`
        id, video_title, video_url, membership,
        karaoke_song_duplicate( id, song_title, timestamp, created_at )
        `)
    .eq('id',video_id).single()
    if(error) console.log(error)
    return res.json(data);
}