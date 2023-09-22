const functions = require('@google-cloud/functions-framework');
const {createClient} = require('@supabase/supabase-js');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
functions.http('webhook', async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send({ message: 'Only POST requests allowed' })
        return
    }
    if(req.headers['secret'] !== 'fiokeysenz') {
      
        res.status(404).send({ message: 'Not Authorized' })
        return
    }
  const { record } = req.body;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  
  let { data, error } = await supabase.from('karaoke_video')
  .select(`
      id, video_title, video_url, membership,
      karaoke_song( id, song_title, timestamp, created_at )
      `)
  .eq('id',record.video_id)
    
    // Craft a message to send to Discord
    const message = {
      embeds: [
        {
          color: 14663017,
          title: `New update FionaStation`,
          description : `Update **${record.video_title}** to FionaStation`,
          url: `https://fionastation.com/karaoke?id=${record.video_url}`,
          image: {
            url: `${record.thumbnail}`
          },
          fields : []
        },
      ],
    };
    data.karaoke_song.forEach((v)=>{
      message[0].fields.push({
        name: v.song_title,
        value: v.timestamp
      })
    })
    try {
      // Send the message to Discord using the incoming webhook URL
      fetch( DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
      
    } catch (error) {
      console.log(error)
    }
});
