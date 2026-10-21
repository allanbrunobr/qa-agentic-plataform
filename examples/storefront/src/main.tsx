import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { submitOrder } from './order-service'
import './styles.css'

function App() {
  const [email, setEmail] = useState('')
  const [items, setItems] = useState(0)
  const [message, setMessage] = useState('')

  return (
    <main>
      <h1>Generic Storefront</h1>
      <label>
        Customer email
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" />
      </label>
      <button onClick={() => setItems((value) => value + 1)}>Add item to cart</button>
      <p>Cart items: {items}</p>
      <button disabled={!email || items === 0} onClick={() => void submitOrder({ email, items }).then(() => setMessage('Order submitted successfully'))}>
        Submit order
      </button>
      <output>{message}</output>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
