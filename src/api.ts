import { Effect, Schema } from 'effect'

/** Reads a JSON route and decodes it. The error is written for visitors. */
export const fetchJson = <A>(
  path: string,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, string> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(path),
      catch: () => 'Could not reach the archive',
    })
    if (!response.ok) {
      return yield* Effect.fail(`The archive responded with ${response.status}`)
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => 'The archive sent something unreadable',
    })
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => 'The archive sent something unreadable'),
    )
  })
