import { createContext, useContext, useState } from 'react'

const DrillCtx = createContext({ open: () => {}, close: () => {}, target: null })

export function DrillProvider({ children }) {
  const [target, setTarget] = useState(null)
  return (
    <DrillCtx.Provider value={{ target, open: setTarget, close: () => setTarget(null) }}>
      {children}
    </DrillCtx.Provider>
  )
}

export const useDrill = () => useContext(DrillCtx)
