import { useState } from 'react'
import Login from './screens/Login'
import AppShell from './app/AppShell'

export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('seltd_auth') === '1')

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  return <AppShell onLogout={() => { sessionStorage.removeItem('seltd_auth'); setAuthed(false) }} />
}
