import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.8.2/css/all.min.css" crossOrigin="anonymous" />
        <link rel="shortcut icon" href="/FioTSKR.webp" />
        <meta property="twitter:title" content="Fiona Station: Anything About Fiona Clearesta"></meta>
        <meta property="twitter:image" content="https://fionastation.com/fio_station_sleeve.png"></meta>
        <meta property="twitter:description" content="Fan-made Website to navigate through Fiona's Karaoke Archive, you can play it or just find it"></meta>
        <meta property="twitter:card" content="summary_large_image"></meta>
        <meta property='description' content="Fan-made Website to navigate through Fiona's Karaoke Archive, you can play it or just find it"></meta>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
