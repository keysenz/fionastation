import { supabase } from "../../lib/initSupabase";

export default async function getKaraoke(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        let { data, error } = await supabase.from('karaoke_video')
            .select(`
        id, video_title, video_url, membership,
        karaoke_song( id, song_title, timestamp, created_at )
        `)
            .order('published_at', { ascending: false })
            .order('timestamp', { ascending: true, foreignTable: 'karaoke_song' });

        if (error) throw error;

        // Ensure data is an array before mapping
        const processedData = (data || []).map((v) => {
            let karaoke = (v.karaoke_song || []).map((kar) => {
                // If the DB already has these flags, they will be in 'kar'.
                // If not, we don't want to force them to false here as it might hide data.
                return { ...kar }; 
            });
            return { 
                ...v, 
                karaoke_song: karaoke,
                // Add defaults if missing but don't force 'false' globally 
                // unless we explicitly want to hide unverified content
            };
        });

        return res.status(200).json(processedData);

    } catch (error) {
        console.error('Error fetching karaoke:', error);
        return res.status(500).json({ error: error.message });
    }
}