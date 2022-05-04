import { useEffect, useRef, useState } from "react";

const MODE_ALL = "all";
const MODE_SUSPENSE = "suspense";
const MODE_ERROR_BOUNDARY = "errorBoundary";
const MODE_NONE = "none";
const ERROR_RESULT_IS_PROMISE_OBJECT = "The result cannot be promise object";

export type UpdateFn<T> = (prev: T) => T;

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

export type EffectResult<T> = T extends Promise<infer R> ? R : T;

export interface Options<T> {
  load?: () => { data: T } | undefined;
  save?: (data: T) => void;
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
  set(...fn: UpdateFn<T>[]): this;
  /**
   * change the atom data
   * @param data
   */
  set(data: T): this;
  reset(): void;
  /**
   * bind the atom to the current react component
   */
  use(mode?: Mode, shouldUpdate?: ShouldUpdateFn<T>): T;
  use(shouldUpdate: ShouldUpdateFn<T>): T;
  /**
   * listen atom data change event
   * @param listener
   */
  listen(listener: VoidFunction): VoidFunction;
}

interface InternalAtom<T = any> extends Atom<T> {
  readonly $$promise: Promise<void> | undefined;
}

type Cache = { value: any; error?: any; deps: any[] };

export interface Context<T> {
  signal: AbortController["signal"] | undefined;
  isCancelled(): boolean;
  isStale(): boolean;
  use<T>(atom: Atom<T>): EffectResult<T>;
  use<T>(factory: () => T): EffectResult<T>;
  use<T, P extends any[]>(deps: P, factory: (...args: P) => T): EffectResult<T>;
  use<T>(deps: any[], factory: () => T): EffectResult<T>;
  data: T | undefined;
  cancel(): void;
}

const isFunc = (value: any): value is Function => typeof value === "function";
const isPromise = (value: any): value is Promise<any> => isFunc(value?.then);
let currentListener: VoidFunction | undefined;

const track = (refresh: VoidFunction | undefined, f: Function) => {
  const prevListener = currentListener;
  try {
    currentListener = refresh;
    return f();
  } finally {
    currentListener = prevListener;
  }
};

const createContext = <T>(
  cache: Cache[],
  data: T,
  isStale: () => boolean
): Context<T> => {
  let hookIndex = 0;
  const ac =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  let cancelled = false;

  return {
    signal: ac?.signal,
    isCancelled: () => cancelled,
    isStale: () => cancelled || isStale(),
    cancel() {
      if (cancelled) return;
      ac?.abort();
      cancelled = true;
    },
    use(...args: any[]) {
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
          if (isPromise(value)) {
            m.value = undefined;
            // refresh function will handle this
            throw new Promise<void>((resolve) => {
              const onSuccess = (r: any) => (m.value = r);
              const onError = (e: any) => (m.error = e);
              value.then(onSuccess, onError).finally(resolve);
            });
          }
        }
      });
      if (m.error) throw m.error;
      hookIndex++;
      return m.value;
    },
    data,
  };
};

const notify = (
  listeners: VoidFunction[] | Set<VoidFunction> | Map<any, VoidFunction>
) => listeners.forEach((x) => x());

/**
 * create an atom with specified initial data.
 * The initial can be any value or the function that returns initial data
 * @param initial
 * @returns
 */
const create = <T = any>(
  initial?: T | ((context: Context<T>) => T),
  options?: Options<T>
): Atom<T> => {
  const listeners = new Set<VoidFunction>();
  const cache: Cache[] = [];
  const factory: Function | false = isFunc(initial) && initial;
  let data: any = factory ? undefined : initial;
  let changeToken = {};
  let loading = false;
  let error: any;
  let lastPromise: Promise<void> | undefined;
  let atom: InternalAtom<T>;
  let lastContext: Context<T> | undefined;

  const update = (fn: Function | false = factory, hydrating = false) => {
    const prevListeners = [...listeners];
    loading = false;
    error = undefined;
    lastPromise = undefined;
    listeners.clear();
    if (fn) {
      track(update, () => {
        try {
          lastContext?.cancel();
          const token = changeToken;
          lastContext = createContext(cache, data, () => token !== changeToken);
          const result = fn(lastContext);
          if (isPromise(result))
            throw new Error(ERROR_RESULT_IS_PROMISE_OBJECT);
          if (result !== data) {
            data = result;
            !hydrating && options?.save?.(data);
          }
        } catch (e) {
          // handle promise object that is thrown by use()
          if (isPromise(e)) {
            loading = true;
            lastPromise = e;
            const token = changeToken;
            e.finally(() => {
              // skip refresh if the data has been changed since last time
              if (token !== changeToken) return;
              update();
            });
          } else {
            error = e;
          }
        }
      });
    }
    notify(prevListeners);
  };

  const set = (updateFn: UpdateFn<T> | UpdateFn<T>[], hydrating = false) => {
    const fns = typeof updateFn === "function" ? [updateFn] : updateFn;
    update(() => fns.reduce((d, f) => f(d), data), hydrating);
  };

  const addDependant = () => currentListener && listeners.add(currentListener);

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
        notify(listeners);
      }
    },
    get data(): T {
      addDependant();
      return data;
    },
    set data(value: T) {
      set(() => value);
    },
    get untrackedData() {
      return data;
    },
    set(...args: any[]) {
      set(typeof args[0] === "function" ? args : () => args[0]);
      return atom;
    },
    use: function Use(...args: any) {
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
        return atom.listen(() => {
          if (!activeRef.current) return;
          if (
            prevError === error &&
            prevLoading === loading &&
            prevData === data
          )
            return;
          if (
            shouldUpdateRef.current &&
            !shouldUpdateRef.current(data, prevData)
          )
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
    },
    listen(listener) {
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
    },
    reset() {
      if (factory) {
        update();
        options?.save?.(data);
      } else {
        set(() => initial as T);
      }
    },
    get $$promise() {
      return lastPromise;
    },
  };

  if (options?.load) {
    const loaded = options.load();
    if (loaded) {
      set(() => loaded.data, true);
    } else {
      update();
    }
  } else {
    update();
  }

  return atom;
};

export default create;
