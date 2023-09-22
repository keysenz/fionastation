import React, { useState } from 'react'
import { axiosInstance } from '../../lib/axiosInstance'

export default function InputVideo() {
  const [karaoke,setKaraoke] = useState({})
  const onChange = (e) => {
    setKaraoke({
      ...karaoke,
      [e.target.name]: e.target.value
    })
  }
  const onSubmit = (e) => {
    e.preventDefault();
    console.log(karaoke)
    try {
      let res = axiosInstance.post("/api/post-karaoke", karaoke,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      })
    } catch (error) {
      
    }
  }
  return (
    <div>
        <form onSubmit={onSubmit}>\
        <input type="text" name="url" onChange={onChange}/>
        <textarea name="karaoke" id="" cols="30" rows="10" onChange={onChange}></textarea>
        <button type="submit" className='p-2 bg-white text-black'>Submit Input</button>
        </form>
    </div>
  )
}
