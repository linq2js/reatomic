import { useEffect, useRef, useState } from "react";

const MODE_ALL = "all";
const MODE_SUSPENSE = "suspense";
const MODE_ERROR_BOUNDARY = "errorBoundary";
const MODE_NONE = "none";
const ERROR_RESULT_IS_PROMISE_OBJECT = "The result cannot be promise object";

export type UpdateFn<T = any> = (prev: T) => T;

export type Mode =
  | typeof MODE_ALL
  | typeof MODE_SUSPENSE
  | typeof MODE_ERROR_BOUNDARY
  | typeof MODE_NONE;

export const TYPE_REDUCER = "reducer";
export const TYPE_MUTATION = "mutation";

export type Type = typeof TYPE_REDUCER | typeof TYPE_MUTATION;

/**
 * Use this function to let reatomic knows when the host component should update.
 * Let say you have an atom with a lot of properties and you need the component when some of properties are changed, not at all
 */
export type ShouldUpdateFn<T = any> = (next: T, prev: T) => boolean;

export type EffectResult<T> = T extends Promise<infer R> ? R : T;

export interface Options {
  load?: () => { data: any } | undefined;
  save?: (data: any) => void;
  updateEffect?: (() => Effect) | Effect;
}

export interface AtomWithReducerOptions extends Omit<Options, "updateEffect"> {}

export interface AtomWithMutatonOptions
  extends Omit<Options, "load" | "save" | "updateEffect"> {}

export interface Effect<T = any> {
  effect(context: Context): T;
}

export interface Action<T extends string = string> {
  type?: T;
}

export interface AnyAction extends Action {
  [key: string]: any;
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

/**
 * Atom for reducer mode
 */
export type AtomWithReducer<T = any, A extends Action = AnyAction> = Omit<
  Atom<T>,
  "set" | "data"
> & {
  readonly data: T;
  /**
   * call an action, this method works like redux store's dispatch method
   * @param action
   */
  call(action: A["type"]): void;
  /**
   * call an action, this method works like redux store's dispatch method
   * @param action
   */
  call(action: A): void;
};

/**
 * Atom for mutation mode
 */
export type AtomWithMutation<T = any, P extends any[] = never, R = any> = Omit<
  Atom<T>,
  "set" | "data"
> & { readonly data: T; call(...args: P): R | undefined };

type InternalAtom = AtomWithReducer &
  Atom & {
    readonly $$promise: Promise<void> | undefined;
  };

type Cache = { value: any; token: any; error?: any; deps: any[] };

export interface Create {
  /**
   * create an atom that can store any data, the atom's initial data is undefined
   */
  (): Atom<any>;

  /**
   * create an atom with data compute function
   */
  <T = any>(computeFn: ComputeFn<T>, options?: Options): Atom<T>;

  /**
   * create an atom with initial data
   */
  <T>(data: T, options?: Options): Atom<T>;

  /**
   * create an atom and indicate initFn is mutation, and disable tracking
   */
  <T = any, TMutation extends (...args: any[]) => any = any>(
    mutation: TMutation,
    type: typeof TYPE_MUTATION,
    options?: AtomWithMutatonOptions
  ): TMutation extends (context: Context, ...args: infer P) => infer R
    ? AtomWithMutation<T, P, R>
    : never;

  /**
   * create an atom and indicate initFn is reducer, and disable tracking
   */
  <T = any, A extends Action = AnyAction>(
    reducer: Reducer<T, A>,
    type: Type,
    options?: AtomWithReducerOptions
  ): AtomWithReducer<T, A>;
}

export interface Context {
  /**
   * AbortController signal, the signal might be undefined because some platforms does not support AbortController (node JS)
   */
  readonly signal: AbortController["signal"] | undefined;

  readonly data?: any;

  readonly refs: any;

  readonly id: any;

  isCancelled(): boolean;

  isStale(): boolean;

  use<T>(effect: Effect<T>): EffectResult<T>;

  use<T>(atom: Atom<T>): EffectResult<T>;

  use<T>(factory: () => T, transient?: boolean): EffectResult<T>;

  use<T, P extends any[]>(deps: P, factory: (...args: P) => T): EffectResult<T>;

  use<T>(deps: any[], factory: () => T, transient?: boolean): EffectResult<T>;

  /**
   * cancel AbortController if any
   */
  cancel(): void;
  onCancel(listener: VoidFunction): this;
}

export type Reducer<T = any, A extends Action = AnyAction> = (
  context: Context,
  prev: T,
  action: A
) => T;

export type ComputeFn<T = any> = (context: Context) => T;

/**
 * check a value is whether function or not
 * @param value
 * @returns
 */
const isFunc = (value: any): value is Function => typeof value === "function";

const isCancellable = (value: any): value is { cancel(): void } =>
  isFunc(value?.cancel);

/**
 * check a value is whether promise or not
 * @param value
 * @returns
 */
const isPromise = (value: any): value is Promise<any> => isFunc(value?.then);

let currentListener: VoidFunction | undefined;

const track = (updateFn: VoidFunction | undefined, f: Function) => {
  const prevListener = currentListener;
  try {
    currentListener = updateFn;
    return f();
  } finally {
    currentListener = prevListener;
  }
};

const isACSupported = typeof AbortController !== "undefined";
const createContext = <T>(
  refs: any,
  cache: Cache[],
  data: T,
  token: {},
  isStale: () => boolean
) => {
  let hookIndex = 0;
  let ac: AbortController | undefined;
  let cancelled = false;
  const cancelListeners: VoidFunction[] = [];

  const context: Context = {
    id: {},
    refs,
    get signal() {
      if (!ac) {
        if (!isACSupported) return undefined;
        ac = new AbortController();
      }
      return ac.signal;
    },
    isCancelled: () => cancelled,
    isStale: () => cancelled || isStale(),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      ac?.abort();
      notify(cancelListeners);
    },
    use(...args: any[]) {
      // is atom
      if (args[0]?.listen && args[0]?.use) {
        const atom: Atom = args[0];
        if (atom.loading) throw (atom as any).$$promise;
        if (atom.error) throw atom.error;
        return atom.data;
      }

      let deps: any[];
      let factory: Function;
      let transient: boolean;

      // is effect
      if (args[0]?.effect) {
        return (args[0] as Effect).effect(context);
      }

      if (isFunc(args[0])) {
        deps = [];
        [factory, transient] = args;
      } else {
        [deps, factory, transient] = args;
      }

      let m = cache[hookIndex];
      track(undefined, () => {
        const shouldUpdate =
          !m ||
          m.deps.length !== deps.length ||
          m.deps.some((x, i) => x !== deps[i]) ||
          // data is changed
          (transient && m.token !== token);

        if (shouldUpdate) {
          const value = factory(...deps);
          cache[hookIndex] = m = { value, deps, token };
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
    onCancel(listener: VoidFunction) {
      cancelListeners.push(listener);
      return this;
    },
    data,
  };

  return context;
};

const UPDATE_ACTION: Action = { type: "@@update" };

const notify = (
  listeners: VoidFunction[] | Set<VoidFunction> | Map<any, VoidFunction>
) => listeners.forEach((x) => x());

/**
 * create an atom with specified initial data.
 * The initial can be any value or the function that returns initial data
 * @param initial
 * @returns
 */
export const atom: Create = (initial?: any, ...args: any[]): any => {
  type Phase = "init" | "update";

  const listeners = new Set<VoidFunction>();
  const cache: Record<string, Cache[]> = {};
  const fn: Function | false = isFunc(initial) && initial;
  const refs: any = {};
  let data: any = fn ? undefined : initial;
  let changeToken = {};
  let loading = false;
  let error: any;
  let lastPromise: Promise<void> | undefined;
  let atom: InternalAtom;
  let lastContext: Context | undefined;
  let lastAction: any;
  let loadedData: any;
  let type: Type | undefined;
  let options: Options | undefined;
  let handleDependencyChange: VoidFunction;

  if (typeof args[0] === "string") {
    [type, options] = [args[0] as Type, args[1]];
  } else {
    options = args[0];
  }

  const { load, save, updateEffect } = options ?? {};
  const defaultAction = type === "mutation" ? undefined : UPDATE_ACTION;
  const update = (
    computeFn: Function | false = fn,
    phase: Phase = "update",
    action = lastAction ?? defaultAction,
    context?: Context
  ) => {
    const prevListeners = [...listeners];
    loading = false;
    error = undefined;
    lastPromise = undefined;
    listeners.clear();
    if (computeFn) {
      track(
        // disable tracking for custom fn type
        type ? undefined : handleDependencyChange,
        () => {
          const token = changeToken;
          try {
            // cancel previous context if any
            lastContext?.cancel();

            if (!context) {
              const at = action?.type ?? "";
              context = createContext(
                refs,
                // organize cache by action name
                cache[at] ?? (cache[at] = []),
                data,
                token,
                () => token !== changeToken
              );
            }

            lastContext = context;
            // trigger update effect if any
            // we only trigger the effect in update phase

            if (phase === "update" && updateEffect) {
              lastContext.use(
                typeof updateEffect === "function"
                  ? updateEffect()
                  : updateEffect
              );
            }

            const result =
              type === TYPE_MUTATION
                ? computeFn(lastContext, action as Action)
                : computeFn(lastContext, data, action as Action);

            if (isPromise(result))
              throw new Error(ERROR_RESULT_IS_PROMISE_OBJECT);
            if (type === TYPE_MUTATION || result !== data) {
              data = result;
              changeToken = {};
              if (phase === "update") save?.(data);
            }
          } catch (e) {
            const ex = e;
            // handle promise object that is thrown by use()
            if (isPromise(ex)) {
              if (isCancellable(ex)) {
                lastContext?.onCancel(() => ex.cancel());
              }
              loading = true;
              lastPromise = ex;
              ex.finally(() => {
                // skip refresh if the data has been changed since last time
                if (token !== changeToken) return;
                update(computeFn, phase, action, context);
              });
            } else {
              error = ex;
            }
          }
        }
      );
    }
    notify(prevListeners);
  };

  handleDependencyChange = () => update();

  const set = (updateFn: UpdateFn | UpdateFn[], phase: Phase = "update") => {
    if (phase === "update" && type) {
      throw new Error(
        "Cannot update atom data directly if the initFn type is reducer/mutation. Use call(action) method instead"
      );
    }
    const fns = typeof updateFn === "function" ? [updateFn] : updateFn;
    update(() => fns.reduce((d, f) => f(d), data), phase);
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
    get data() {
      addDependant();
      return data;
    },
    set data(value) {
      set(() => value);
    },
    get untrackedData() {
      return data;
    },
    get $$promise() {
      return lastPromise;
    },
    call(action) {
      if (typeof action === "string") action = { type: action };
      lastAction = action;
      update(initial, "update", action);
      return atom;
    },
    set(...args: any[]) {
      set(isFunc(args[0]) ? args : () => args[0]);
      return atom;
    },
    use: function Use(...args: any) {
      const rerender = useState<any>()[1];
      const activeRef = useRef(true);
      const shouldUpdateRef = useRef<ShouldUpdateFn>();
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
      if (fn) {
        if (type === TYPE_REDUCER) {
          // reset data to hydrated data
          data = loadedData;
          update(undefined, "init", UPDATE_ACTION);
        } else if (!type) {
          update();
        }
        save?.(data);
      } else {
        set(() => initial);
      }
    },
  };

  // start initializing phase
  if (type !== TYPE_MUTATION) {
    // load data from external source
    if (load) {
      const loaded = load();
      if (loaded) {
        // save loaded data for later use
        loadedData = loaded.data;
        // update data with loadedData
        set(() => loadedData, "init");
      } else {
        // init data as normal way
        update();
      }
    } else {
      update(undefined, "init");
    }
  }

  // unsed var
  options;

  return atom;
};
