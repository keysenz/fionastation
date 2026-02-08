import { supabase } from "../../lib/initSupabase";

export default async function getKaraokeSingle(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { video_id } = req.query;

    if (!video_id) {
        return res.status(400).json({ message: 'Missing video_id' });
    }

    try {
        let { data, error } = await supabase.from('karaoke_video_duplicate')
            .select(`
        id, video_title, video_url, membership,
        karaoke_song_duplicate( id, song_title, timestamp, created_at )
        `)
            .eq('id', video_id).single();

        if (error) throw error;

        return res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching karaoke single:', error);
        return res.status(500).json({ error: error.message });
    }
}