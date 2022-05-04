import atom from "./main";

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
