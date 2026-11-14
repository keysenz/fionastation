import { Effect, Option, Schema } from 'effect'
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

export const WriteFailure = defineTaggedUnion({
  Unreachable: {},
  Unreadable: {},
  Forbidden: {},
  NotFound: {},
  Deleted: {},
  Conflict: {},
  TooLarge: {},
  RateLimited: {},
  Unavailable: {},
  Rejected: { status: Schema.Number },
})
export type WriteFailure = typeof WriteFailure.Type

export const writeFailureOfStatus = (status: number): WriteFailure => {
  switch (status) {
    case 403:
      return WriteFailure.Forbidden()
    case 404:
      return WriteFailure.NotFound()
    case 409:
      return WriteFailure.Conflict()
    case 410:
      return WriteFailure.Deleted()
    case 413:
      return WriteFailure.TooLarge()
    case 429:
      return WriteFailure.RateLimited()
    case 503:
      return WriteFailure.Unavailable()
    default:
      return WriteFailure.Rejected({ status })
  }
}

export type JsonWrite = Readonly<{
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  maybeBody: Option.Option<unknown>
  maybeBearer: Option.Option<string>
}>

export const sendJson = <A>(
  write: JsonWrite,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, WriteFailure> =>
  Effect.gen(function* () {
    const headers = new Headers()
    Option.map(write.maybeBody, () =>
      headers.set('content-type', 'application/json'),
    )
    Option.map(write.maybeBearer, token =>
      headers.set('authorization', `Bearer ${token}`),
    )
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(write.path, {
          method: write.method,
          headers,
          body: Option.match(write.maybeBody, {
            onNone: () => null,
            onSome: body => JSON.stringify(body),
          }),
        }),
      catch: () => WriteFailure.Unreachable(),
    })
    if (!response.ok) {
      return yield* Effect.fail(writeFailureOfStatus(response.status))
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => WriteFailure.Unreadable(),
    })
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => WriteFailure.Unreadable()),
    )
  })

export const postWithoutReply = (
  path: string,
  body: unknown,
): Effect.Effect<void, WriteFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        }),
      catch: () => WriteFailure.Unreachable(),
    })
    if (!response.ok) {
      return yield* Effect.fail(writeFailureOfStatus(response.status))
    }
  })
