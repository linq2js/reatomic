import { atom, Action } from "./main";
import { debounce, throttle } from "./concurrency";

const delay = <T = unknown>(ms: number = 0, value?: T) =>
  new Promise<T>((resolve) => setTimeout(resolve, ms, value));

test("atom with initial value", () => {
  const counter = atom(0);
  expect(counter.data).toBe(0);
  counter.data++;
  expect(counter.data).toBe(1);
});

test("dynamic atom", () => {
  const counter = atom(1);
  const doubleCount = atom(() => counter.data * 2);
  expect(doubleCount.data).toBe(2);
  counter.data++;
  expect(doubleCount.data).toBe(4);
});

test("async atom", async () => {
  const users = atom(({ use }) => use(() => delay(10, [1, 2, 3])));
  expect(users.loading).toBe(true);
  expect(users.data).toBeUndefined();
  await delay(20);
  expect(users.loading).toBe(false);
  expect(users.data).toEqual([1, 2, 3]);
});

test("use with atom", async () => {
  const attempts = atom(1);
  const token = atom(({ use }) => {
    const a = attempts.data;
    return use([a], () => {
      if (a === 1) return Promise.resolve("valid");
      if (a === 2) return Promise.reject("invalid");
      return Promise.resolve("ok");
    });
  });
  const userProfile = atom(({ use }) => {
    const t = use(token);
    return { token: t };
  });
  expect(userProfile.loading).toBe(true);
  await delay();
  expect(userProfile.loading).toBe(false);
  expect(userProfile.data).toEqual({ token: "valid" });
  attempts.data = 2;
  expect(userProfile.loading).toBe(true);
  await delay();
  expect(userProfile.data).toEqual({ token: "valid" });
  expect(token.error).toBe("invalid");
  expect(userProfile.error).toBe("invalid");
});

test("persist data", async () => {
  let saved = 1;
  const counter = atom(() => 0, {
    load: () => ({ data: saved }),
    save: (data) => (saved = data),
  });
  expect(counter.data).toBe(1);
  counter.data++;
  expect(counter.data).toBe(2);
  expect(saved).toBe(2);
  counter.reset();
  expect(counter.data).toBe(0);
  expect(saved).toBe(0);
});

test("reducer mode", () => {
  type CounterAction = Action<"init" | "increment" | "decrement">;
  const counter = atom((_, data: number = 1, action: CounterAction) => {
    if (action.type === "increment") {
      return data + 1;
    }
    if (action.type === "decrement") {
      return data - 1;
    }
    return data;
  }, "reducer");
  expect(counter.data).toBe(1);
  counter.call("increment");
  expect(counter.data).toBe(2);
  counter.call("decrement");
  expect(counter.data).toBe(1);
  counter.call("decrement");
  expect(counter.data).toBe(0);
  counter.reset();
  expect(counter.data).toBe(1);
});

test("mutation", () => {
  type UpdateUserProfileAction = { type: "update"; payload: any };
  let payload: any;
  const updateUserProfile = atom((_, action: UpdateUserProfileAction) => {
    payload = action.payload;
    return true;
  }, "mutation");
  expect(payload).toBeUndefined();
  updateUserProfile.call({ type: "update", payload: 1 });
  expect(payload).toBe(1);
});

test("debounce", async () => {
  const counter = atom(({ use }) => {
    use(debounce(5));
    return 1;
  }, "mutation");
  expect(counter.data).toBeUndefined();
  counter.call();
  counter.call();
  counter.call();
  await delay(10);
  expect(counter.data).toBe(1);
});

test("debounce", async () => {
  const counter = atom(({ use }) => {
    use(debounce(5));
    return 1;
  }, "mutation");
  expect(counter.data).toBeUndefined();
  counter.call();
  counter.call();
  counter.call();
  await delay(10);
  expect(counter.data).toBe(1);
});

test("throttle", async () => {
  const values = [1, 2];
  const counter = atom(({ use }) => {
    use(throttle(10));
    return values.shift();
  }, "mutation");
  expect(counter.data).toBeUndefined();
  counter.call();
  expect(counter.data).toBe(1);
  counter.call();
  expect(counter.data).toBe(1);
  counter.call();
  expect(counter.data).toBe(1);
  await delay(15);
  expect(counter.data).toBe(1);
  counter.call();
  expect(counter.data).toBe(2);
});

test("updateEffect", async () => {
  const counter = atom(0, { updateEffect: () => debounce(10) });
  expect(counter.data).toBe(0);
  counter.data = 1;
  expect(counter.data).toBe(0);
  counter.data = 2;
  expect(counter.data).toBe(0);
  counter.data = 3;
  expect(counter.data).toBe(0);
  await delay(15);
  expect(counter.data).toBe(3);
});

test("should not call init function if data has been hydrated", async () => {
  let called = false;
  const count = atom(
    (x) => {
      called = true;
      return x.use(async () => {
        await delay(20);
        return 1;
      });
    },
    { load: () => ({ data: 2 }) }
  );
  expect(called).toBeFalsy();
  expect(count.data).toBe(2);
});
