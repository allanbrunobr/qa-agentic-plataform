export async function submitOrder(payload: { email: string; items: number }) {
  return fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
