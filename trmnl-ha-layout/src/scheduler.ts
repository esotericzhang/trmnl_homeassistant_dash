export function startScheduler(seconds: number, job: () => Promise<unknown>): NodeJS.Timeout | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return setInterval(() => {
    job().catch((error) => console.error('scheduled refresh failed', error))
  }, seconds * 1000)
}
