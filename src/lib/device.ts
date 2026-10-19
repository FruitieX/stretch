import { useCallback, useState } from 'react'
import { DEFAULT_DEVICE, type Device } from './model.ts'
import { load, newId, persist } from './store.ts'

const DEVICE_KEY = 'stretch.device'
const DEVICE_ID_KEY = 'stretch.deviceId'

/** A stable random id for this browser. */
export function deviceId(): string {
  let id = load<string | null>(DEVICE_ID_KEY, null)
  if (!id) {
    id = newId()
    persist(DEVICE_ID_KEY, id)
  }
  return id
}

export function useDevice() {
  const [device, setDevice] = useState<Device>(() => ({
    ...DEFAULT_DEVICE,
    ...load<Partial<Device>>(DEVICE_KEY, {}),
  }))
  const update = useCallback((patch: Partial<Device>) => {
    setDevice((d) => {
      const next = { ...d, ...patch }
      persist(DEVICE_KEY, next)
      return next
    })
  }, [])
  return [device, update] as const
}
