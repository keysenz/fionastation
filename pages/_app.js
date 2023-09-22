import Script from 'next/script'
import Layout from '../components/layout'
import '../styles/globals.css'
import { Analytics } from '@vercel/analytics/react';

export default function App({ Component, pageProps }) {
  return (
      <Layout>
      <Script src="https://kit.fontawesome.com/422544a610.js" crossorigin="anonymous" defer={false}/>
      <Component {...pageProps} />
      <Analytics />
      </Layout>
  )
}
