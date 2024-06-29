import { supabase } from "../../lib/initSupabase";

export default async function  getCover(req, res){ 
    // get karaoke's title
    // get video url
    // make array
    // show title on off
    let { data, error } = await supabase
    .from("sing_video")
    .select()
    .eq('show',1)
    .order("published_at", { ascending: false }); 
    if(error) console.log(error)
    return res.json(data);
}