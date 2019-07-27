import LRUQueue from './LRUQueue';

export type DisposeFunction = () => void;

export type CacheStrategy = 'age' | 'lru';

/**
 * An item in the cache, stored with metadata.
 */
export interface IItem<T> {
  value: T;
  expireAfterTimestamp: number;
  storageTimestamp: number;
  dispose?: DisposeFunction;
}

export interface IOptions<K, V> {
  /** Time to live (TTL) for items without specified custom TTL, given in milliseconds. */
  defaultTTL: number;
  /** Maximal number of items in the cache before it starts evicting items on adding new ones */
  maximalItemCount: number;
  evictExceedingItemsBy: CacheStrategy;
  /** You can supply your own cache to this. */
  cache: Map<K, IItem<V>>;
}

export interface ISetItemOptions<K, V> {
  ttl?: number;
  storageTimestamp?: number;
  dispose?: DisposeFunction;
}

/**
 * A cache.
 *
 * - Evicts items by least recent use ('lru') or age depending on configuration
 * - Evicts items if it reaches a configurable item count limit on insert
 * - Evicts too old items on get or on request
 * - Supports items with different TTLs
 */

export default class Cache<K, V> {
  public options: Readonly<IOptions<K, V>>;
  public lruQueue = new LRUQueue<K>();

  constructor({
    defaultTTL = Infinity,
    maximalItemCount = Infinity,
    cache = new Map<K, IItem<V>>(),
    evictExceedingItemsBy = 'lru',
  }: Partial<IOptions<K, V>> = {}) {
    if (defaultTTL < 0) {
      throw new Error('Please supply a `ttl` value greater than zero.');
    }

    if (maximalItemCount < 1) {
      throw new Error(
        'Please supply a `maximalItemCount` parameter that is greater than zero, or do not supply the parameter to allow an infinite number of items.'
      );
    }

    this.options = Object.freeze({
      cache,
      defaultTTL,
      evictExceedingItemsBy,
      maximalItemCount,
    });
  }

  public set(
    key: K,
    value: V,
    {
      ttl = this.options.defaultTTL,
      storageTimestamp = Date.now(),
      dispose,
    }: ISetItemOptions<K, V> = {}
  ): boolean {
    // Adding the value to the cache is not possible if ttl is zero.
    if (ttl <= 0) {
      return false;
    }

    // Check for infinity in which case the item persists forever.
    const expireAfterTimestamp = ttl < Infinity ? storageTimestamp + ttl : Infinity;

    const item: IItem<V> = {
      dispose,
      expireAfterTimestamp,
      storageTimestamp,
      value,
    };

    while (this.options.cache.size >= this.options.maximalItemCount) {
      switch (this.options.evictExceedingItemsBy) {
        case 'age':
          this.deleteOldestItem();
          break;
        case 'lru':
          this.deleteLeastRecentlyUsedItem();
          break;
      }
    }

    this.lruQueue.push(key);
    this.options.cache.set(key, item);
    return true;
  }

  /**
   * Looks up a cached value + metadata without deleting it if expired.
   *
   * @param key The key to look up
   * @returns the looked up value + metadata, or `undefined` if the value is not cached.
   */
  public peekItem(key: K): IItem<V> | undefined {
    return this.options.cache.get(key);
  }

  /**
   * Looks up a cached value without deleting it if expired.
   *
   * @param key The key to look up
   * @returns the looked up value, or `undefined` if the value is not cached.
   */

  public peek(key: K): V | undefined {
    const item = this.peekItem(key);
    return item && item.value;
  }

  /**
   * Looks up a cached value + metadata, deleting it if its older than the given timestamp.
   *
   * @param key The key to look up
   * @returns the looked up value + metadata, or `undefined` if the value is expired or not cached.
   */

  public getItem(key: K, ifNotExpiredOnTimestamp: number = Date.now()): IItem<V> {
    const item = this.options.cache.get(key);
    if (typeof item !== 'undefined' && item.expireAfterTimestamp <= ifNotExpiredOnTimestamp) {
      this.delete(key);
      return;
    }
    this.lruQueue.touch(key);
    return item;
  }

  /**
   * Looks up a value in the cache, deleting it if expired.
   *
   * @param key The key to look up
   * @param ifNotExpiredOnTimestamp If an item is older than this timestamp, it expires.
   * @returns the looked up value, or `undefined` if the value is expired or not cached.
   */

  public get(key: K, ifNotExpiredOnTimestamp: number = Date.now()): V | undefined {
    const item = this.getItem(key, ifNotExpiredOnTimestamp);
    return item && item.value;
  }

  /**
   * Sweeps the cache and removes all items that are expired after the given timestamp.
   *
   * @param ifNotOlderThanTimestamp If an item is older than this timestamp, it expires.
   */
  public evictExpiredItems(ifOlderThanTimestamp: number = Date.now()) {
    for (const [key, item] of this.options.cache) {
      if (item.expireAfterTimestamp <= ifOlderThanTimestamp) {
        this.delete(key);
      }
    }
  }

  /**
   * Looks up an item in the cache without marking it as touched.
   *
   * @param key The key to look up
   */
  public has(key: K): boolean {
    return this.options.cache.has(key);
  }

  /**
   * Looks up an item in the cache without marking it as touched.
   *
   * @param key The key to look up
   */
  public delete(key: K): boolean {
    this.dispose(key);
    this.lruQueue.delete(key);
    return this.options.cache.delete(key);
  }

  /**
   * Removes all items from the cache.
   */
  public clear(): void {
    this.options.cache.clear();
    this.lruQueue.clear();
  }

  public size(): number {
    return this.options.cache.size;
  }

  public setTTL(key: K, ttl: number, beginningFromTimestamp: number = Date.now()) {
    const item = this.options.cache.get(key);
    item.expireAfterTimestamp = beginningFromTimestamp + ttl;
    return item.expireAfterTimestamp;
  }

  private dispose(key: K) {
    const item = this.peekItem(key);
    if (item.dispose) {
      item.dispose();
    }
  }

  private deleteOldestItem() {
    // This works because the insertion order is maintained when iterating keys.
    const key = this.options.cache.keys().next().value;
    if (typeof key !== 'undefined') {
      this.delete(key);
    }
  }

  private deleteLeastRecentlyUsedItem() {
    const key = this.lruQueue.shift();
    this.dispose(key);
    this.lruQueue.delete(key);
    return this.options.cache.delete(key);
  }
}
