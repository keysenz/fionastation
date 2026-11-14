# Song mood prototype: results

Fio Radio wants a "set the mood" feature: a mood picker, autoplay that stays close in energy to the current song, and mood badges. This prototype asks whether mood can be detected reliably enough to build on. It tags 39 songs (33 distinct titles plus second takes) and 19 videos from the audio already cached. Nothing in the site reads the output.

## Verdict

**Lyrics-based tagging works well enough to build on, pending the labels. Audio energy as built here does not, so drop it as a cross-check.**

- **Text tags read right.** Haiku's tags and reasons for the songs I know are plausible. For example, Monokrom comes back as nostalgic gratitude to family, not romance, and Gala Bunga Matahari as grief. Both are judgment calls until the labeling sheet is filled in, and agreement goes below when it is.
- **Haiku agrees with stronger models as well as they agree with each other.** Opus 5.5, Fable 5.2 and Sonnet 5.5 tagged the 20 labeling-sheet songs blind. Haiku's first tag was among each model's tags for 90 to 100% of songs, while the stronger models managed 85 to 95% with each other. Every pair, the stronger models included, picked the same first tag for 70 to 80% of songs. Positivity agrees closely everywhere (ρ 0.89 to 0.95). Energy is the weak score: ρ is 0.60 to 0.64 between Haiku and the others, against 0.73 to 0.80 among the stronger models. That fits, because energy is about sound, which none of them hears. So a cheap model is enough, but this is agreement between models, not correctness. Human labels are still the real test.
- **Where models disagree, they disagree between neighbouring moods.** Counting every pair of models, the first-tag splits were galau vs sendu 9 times, romantis vs sendu 6, ceria vs romantis 5, galau vs romantis 5 and chill vs sendu 4. No model ever confused opposites such as hype and sendu. The two songs without lyrics, Janji and Gentari Hariku, got the widest spread.
- **Text is stable.** The two takes of Tampar got identical tags, with energy 0.35 both times and positivity 0.15 and 0.2. The two takes of Monokrom shared their first tag (sendu) and had energy 0.2 and 0.25.
- **Lyrics matter.** Given only the title and artist, Haiku called Tampar "high-energy, rap-driven party music". Given the lyrics, it called it a galau, sendu ballad. The two songs without lyrics got guessed reasons, and Haiku says so in them ("No lyrics available; tagged from the title"). Its claim that Rumah Kewinci is "a kids' music group" may be invented. A song without lyrics needs a human tag or a low-confidence mark.
- **Audio energy barely tracks text energy.** Spearman ρ is 0.19 across all 39 songs and 0.18 across the 32 stream songs. Of the five audio inputs, only spectral brightness follows text energy (ρ 0.43). Tempo is noise (ρ −0.02): the two takes of Tampar read 80.7 and 172.3 BPM, and the slow ballad Betelgeuse reads 184.6. Loudness measures mixing, not energy: produced covers have a median of −12.6 dB and stream songs −23.2 dB. All four flagged songs are slow ballads that audio rated energetic: the cover Rayuan Perempuan Gila, mastered at −11.5 dB; both takes of Monokrom, at about −17.5 dB, louder than most stream songs; and Betelgeuse, with doubled tempo. In each of these I believe the audio is wrong, not the text.
- **The catalogue is mostly sad.** 35 of 39 first tags are galau, romantis or sendu. Only 6 songs carry ceria at all, 5 hype and 10 chill. Sendu appears on 21 songs, often beside galau, so the line between those two is fuzzy.
- **Stream themes mostly work.** Birthday, anniversary, Independence Day, New Year and cover uploads were all read from titles correctly. Late-night comes from the publish time, so it is only as right as that time is the stream's start. Two misses: the original release *Gentari Hariku* was tagged a cover, and a #shorts cover picked up a spurious regular-karaoke. "Sadtember" streams recur (2023 and 2024) and land in `seasonal`. That suggests a community theme the fixed set lacks.

## What a full-catalogue run and the mood picker need

- **Cost and time.** The catalogue has 908 song entries, which are 469 distinct titles. Measured on this run, text tagging costs $0.00059 and takes 6.8 s per song, so tagging every distinct title costs about $0.28 and 53 minutes serially. That's a projection from 39 songs. Runs can go in parallel. Tag once per distinct title and artist, not per take, since the takes agreed.
- **Skip audio.** Audio would mean downloading and running demucs on hundreds of hours, for a signal that didn't help. If an audio check is wanted later, use a model trained for arousal and valence instead of hand-built features, and normalize loudness per video.
- **Storage.** Store a hand-editable file keyed by song id, like `server/lyrics-aligned.json`, holding `{ moods, energy, positivity, source: "Lyrics" | "TitleOnly" | "Human" }`. Have the server join it to `/api/get-karaoke`. A human override has to win over the model.
- **Picker design.** Six equal buckets would leave hype, ceria and chill nearly empty. Make the energy and positivity scores drive mood-aware autoplay (nearest neighbour on those two). Offer the picker as a few broad moods (for example "galau / sendu", "romantis", "ceria / hype", "chill") that map to score regions, not to exact tags.
- **Before building.** Fill in `labels.csv`, rerun `report.py`, and check that the human's first tag lands among the model's tags for at least 15 of the 20 songs, and that energy correlates with ρ ≥ 0.6. If galau and sendu keep swapping, merge them, as the model panel already suggests.

<!-- generated:start -->
## Songs

39 songs. Audio energy is the mean percentile rank of tempo, loudness, brightness, onset rate and percussive share within this set, so 0 is the calmest song here and 1 the most energetic. A bold difference is at least 0.4 apart.

| Song | Link | Mood tags | Energy (text) | Positivity (text) | Tempo BPM | Loudness dB | Audio energy | Text − audio | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unwavering Startorch / Wuthering Waves | [0s](https://www.youtube.com/watch?v=bUoOOVO-PHs&t=0s) | hype, ceria | 0.75 | 0.85 | 86.1 | -12.22 | 0.637 | +0.11 | Anthemic, rising orchestral-style track about courage, shining like the sun and rising above the storm, with a hopeful, determined "now or never" feel. |
| Only Love / Trademark | [0s](https://www.youtube.com/watch?v=g26JmYMkml4&t=0s) | galau, romantis | 0.35 | 0.4 | 123.0 | -19.69 | 0.547 | -0.20 | A relationship at a crossroads, with confusion, distance, and pleading for a change of heart, wrapped in hopeful lines about love and a sunrise; the ballad-like tempo keeps it mid-low energy. |
| 1000X / Ghea Indrawari | [0s](https://www.youtube.com/watch?v=auyWQOKHOl4&t=0s) | romantis, chill | 0.3 | 0.8 | 103.4 | -13.0 | 0.684 | -0.38 | A tender, devoted love ballad vowing to find each other in 1000 lifetimes, sung at a slow, gentle tempo with warm, hopeful feeling. |
| You (=I) / BOL4 | [0s](https://www.youtube.com/watch?v=A54s0w3NjuE&t=0s) | romantis, ceria | 0.4 | 0.8 | 103.4 | -11.19 | 0.705 | -0.30 | A soft, mid-tempo K-pop R&B track where the narrator playfully melts in a lover's embrace and admits growing to resemble each other, so the feeling is tender and sweet with a light, bubbly warmth. |
| Blue Jeans / HANA | [0s](https://www.youtube.com/watch?v=EhHikMA-EHs&t=0s) | romantis, chill | 0.5 | 0.7 | 112.3 | -21.83 | 0.505 | -0.01 | A warm, slightly dreamy night-out love song with a hazy R&B groove, where the narrator remembers longing for someone and wants them close. |
| Gentari Hariku / Rumah Kewinci | [0s](https://www.youtube.com/watch?v=rBop0GfMhEo&t=0s) | ceria, hype | 0.65 | 0.9 | 161.5 | -13.06 | 0.705 | -0.06 | No lyrics available; tagged from the title and artist. Rumah Kewinci is a kids' music group, and "Gentari Hariku" (my brightness/sunshine) is likely an upbeat, cheerful children's song. |
| Apa Mungkin / Bernadya | [3581s](https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=3581s) | galau, sendu | 0.3 | 0.15 | 89.1 | -23.14 | 0.363 | -0.06 | A slow, subdued ballad where the narrator, left without explanation, keeps asking what went wrong and whether the other person still loves them, which is classic relationship overthinking. |
| Terlintas / Bernadya | [5198s](https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=5198s) | galau, romantis | 0.25 | 0.4 | 123.0 | -24.42 | 0.216 | +0.03 | A slow, soft ballad where the singer frets over whether a love will last and end happily, hoping for happiness while still uncertain and wishing to stay part of the other person's life. |
| Untungnya, Hidup Harus Tetap Berjalan / Bernadya | [5737s](https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=5737s) | chill, ceria | 0.4 | 0.7 | 112.3 | -23.31 | 0.484 | -0.08 | A reflective, mid-tempo ballad that looks back on past hardship with grateful, hopeful relief ("untungnya" = luckily), so it feels calm and gently uplifting rather than sad or hype. |
| Gala Bunga Matahari / Sal Priadi | [6717s](https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=6717s) | sendu, chill | 0.25 | 0.35 | 99.4 | -24.3 | 0.216 | +0.03 | A gentle, slow ballad about missing someone who has passed away, imagining their new life while the narrator grieves but tries to carry on with a bit of warmth. |
| Nikmati Perjalanannya / Chintya Gabriella | [1792s](https://www.youtube.com/watch?v=xLUUwhCqAi0&t=1792s) | sendu, chill | 0.3 | 0.5 | 80.7 | -27.78 | 0.537 | -0.24 | A gentle, reflective song about repeatedly falling and getting up through hardship, with hurt and tears but a hopeful message to enjoy the journey; not about romance, so sendu fits best, with a calm, laid-back feel. |
| Dari Planet Lain / Sal Priadi | [3110s](https://www.youtube.com/watch?v=xLUUwhCqAi0&t=3110s) | romantis, chill | 0.25 | 0.8 | 117.5 | -30.08 | 0.463 | -0.21 | A tender, slow-paced love song about finding someone who walks beside you without rushing and makes sense of past fear, with a hopeful, warm tone. |
| ALiCE&u / Ayunda Risu | [5450s](https://www.youtube.com/watch?v=xLUUwhCqAi0&t=5450s) | sendu, hype | 0.6 | 0.45 | 112.3 | -21.46 | 0.584 | +0.02 | Lyrics dwell on a fading soul, worry, and an "incomplete melody" with a sad symphony, but the chorus-like chants and the closing "I believe, everything will be fine / time to shine" push it toward an anthemic, hopeful lift. |
| Tampar / Juicy Luicy | [9242s](https://www.youtube.com/watch?v=xLUUwhCqAi0&t=9242s) | galau, sendu | 0.35 | 0.15 | 80.7 | -28.6 | 0.447 | -0.10 | Heartache over someone who keeps lingering after three years, a broken promise-to-forget cycle, and a guilt-tinged wish for their partner to get hurt; the mid-tempo arrangement stays subdued and rain-and-tears imagery adds a quiet sadness. |
| Rayuan Perempuan Gila / Nadin Amizah | [0s](https://www.youtube.com/watch?v=_T-o96i5gaw&t=0s) | galau, sendu | 0.25 | 0.2 | 103.4 | -11.48 | 0.721 | **-0.47** | Slow, hushed ballad where the singer frets over whether a lover still loves her, fears being left, and calls herself a "crazy woman," a sad, self-doubting mood. |
| Perayaan Mati Rasa / Umay Shahab feat. Natania Karin | [11479s](https://www.youtube.com/watch?v=Qb8-ZdUXre0&t=11479s) | galau, sendu | 0.25 | 0.15 | 143.6 | -21.36 | 0.311 | -0.06 | A slow, somber ballad about letting a lover go and crying through the numbness of heartbreak, so it reads as romantic heartache with a melancholic undertone. |
| Di Akhir Perang / Nadin Amizah | [12594s](https://www.youtube.com/watch?v=Qb8-ZdUXre0&t=12594s) | romantis, chill | 0.3 | 0.65 | 152.0 | -25.16 | 0.626 | -0.33 | Soft, slow-building ballad about two people gently teaching each other to accept their flaws and finding relief and happiness after an inner war, with a tender, intimate tone. |
| Semua Aku Dirayakan / Nadin Amizah | [14982s](https://www.youtube.com/watch?v=nHnPb4xYTlg&t=14982s) | sendu, romantis | 0.2 | 0.4 | 80.7 | -28.3 | 0.242 | -0.04 | A slow, gentle ballad about being comforted while crying ("Jangan menangis") and feeling fully accepted, with a hopeful note that the storm will pass, so it reads as tender but quietly sad. |
| Halu / Feby Putri | [15914s](https://www.youtube.com/watch?v=nHnPb4xYTlg&t=15914s) | galau, romantis | 0.3 | 0.35 | 172.3 | -27.35 | 0.305 | -0.01 | A soft, slow-paced ballad about secretly longing for someone from afar and knowing the closeness is only a daydream ("halu"), so it reads as unrequited, overthinking love with a tender undertone. |
| Love wins all / IU | [16810s](https://www.youtube.com/watch?v=nHnPb4xYTlg&t=16810s) | romantis, galau | 0.4 | 0.55 | 152.0 | -25.69 | 0.358 | +0.04 | A slow-building, orchestral ballad about escaping the world with a lover and wanting to be lost and even sad together; the love is tender and devoted, but the lyrics carry doubt about a bad ending and lost-ness. |
| Tampar / Juicy Luicy | [19560s](https://www.youtube.com/watch?v=nHnPb4xYTlg&t=19560s) | galau, sendu | 0.35 | 0.2 | 172.3 | -25.16 | 0.411 | -0.06 | A heartbroken song about someone who keeps breaking promises and stays on the singer's mind, with tears and quiet disappointment over three years, sung in a slow, subdued arrangement. |
| Lantas / Juicy Luicy | [19874s](https://www.youtube.com/watch?v=nHnPb4xYTlg&t=19874s) | galau | 0.45 | 0.15 | 78.3 | -26.8 | 0.179 | +0.27 | Longing for someone in a secret affair who is already committed, with self-doubt and an unwilling-to-let-go conflict, all carried by a mid-tempo pop arrangement. |
| Monokrom / Tulus | [5186s](https://www.youtube.com/watch?v=x5wzO1pTt8c&t=5186s) | sendu, chill | 0.2 | 0.45 | 172.3 | -17.74 | 0.732 | **-0.53** | A slow, gentle ballad of nostalgia and gratitude for a parent or family who raised the singer, with a bittersweet undertone about one day leaving them behind; it is not about romance. |
| Monokrom / Tulus | [5480s](https://www.youtube.com/watch?v=x5wzO1pTt8c&t=5480s) | sendu, romantis | 0.25 | 0.45 | 117.5 | -17.29 | 0.663 | **-0.41** | A slow, nostalgic ballad of gratitude for family and childhood memories in black-and-white photos, bittersweet with mortality undertones and no romantic-heartache angle. |
| Hati-Hati di Jalan / Tulus | [6609s](https://www.youtube.com/watch?v=x5wzO1pTt8c&t=6609s) | galau, sendu | 0.3 | 0.2 | 95.7 | -19.58 | 0.411 | -0.11 | A slow, wistful ballad about two people who thought they would end up together and now must part, with lingering longing ("semoga rindu ini menghilang") and a bittersweet "hati-hati di jalan" goodbye. |
| Kukira Kau Rumah / Amigdala | [6998s](https://www.youtube.com/watch?v=x5wzO1pTt8c&t=6998s) | galau, sendu | 0.35 | 0.15 | 198.8 | -20.71 | 0.505 | -0.15 | A heartache song about realizing someone you thought was home was only a temporary rental, with a slow, subdued arrangement and repeated "kau bukan rumah" lines. |
| Jagung Rebus / Maya Jasika | [8536s](https://www.youtube.com/watch?v=x5wzO1pTt8c&t=8536s) | ceria, hype | 0.65 | 0.9 | 95.7 | -18.08 | 0.721 | -0.07 | A playful, comedic novelty track with a bouncy beat and cheerful call-and-response; the corn-as-innuendo lyrics are silly and light rather than emotional. |
| Kau Rumahku / Raissa Anggiani | [1886s](https://www.youtube.com/watch?v=g5XJsXaeKvE&t=1886s) | romantis, chill | 0.35 | 0.8 | 172.3 | -19.35 | 0.6 | -0.25 | A tender love song about someone who feels like home, with soft, mid-tempo pop instrumentation and hopeful, affectionate lyrics. |
| Jiwa Yang Bersedih / Ghea Indrawari | [3094s](https://www.youtube.com/watch?v=g5XJsXaeKvE&t=3094s) | sendu, chill | 0.25 | 0.35 | 95.7 | -18.55 | 0.447 | -0.20 | A slow, gentle ballad about comforting a grieving soul ("Menangislah, kau juga manusia"), with a melancholic tone that is not about romance but ends on a hopeful note that you will be heard. |
| Oh! Asmara / Kobo Kanaeru | [6694s](https://www.youtube.com/watch?v=g5XJsXaeKvE&t=6694s) | romantis, ceria | 0.7 | 0.85 | 123.0 | -18.15 | 0.574 | +0.13 | A bouncy, giddy love song about a racing heart and a crush slowly warming up, with a playful, hopeful tone throughout. |
| Eiyuu no Shihen / Mirai Kodai Gakudan | [7896s](https://www.youtube.com/watch?v=g5XJsXaeKvE&t=7896s) | sendu, hype | 0.65 | 0.45 | 136.0 | -20.66 | 0.5 | +0.15 | A sweeping, anthemic epic about mortality and legacy: the lyrics dwell on birth, fleeting life and things left behind, with a melancholic undertone, but the chorus builds to a grand, triumphant "epic poem" climax. |
| Runtuh / Feby Putri feat. Fiersa Besari | [12837s](https://www.youtube.com/watch?v=g5XJsXaeKvE&t=12837s) | sendu, galau | 0.3 | 0.15 | 129.2 | -20.19 | 0.537 | -0.24 | A slow, heavy ballad about emotional exhaustion, pretending to laugh while hurting, and wanting permission to cry; the sadness is about self-hurt rather than romance, with galau as a secondary tag for the emotional strain. |
| Mendarah / Nadin Amizah | [10398s](https://www.youtube.com/watch?v=_5yR3KQekYs&t=10398s) | galau, sendu | 0.3 | 0.25 | 123.0 | -20.79 | 0.258 | +0.04 | A slow, somber ballad about loving someone from far away and keeping that love as a quiet secret, with a heavy sense of longing and feeling torn apart. |
| Dia Masa Lalumu, Aku Masa Depanmu / Vionita | [2548s](https://www.youtube.com/watch?v=YsUXvVM7a-g&t=2548s) | galau, sendu | 0.4 | 0.2 | 129.2 | -16.89 | 0.553 | -0.15 | A heartbreak ballad about loving someone who is still trapped by their ex, with the narrator close to giving up, so the feeling is painful overthinking with a melancholic undertone. |
| Tertawan Hati / Awdella | [5219s](https://www.youtube.com/watch?v=YsUXvVM7a-g&t=5219s) | galau, sendu | 0.3 | 0.15 | 129.2 | -15.88 | 0.553 | -0.25 | A slow, heavy ballad about staying in a relationship that is falling apart, feeling exhausted and broken but unable to let go, so it is mostly heartache and overthinking love. |
| Hati Yang Kau Sakiti / Rossa | [4904s](https://www.youtube.com/watch?v=1KNfl-oMRPE&t=4904s) | galau, sendu | 0.3 | 0.1 | 123.0 | -26.22 | 0.553 | -0.25 | A slow, tearful ballad about being cheated on and hurt by a partner who chose someone else, with the singer crying and feeling wronged. |
| Betelgeuse / Yuuri | [5995s](https://www.youtube.com/watch?v=I6rpgZhQCBo&t=5995s) | romantis, sendu | 0.3 | 0.6 | 184.6 | -26.32 | 0.768 | **-0.47** | A slow, tender ballad about two people promising to shine together like Betelgeuse, hopeful and devoted but touched with quiet fear of mortality and time passing. |
| Janji / PROJEKT GENESIS | [6873s](https://www.youtube.com/watch?v=PlNyvoQEPUs&t=6873s) | romantis, galau | 0.5 | 0.55 | 117.5 | -35.76 | 0.368 | +0.13 | No lyrics available; tagged from the title "Janji" (promise), which suggests a love-promise theme, with a guessed mid-tempo feel and no confident knowledge of the track. |
| Michi ~to you all / aluto | [13615s](https://www.youtube.com/watch?v=0trjgNB55XQ&t=13615s) | romantis, galau | 0.45 | 0.55 | 103.4 | -27.79 | 0.511 | -0.06 | Longing to reach someone's heart and being driven forward by their voice, face, and every expression reads as tender love, with some lost-and-uncertain undertone; the closing hint that the clouds will part keeps it hopeful rather than sad. |

## Text and audio disagree (4)

- Rayuan Perempuan Gila / Nadin Amizah: text 0.25, audio 0.721 (103.4 BPM, -11.48 dB, 0.106 percussive).
- Monokrom / Tulus: text 0.2, audio 0.732 (172.3 BPM, -17.74 dB, 0.116 percussive).
- Monokrom / Tulus: text 0.25, audio 0.663 (117.5 BPM, -17.29 dB, 0.101 percussive).
- Betelgeuse / Yuuri: text 0.3, audio 0.768 (184.6 BPM, -26.32 dB, 0.164 percussive).

## Stream themes

| Video | Kind | Published (UTC) | Themes | Reason |
| --- | --- | --- | --- | --- |
| [【Karaoke Stream】Nyanyi...........................](https://www.youtube.com/watch?v=0trjgNB55XQ) | karaoke | 2023-02-26 18:34 | regular-karaoke, late-night | Titled as an ordinary karaoke stream; it went live at 01:34 UTC+7, inside the late-night window, and the mixed setlist fits a regular singing session. |
| [Happy #IndependenceDay2023  !!](https://www.youtube.com/watch?v=PlNyvoQEPUs) | karaoke | 2023-08-17 10:04 | seasonal, regular-karaoke | Title is an Indonesian Independence Day (17 Aug) celebration, and the patriotic setlist fits; it's a karaoke stream published at 17:04 UTC+7, so not late-night. |
| [SINGING STREAM - SADTURDAY SADTEMBER WITH FIO...](https://www.youtube.com/watch?v=I6rpgZhQCBo) | karaoke | 2023-09-16 19:21 | seasonal, late-night | Title is a September-themed sad-songs event ("Sadtember"), and the 02:21 UTC+7 start also falls in the late-night window. |
| [NYANYI ！！！](https://www.youtube.com/watch?v=1KNfl-oMRPE) | karaoke | 2023-11-14 10:44 | regular-karaoke | Title "NYANYI!!!" (Sing!!!) and kind "karaoke" mark an ordinary singing stream; it airs at 17:44 UTC+7, not late-night, and the varied setlist has no birthday or anniversary signal. |
| [Menyanyi di tengah hujan](https://www.youtube.com/watch?v=YsUXvVM7a-g) | karaoke | 2023-11-26 20:07 | regular-karaoke, late-night | Kind is karaoke with an ordinary mix of ballads and pop songs, and the title "Menyanyi di tengah hujan" has no event cue; the 2023-11-26 20:07 UTC publish time is 03:07 UTC+7, so a stream of about 14 songs likely ran inside the late-night window. |
| [【FIOYODAY2023】BIRTHDAY BNUY! (˵ •̀ ᴗ - ˵ ) ✧](https://www.youtube.com/watch?v=_5yR3KQekYs) | karaoke | 2023-12-30 18:17 | birthday, late-night | Title is "BIRTHDAY BNUY!", and the published time (01:17 UTC+7) also falls in the late-night window. |
| [First Stream 2024 - Singing Stream 🎤](https://www.youtube.com/watch?v=g5XJsXaeKvE) | karaoke | 2024-01-02 17:41 | seasonal, late-night | Title marks the first stream of 2024, a New Year seasonal opener; it began 00:41 UTC+7 on Jan 3, inside the late-night window. |
| [Let's chill and sing🎤 /bentar aja 'w'](https://www.youtube.com/watch?v=x5wzO1pTt8c) | karaoke | 2024-01-03 17:37 | late-night, regular-karaoke | Published 00:37 UTC+7 (within the 22:00-03:00 window) and the casual "bentar aja" karaoke title fits an ordinary singing stream. |
| [Happy 2nd Anniversary!! 🎉✨ - 1st Endurance Stream #2](https://www.youtube.com/watch?v=nHnPb4xYTlg) | karaoke | 2024-03-14 18:30 | anniversary, late-night | Title says "Happy 2nd Anniversary"; published 18:30 UTC (01:30 UTC+7) as an endurance karaoke stream, so late-night is secondary. |
| [malam ini kita](https://www.youtube.com/watch?v=Qb8-ZdUXre0) | karaoke | 2024-06-17 18:05 | late-night, regular-karaoke | Published 2024-06-17 18:05 UTC, which is 01:05 UTC+7, inside the late-night window; the title "malam ini kita" fits, and the two ordinary karaoke songs point to a regular-karaoke stream. |
| [Rayuan Perempuan Gila - Nadin Amizah Cover by Fiona Clearesta](https://www.youtube.com/watch?v=_T-o96i5gaw) | cover | 2024-06-22 12:00 | cover-release | Title marks it as a cover upload by Fiona, kind is "cover", and it was published at 19:00 UTC+7 so no late-night tag applies. |
| [nyanyi lagi eheheh 🐰](https://www.youtube.com/watch?v=xLUUwhCqAi0) | karaoke | 2024-07-31 10:24 | regular-karaoke | Title "nyanyi lagi eheheh" ("singing again") and a karaoke kind with a list of covers, published 17:24 UTC+7 (not late-night), with no birthday, anniversary, debut, collab, or seasonal cues. |
| [wiii sudah bulan sadtember!! 🐰](https://www.youtube.com/watch?v=rQ1JC4YC1Qs) | karaoke | 2024-09-07 16:25 | late-night, regular-karaoke | Published 16:25 UTC (23:25 UTC+7), inside the late-night window; a plain karaoke stream of sad Bernadya songs, with one birthday song that doesn't set the theme. |
| [Gentari Hariku - Rumah Kewinci 【Fio's side ver.】](https://www.youtube.com/watch?v=rBop0GfMhEo) | original | 2026-01-03 13:00 | cover-release, collab | Title marks it as a produced cover of "Gentari Hariku / Rumah Kewinci" in the "Fio's side ver." format, which suggests one half of a duet; not a late-night or seasonal stream. |
| [Hana - Blue Jeans #vtuber #vtuberid #shorts #vtuberindonesia](https://www.youtube.com/watch?v=EhHikMA-EHs) | cover | 2026-05-06 23:54 | cover-release | Titled as a cover of "Blue Jeans" (kind: cover), published 06:54 UTC+7, outside the late-night window, with no birthday, debut, collab, or seasonal cues. |
| [You(=I) - BOL4 #vtuber #vtuberid #vtuberindonesia #shorts #cover #sing](https://www.youtube.com/watch?v=A54s0w3NjuE) | cover | 2026-05-09 12:50 | cover-release, regular-karaoke | Kind is "cover" and the title carries #cover, marking a produced song cover upload; published 19:50 UTC+7 so not late-night, and it's a short with no birthday, anniversary, debut, or collab cues. |
| [1000X - Ghea Indrawari (by fioyoyow) #vtuber #vtuberid #shorts #shorts](https://www.youtube.com/watch?v=auyWQOKHOl4) | cover | 2026-05-10 03:05 | cover-release | Kind is cover and the title is a #shorts cover of 1000X by Ghea Indrawari; published 10:05 UTC+7, so not late-night. |
| [Trademark - Only Love short cover by Fio  #vtuber #cover #singing #cov](https://www.youtube.com/watch?v=g26JmYMkml4) | cover | 2026-07-24 12:57 | cover-release | Titled as a short cover upload of "Only Love" (kind: cover), published 19:57 UTC+7, so not a late-night stream. |
| [Unwavering Startorch - Wuthering Waves cover by Fiona Clearesta #vtube](https://www.youtube.com/watch?v=bUoOOVO-PHs) | cover | 2026-09-29 12:24 | cover-release | Title says "cover" with kind "cover", and the upload is a single Wuthering Waves song cover; published 19:24 UTC+7, so not late-night, and no birthday, anniversary, seasonal, or collab markers. |

## Labeling sheet

`labels.csv` holds these 20 songs. Open each link, listen for a minute, and fill in `moods` (one or two of ceria, galau, hype, chill, romantis, sendu, strongest first), `energy_1to5` (1 calm, 5 energetic), `positivity_1to5` (1 sad, 5 happy) and `labeler`. Don't look at the model's tags first.

| # | Song | Link |
| --- | --- | --- |
| 1 | Terlintas / Bernadya | https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=5198s |
| 2 | Apa Mungkin / Bernadya | https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=3581s |
| 3 | Tampar / Juicy Luicy | https://www.youtube.com/watch?v=xLUUwhCqAi0&t=9242s |
| 4 | Semua Aku Dirayakan / Nadin Amizah | https://www.youtube.com/watch?v=nHnPb4xYTlg&t=14982s |
| 5 | Untungnya, Hidup Harus Tetap Berjalan / Bernadya | https://www.youtube.com/watch?v=rQ1JC4YC1Qs&t=5737s |
| 6 | Betelgeuse / Yuuri | https://www.youtube.com/watch?v=I6rpgZhQCBo&t=5995s |
| 7 | Mendarah / Nadin Amizah | https://www.youtube.com/watch?v=_5yR3KQekYs&t=10398s |
| 8 | Love wins all / IU | https://www.youtube.com/watch?v=nHnPb4xYTlg&t=16810s |
| 9 | Rayuan Perempuan Gila / Nadin Amizah | https://www.youtube.com/watch?v=_T-o96i5gaw&t=0s |
| 10 | Di Akhir Perang / Nadin Amizah | https://www.youtube.com/watch?v=Qb8-ZdUXre0&t=12594s |
| 11 | Kau Rumahku / Raissa Anggiani | https://www.youtube.com/watch?v=g5XJsXaeKvE&t=1886s |
| 12 | Perayaan Mati Rasa / Umay Shahab feat. Natania Karin | https://www.youtube.com/watch?v=Qb8-ZdUXre0&t=11479s |
| 13 | Only Love / Trademark | https://www.youtube.com/watch?v=g26JmYMkml4&t=0s |
| 14 | Runtuh / Feby Putri feat. Fiersa Besari | https://www.youtube.com/watch?v=g5XJsXaeKvE&t=12837s |
| 15 | Janji / PROJEKT GENESIS | https://www.youtube.com/watch?v=PlNyvoQEPUs&t=6873s |
| 16 | Blue Jeans / HANA | https://www.youtube.com/watch?v=EhHikMA-EHs&t=0s |
| 17 | Gentari Hariku / Rumah Kewinci | https://www.youtube.com/watch?v=rBop0GfMhEo&t=0s |
| 18 | Unwavering Startorch / Wuthering Waves | https://www.youtube.com/watch?v=bUoOOVO-PHs&t=0s |
| 19 | Halu / Feby Putri | https://www.youtube.com/watch?v=nHnPb4xYTlg&t=15914s |
| 20 | Kukira Kau Rumah / Amigdala | https://www.youtube.com/watch?v=x5wzO1pTt8c&t=6998s |

## Agreement with labels

No labels yet. Fill in `labels.csv` and rerun `report.py`.

## Model panel (not ground truth)

Opus 5.5, Fable 5.2 and Sonnet 5.5 each tagged the labeling-sheet songs blind, from the same prompt and lyrics Haiku got. This shows whether cheap Haiku agrees with stronger models, and how much strong models agree with each other. None of them hears the singing, so it does not replace human labels.

| Pair | First tag among the other's tags | Same first tag | Energy ρ | Positivity ρ |
| --- | --- | --- | --- | --- |
| haiku vs opus | 90% | 75% | 0.60 | 0.90 |
| haiku vs fable | 90% | 75% | 0.64 | 0.89 |
| haiku vs sonnet | 100% | 75% | 0.64 | 0.93 |
| opus vs fable | 85% | 75% | 0.80 | 0.95 |
| opus vs sonnet | 90% | 70% | 0.74 | 0.93 |
| fable vs sonnet | 95% | 80% | 0.73 | 0.92 |

Cost of the panel: opus $0.280, fable $0.507, sonnet $0.125.

## Cost and runtime

| Step | Calls | Total | Per song or video | Tokens in / out | Cost |
| --- | --- | --- | --- | --- | --- |
| Audio features (CPU, cached stems) | 39 | 515.2 s | 13.2 s | | $0 |
| songText (Haiku 5.5 via `claude -p`) | 39 | 265.5 s | 6.81 s | 95875 / 22550 | $0.0231 ($0.00059 each) |
| streamTheme (Haiku 5.5 via `claude -p`) | 19 | 139.9 s | 7.36 s | 38278 / 11063 | $0.0105 ($0.00055 each) |
<!-- generated:end -->
