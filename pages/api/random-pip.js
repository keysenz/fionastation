import { supabase } from "../../lib/initSupabase";

const pipUrl = [
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364413454237727/piplici.png",
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364413835902986/pip_bot.png",
    "https://cdn.discordapp.com/attachments/1145605846538125423/1153364414200815656/pipidol.png"
]

export default async function getRandomPip(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const randomUrl = pipUrl[Math.floor(Math.random() * pipUrl.length)];
        return res.status(200).json({ url: randomUrl });
    } catch (error) {
        console.error('Error getting random pip:', error);
        return res.status(500).json({ error: error.message });
    }
}