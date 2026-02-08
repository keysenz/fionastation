import { supabase } from "../../lib/initSupabase";

export default async function getCover(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        let { data, error } = await supabase
            .from("sing_video")
            .select()
            .order("published_at", { ascending: false });

        if (error) throw error;
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching cover:', error);
        return res.status(500).json({ error: error.message });
    }
}