import { Effect, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

export const FetchFailure = defineTaggedUnion({
  Unreachable: {},
  Rejected: { status: Schema.Number },
  Unreadable: {},
})
export type FetchFailure = typeof FetchFailure.Type

export const fetchFailureMessage = (failure: FetchFailure): string =>
  FetchFailure.match(failure, {
    Unreachable: () => 'Could not reach the archive',
    Rejected: ({ status }) => `The archive responded with ${status}`,
    Unreadable: () => 'The archive sent something unreadable',
  })

export const fetchJsonOrFailure = <A>(
  path: string,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, FetchFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(path),
      catch: () => FetchFailure.Unreachable(),
    })
    if (!response.ok) {
      return yield* Effect.fail(
        FetchFailure.Rejected({ status: response.status }),
      )
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => FetchFailure.Unreadable(),
    })
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => FetchFailure.Unreadable()),
    )
  })

export const fetchJson = <A>(
  path: string,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, string> =>
  fetchJsonOrFailure(path, schema).pipe(Effect.mapError(fetchFailureMessage))
