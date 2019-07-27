import Cache, { CacheStrategy } from './Cache';

describe('Cache', () => {
  it('caches items', () => {
    const cache = new Cache();
    cache.set('foo', 'bar');
    cache.set('qoo', 'qux');
    expect(cache.get('foo')).toBe('bar');
    expect(cache.get('qoo')).toBe('qux');
    expect(cache.size()).toBe(2);
  });

  it('evicts exceeding items by age', () => {
    const cache = new Cache<string, string>({
      evictExceedingItemsBy: 'age',
      maximalItemCount: 2,
    });

    let xIsDisposed = false;
    let yIsDisposed = false;
    let zIsDisposed = false;

    cache.set('old', 'X', { dispose: () => (xIsDisposed = true) });
    cache.set('new', 'Y', { dispose: () => (yIsDisposed = true) });
    expect(cache.size()).toBe(2);

    // Mark the item as used to keep it in the cache on reaching the maximal number of items
    cache.get('old');
    cache.set('evenNewer', 'Z', { dispose: () => (zIsDisposed = true) });

    expect(cache.size()).toBe(2);
    expect(cache.get('old')).toBeUndefined();
    expect(xIsDisposed).toBe(true);
    expect(cache.get('new')).toBe('Y');
    expect(yIsDisposed).toBe(false);
    expect(cache.get('evenNewer')).toBe('Z');
    expect(zIsDisposed).toBe(false);
  });

  it('evicts exceeding items by LRU', () => {
    const cache = new Cache<string, string>({
      evictExceedingItemsBy: 'lru',
      maximalItemCount: 2,
    });

    let xIsDisposed = false;
    let yIsDisposed = false;
    let zIsDisposed = false;

    cache.set('old', 'X', { dispose: () => (xIsDisposed = true) });
    cache.set('new', 'Y', { dispose: () => (yIsDisposed = true) });
    expect(cache.size()).toBe(2);

    // Mark the item as used to keep it in the cache on reaching the maximal number of items
    cache.get('old');
    cache.set('evenNewer', 'Z', { dispose: () => (zIsDisposed = true) });

    expect(cache.size()).toBe(2);
    expect(cache.get('old')).toBe('X');
    expect(xIsDisposed).toBe(false);
    expect(cache.get('new')).toBeUndefined();
    expect(yIsDisposed).toBe(true);
    expect(cache.get('evenNewer')).toBe('Z');
    expect(zIsDisposed).toBe(false);
  });

  describe('Cache with TTL', () => {
    let dateNowSpy: jest.SpyInstance<number, []> | undefined;

    beforeEach(() => {
      // Lock Time
      dateNowSpy = jest.spyOn(Date, 'now');
    });

    afterEach(() => {
      // Unlock Time
      if (dateNowSpy) dateNowSpy.mockRestore();
    });

    const createCache = (strategy: CacheStrategy) =>
      new Cache<string, string>({
        defaultTTL: 5000,
        evictExceedingItemsBy: strategy,
        maximalItemCount: 4,
      });

    (['lru', 'age'] as CacheStrategy[]).forEach(strategy => {
      it(`has a working 'peekItem' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        dateNowSpy.mockReturnValueOnce(10000);
        const dispose = jest.fn();
        cache.set('x', 'y', { dispose });
        dateNowSpy.mockReturnValueOnce(14999);
        const expectedItem = {
          dispose,
          expireAfterTimestamp: 15000,
          storageTimestamp: 10000,
          value: 'y',
        };
        expect(cache.peekItem('x')).toEqual(expectedItem);
        expect(dispose).toBeCalledTimes(0);
        dateNowSpy.mockReturnValueOnce(15000);
        expect(cache.peekItem('x')).toEqual(expectedItem);
        expect(dispose).toBeCalledTimes(0);
      });

      it(`has a working 'peek' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        dateNowSpy.mockReturnValueOnce(10000);
        cache.set('x', 'y');
        dateNowSpy.mockReturnValueOnce(14999);
        expect(cache.peek('x')).toEqual('y');
        dateNowSpy.mockReturnValueOnce(15000);
        expect(cache.peek('x')).toEqual('y');
      });

      it(`has a working 'getItem' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        dateNowSpy.mockReturnValue(10000);
        // tslint:disable-next-line: no-empty
        const dispose = jest.fn();
        cache.set('x', 'y', { dispose });
        dateNowSpy.mockReturnValue(14999);
        expect(cache.getItem('x')).toEqual({
          dispose,
          expireAfterTimestamp: 15000,
          storageTimestamp: 10000,
          value: 'y',
        });
        dateNowSpy.mockReturnValue(15000);
        // TTL reached, item should be evicted as side effect
        expect(cache.getItem('x')).toBeUndefined();
        expect(dispose).toBeCalledTimes(1);
        expect(cache.options.cache.get('x')).toBeUndefined();
        expect(cache.getItem('x')).toBeUndefined();
      });

      it(`has a working 'get' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        dateNowSpy.mockReturnValue(10000);
        cache.set('x', 'y');
        dateNowSpy.mockReturnValue(14999);
        expect(cache.get('x')).toBe('y');
        dateNowSpy.mockReturnValue(15000);
        expect(cache.get('x')).toBeUndefined();
      });

      it(`has a working 'expireItems' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        dateNowSpy.mockReturnValue(10000);
        cache.set('a', 'x');
        cache.set('b', 'x');
        cache.set('c', 'x');
        dateNowSpy.mockReturnValue(11000);
        cache.set('d', 'x');
        cache.set('e', 'x');
        dateNowSpy.mockReturnValue(14999);
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('b')).toBe('x');
        expect(cache.peek('c')).toBe('x');
        expect(cache.peek('d')).toBe('x');
        expect(cache.peek('e')).toBe('x');
        dateNowSpy.mockReturnValue(15000);
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('b')).toBe('x');
        expect(cache.peek('c')).toBe('x');
        expect(cache.peek('d')).toBe('x');
        expect(cache.peek('e')).toBe('x');
        cache.evictExpiredItems();
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('b')).toBeUndefined();
        expect(cache.peek('c')).toBeUndefined();
        expect(cache.peek('d')).toBe('x');
        expect(cache.peek('e')).toBe('x');
      });

      it(`has a working 'has' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        cache.set('a', 'x');
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
      });

      it(`has a working 'clear' method with '${strategy}' strategy`, () => {
        const cache = createCache(strategy);
        cache.set('a', 'x');
        cache.set('b', 'x');
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(true);
        cache.set('a', 'x');
        cache.set('b', 'x');
        cache.clear();
        expect(cache.has('a')).toBe(false);
        expect(cache.has('b')).toBe(false);
      });

      it(`can change the TTL of an existing item`, () => {
        const cache = createCache(strategy);
        cache.set('a', 'x');
        cache.setTTL('a', 100, 100);
        expect(cache.peekItem('a').expireAfterTimestamp).toBe(200);
      });
    });
  });
});
