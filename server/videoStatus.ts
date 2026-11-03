const GONE_STATUSES = new Set([401, 403, 404])
const CONCURRENCY = 5
const REQUEST_TIMEOUT_MS = 10_000
const REFRESH_INTERVAL_MS = 60 * 60 * 1000

const goneIds = new Set<string>()
let isRefreshing = false

export const isGone = (videoId: string): boolean => goneIds.has(videoId)

// NOTE: only a clear answer changes the set, so a YouTube hiccup never disables songs.
async function check(videoId: string): Promise<void> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )
    if (response.status === 200) {
      goneIds.delete(videoId)
    } else if (GONE_STATUSES.has(response.status)) {
      goneIds.add(videoId)
    }
    await response.body?.cancel()
  } catch {
    // keep the previous answer
  }
}

export async function refresh(listVideoIds: () => string[]): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const queue = [...new Set(listVideoIds())]
    const worker = async () => {
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        await check(id)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  } catch (error) {
    console.error('Could not refresh video status:', error)
  } finally {
    isRefreshing = false
  }
}

export function startRefreshing(listVideoIds: () => string[]): void {
  void refresh(listVideoIds)
  setInterval(() => void refresh(listVideoIds), REFRESH_INTERVAL_MS).unref()
}
