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
 * Use this function to let reatomic knows when the host component should update.
 * Let say you have an atom with a lot of properties and you need the component when some of properties are changed, not at all
 */
export type ShouldUpdateFn<T> = (next: T, prev: T) => boolean;

export type ReadResult<T> = T extends Promise<infer R> ? R : T;

export interface Options<T> {
  /**
   * hydrate data from external source (SSR/localStorage)
   */
  hydrate?: () => [true, T] | [false, undefined];
  /**
   * dehydrate callback will be called whenever data changed
   */
  dehydrate?: (data: T) => void;
}

export interface Atom<T = any> {
  readonly loading: boolean;
  /**
   * get data without tracking
   * ```js
   * const counter = atom(0);
   * const doubleCounter = atom(() => {
   *  // this is TRACKED data
   *  // the doubleCounter atom will update when counter changed
   *  return counter.data * 2;
   * });
   *
   * const trippleCounter = atom(() => {
   *  // this is UNTRACKED data
   *  // the doubleCounter atom will NOT update when counter changed
   *  return counter.untrackedData * 3;
   * }
   * ```
   */
  readonly untrackedData: T;
  /**
   * get/set error of the atom
   */
  error: any;
  /**
   * get current data of the atom
   */
  data: T;
  /**
   * change the atom data
   * @param input
   */
  set(input: T | ((prev: T) => T)): this;
  reset(): void;
  /**
   * bind the atom to the current react component
   */
  use: Use<T>;
  /**
   * listen atom data change event
   * @param listener
   */
  listen(listener: VoidFunction): VoidFunction;
}

interface InternalAtom<T = any> extends Atom<T> {
  readonly $$promise: Promise<void> | undefined;
}

/**
 * A read function that handles data caching and asynchronous data
 */
export interface ReadFunction {
  /**
   * wait until given atom data is ready
   */
  <T>(atom: Atom<T>): ReadResult<T>;
  <T>(factory: () => T): ReadResult<T>;
  <T, P extends any[]>(deps: P, factory: (...args: P) => T): ReadResult<T>;
  <T>(deps: any[], factory: () => T): ReadResult<T>;
}

export interface Use<T> extends Function {
  (mode?: Mode, shouldUpdate?: ShouldUpdateFn<T>): T;
  (shouldUpdate: ShouldUpdateFn<T>): T;
}

type Cache = { value: any; error?: any; deps: any[] };

const isFunc = (value: any): value is Function => typeof value === "function";

const isPromiseLike = (value: any): value is Promise<any> =>
  isFunc(value?.then);

/**
 * create an atom with specified initial data.
 * The initial can be any value or the function that returns initial data
 * @param initial
 * @returns
 */
const create = <T = any>(
  initial?: T | ((read: ReadFunction) => T),
  options?: Options<T>
): Atom<T> => {
  const listeners = new Set<VoidFunction>();
  const cache: Cache[] = [];
  const factory: Function | false = isFunc(initial) && initial;
  let data: any = factory ? undefined : initial;
  let hookIndex = 0;
  let changeToken = {};
  let loading = false;
  let error: any;
  let lastPromise: Promise<void> | undefined;
  let tracking = 0;
  let atom: InternalAtom<T>;
  let externalUpdate: VoidFunction;

  const track = (refresh: VoidFunction | undefined, f: Function) => {
    const prevListener = currentListener;
    tracking++;
    try {
      currentListener = refresh;
      return f();
    } finally {
      currentListener = prevListener;
      tracking--;
    }
  };

  const notify = () => listeners.forEach((x) => x());

  const read = (...args: any[]) => {
    if (args[0]?.listen && args[0]?.use) {
      const atom: Atom = args[0];
      if (atom.loading) throw (atom as any).$$promise;
      if (atom.error) throw atom.error;
      return atom.data;
    }
    let deps: any[];
    let factory: Function;
    if (isFunc(args[0])) {
      deps = [];
      [factory] = args;
    } else {
      [deps, factory] = args;
    }

    let m = cache[hookIndex];
    track(undefined, () => {
      const shouldUpdate =
        !m ||
        m.deps.length !== deps.length ||
        m.deps.some((x, i) => x !== deps[i]);

      if (shouldUpdate) {
        const value = factory(...deps);
        cache[hookIndex] = m = { value, deps };
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
    hookIndex++;
    return m.value;
  };

  const update = (internal: boolean) => {
    const prevDependents = [...listeners];
    loading = false;
    error = undefined;
    lastPromise = undefined;
    listeners.clear();
    if (!internal && factory) {
      track(externalUpdate, () => {
        hookIndex = 0;
        try {
          const result = factory(read);
          if (isPromiseLike(result)) {
            throw new Error(
              "The atom factory result cannot be promise object. Use read() to handle async data"
            );
          }
          if (result !== data) {
            data = result;
          }
        } catch (e) {
          // handle promise object that is thrown by read()
          if (isPromiseLike(e)) {
            loading = true;
            lastPromise = e;
            const token = changeToken;
            e.finally(() => {
              // skip refresh if the data has been changed since last time
              if (token !== changeToken) return;
              update(internal);
            });
          } else {
            error = e;
          }
        }
      });
    }
    prevDependents.forEach((x) => x());
  };

  externalUpdate = () => update(false);

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

    if (isFunc(args[0])) {
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
      activeRef.current = true;
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

  const set = (value: T | ((prev: T) => T), hydrating = false) => {
    try {
      if (isFunc(value)) {
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
    changeToken = {};
    data = value;
    !hydrating && options?.dehydrate?.(data);
    update(true);
    return atom;
  };

  const addDependant = () => {
    if (!currentListener) return;
    if (tracking) throw new Error("Circular dependencies");
    listeners.add(currentListener);
  };

  if (options?.hydrate) {
    const [ok, dehydratedData] = options.hydrate();
    if (ok) {
      set(dehydratedData, true);
    } else {
      externalUpdate();
    }
  } else {
    externalUpdate();
  }

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
        externalUpdate();
        options?.dehydrate?.(data);
      } else {
        set(initial as T);
      }
    },
    get $$promise() {
      return lastPromise;
    },
  };

  return atom;
};

export default create;
