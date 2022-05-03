import { useEffect, useRef, useState } from "react";

let currentListener: VoidFunction | undefined;

const MODE_ALL = "all";

const MODE_SUSPENSE = "suspense";

const MODE_ERROR_BOUNDARY = "errorBoundary";

const MODE_NONE = "none";

export type Mode =
  | typeof MODE_ALL
  | typeof MODE_SUSPENSE
  | typeof MODE_ERROR_BOUNDARY
  | typeof MODE_NONE;

/**
 * Use this function to let reatom knows when the host component should update.
 * Let say you have an atom with a lot of properties and you need the component when some of properties are changed, not at all
 */
export type ShouldUpdateFn<T> = (next: T, prev: T) => boolean;

export type MemoResult<T> = T extends Promise<infer R> ? R : T;

export interface Atom<T = any> {
  readonly loading: boolean;
  readonly untrackedData: T;
  error: any;
  data: T;
  set(data: T | ((prev: T) => T)): this;
  reset(): void;
  use: Use<T>;
  listen(listener: VoidFunction): VoidFunction;
}

interface InternalAtom<T = any> extends Atom<T> {
  readonly $$promise: Promise<void> | undefined;
}

/**
 * A memo function that handles data caching and asynchronous data
 */
export interface MemoFunction {
  /**
   * wait until given atom data is ready
   */
  <T>(atom: Atom<T>): MemoResult<T>;
  <T>(factory: () => T): MemoResult<T>;
  <T, P extends any[]>(deps: P, factory: (...args: P) => T): MemoResult<T>;
  <T>(deps: any[], factory: () => T): MemoResult<T>;
}

export interface Use<T> extends Function {
  (mode?: Mode, shouldUpdate?: ShouldUpdateFn<T>): T;
  (shouldUpdate: ShouldUpdateFn<T>): T;
}

type Cache = { value: any; error?: any; deps: any[] };

const isFunction = (value: any): value is Function =>
  typeof value === "function";

const isPromiseLike = (value: any): value is Promise<any> =>
  isFunction(value?.then);

/**
 * create an atom with specified initial data.
 * The initial can be any value or the function that returns initial data
 * @param initial
 * @returns
 */
export default function create<T = any>(
  initial?: T | ((memo: MemoFunction) => T)
): Atom<T> {
  const listeners = new Set<VoidFunction>();
  const cache: Cache[] = [];
  const factory: Function | false = isFunction(initial) && initial;
  let data: any = factory ? undefined : initial;
  let memoIndex = 0;
  // let changeToken = {};
  let loading = false;
  let error: any;
  let refresh: VoidFunction;
  let lastPromise: Promise<void> | undefined;
  let tracking = 0;
  let atom: InternalAtom<T>;

  function track(refresh: VoidFunction | undefined, f: Function) {
    const prevListener = currentListener;
    tracking++;
    try {
      currentListener = refresh;
      return f();
    } finally {
      currentListener = prevListener;
      tracking--;
    }
  }

  const notify = () => listeners.forEach((x) => x());

  function memo(...args: any[]) {
    if (args[0]?.listen && args[0]?.use) {
      const atom: Atom = args[0];
      if (atom.loading) throw (atom as any).$$promise;
      if (atom.error) throw atom.error;
      return atom.data;
    }
    let deps: any[];
    let factory: Function;
    if (isFunction(args[0])) {
      deps = [];
      [factory] = args;
    } else {
      [deps, factory] = args;
    }

    let m = cache[memoIndex];
    track(undefined, () => {
      const shouldUpdate =
        !m ||
        m.deps.length !== deps.length ||
        m.deps.some((x, i) => x !== deps[i]);

      if (shouldUpdate) {
        const value = factory(...deps);
        cache[memoIndex] = m = { value, deps };
        // handle async
        if (isPromiseLike(value)) {
          m.value = undefined;
          // refresh function will handle this
          throw new Promise<void>((resolve) => {
            value.then(
              (r: any) => {
                m.value = r;
                resolve();
              },
              (e: any) => {
                m.error = e;
                resolve();
              }
            );
          });
        }
      }
    });
    if (m.error) throw m.error;
    memoIndex++;
    return m.value;
  }

  refresh = () => {
    const prevDependents = [...listeners];
    loading = false;
    error = undefined;
    lastPromise = undefined;
    listeners.clear();
    if (factory) {
      track(refresh, () => {
        memoIndex = 0;
        try {
          const result = factory(memo);
          if (isPromiseLike(result)) {
            throw new Error(
              "The atom factory result cannot be promise object. Use memo() to handle async data"
            );
          }
          if (result !== data) {
            data = result;
          }
        } catch (e) {
          // handle promise object that is thrown by memo
          if (isPromiseLike(e)) {
            loading = true;
            lastPromise = e;
            e.finally(refresh);
          } else {
            error = e;
          }
        }
      });
    }
    prevDependents.forEach((x) => x());
  };

  const listen = (listener: VoidFunction) => {
    let active = true;
    const wrappedListener = () => {
      if (!active) return;
      listeners.add(wrappedListener);
      listener();
    };
    listeners.add(wrappedListener);
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(wrappedListener);
    };
  };

  const Use: Use<T> = (...args: any[]) => {
    const rerender = useState<any>()[1];
    const activeRef = useRef(true);
    const shouldUpdateRef = useRef<ShouldUpdateFn<T>>();
    let mode: Mode;

    if (isFunction(args[0])) {
      mode = MODE_ALL;
      [shouldUpdateRef.current] = args;
    } else {
      [mode = MODE_ALL, shouldUpdateRef.current] = args;
    }

    activeRef.current = true;
    useEffect(
      () => () => {
        activeRef.current = false;
      },
      []
    );
    useEffect(() => {
      let [prevError, prevLoading, prevData] = [error, loading, data];
      return listen(() => {
        if (!activeRef.current) return;
        if (prevError === error && prevLoading === loading && prevData === data)
          return;
        if (shouldUpdateRef.current && !shouldUpdateRef.current(data, prevData))
          return;
        [prevError, prevLoading, prevData] = [error, loading, data];
        rerender({});
      });
    }, [rerender]);
    if (mode) {
      if (loading && (mode === MODE_SUSPENSE || mode === MODE_ALL))
        throw lastPromise;
      if (error && (mode === MODE_ERROR_BOUNDARY || mode === MODE_ALL))
        throw error;
    }
    return data;
  };

  function set(value: T | ((prev: T) => T)) {
    try {
      if (isFunction(value)) {
        const fn = value;
        // disable tracking
        value = track(undefined, () => fn(data));
      }
    } catch (e) {
      error = e;
      notify();
      return atom;
    }

    if (value === data) return atom;
    // changeToken = {};
    data = value;
    refresh();
    return atom;
  }

  function addDependant() {
    if (!currentListener) return;
    if (tracking) throw new Error("Circular dependencies");
    listeners.add(currentListener);
  }

  refresh();

  atom = {
    get loading() {
      addDependant();
      return loading;
    },
    get error() {
      addDependant();
      return error;
    },
    set error(e: any) {
      if (e !== error) {
        error = e;
        notify();
      }
    },
    get data(): T {
      addDependant();
      return data;
    },
    set data(value: T) {
      set(value);
    },
    get untrackedData() {
      return data;
    },
    set,
    use: Use,
    listen,
    reset() {
      if (factory) {
        refresh();
      } else {
        set(initial as T);
      }
    },
    get $$promise() {
      return lastPromise;
    },
  };

  return atom;
}
