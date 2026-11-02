import Fuse from 'fuse.js'

/** Builds a search over one kind of item. The index is rebuilt only when the
 *  list itself changes, because views run on every Message. */
export const makeFuzzySearch = <Item>(keys: ReadonlyArray<string>) => {
  const indexes = new WeakMap<ReadonlyArray<Item>, Fuse<Item>>()

  const indexFor = (items: ReadonlyArray<Item>): Fuse<Item> => {
    const existing = indexes.get(items)
    if (existing) {
      return existing
    }
    const created = new Fuse(items, { keys: [...keys], threshold: 0.4 })
    indexes.set(items, created)
    return created
  }

  return (items: ReadonlyArray<Item>, query: string): ReadonlyArray<Item> =>
    query.trim() === ''
      ? items
      : indexFor(items)
          .search(query)
          .map(({ item }) => item)
}
