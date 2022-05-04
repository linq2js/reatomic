# `reatomic`

Minimal React state management

## Installation

**with NPM**

```bash
npm i reatomic --save
```

**with YARN**

```bash
yarn add reatomic
```

## Features

1. Tiny size: ~1K GZipped
2. Extreme fast
3. Fully Typescript supported
4. Asynchronous data supported
5. State dependencies supported
6. Suspense & Error Boundary supported

## Live Demo

https://codesandbox.io/s/reatomic-demo-forked-ydpm9r

## Comparison

| Name                           | Bundle Size (GZipped) | Async Data | State dependencies | Suspense | Error Boundary |
| ------------------------------ | --------------------: | :--------: | :----------------: | :------: | :------------: |
| reatomic                       |                   ~1K |     ✓      |         ✓          |    ✓     |       ✓        |
| nanostores + @nanostores/react |                  2.3K |            |         ✓          |          |                |
| redux + react-redux            |                  2.7K |            |                    |          |                |
| @reatom/core + @reatom/react   |                  3.1K |     ✓      |         ✓          |          |                |
| rtk                            |                   11K |            |                    |          |                |
| effector + effector-react      |                 12.1k |            |                    |          |                |
| mobx + mobx-react-lite         |                 18.5K |            |         ✓          |          |                |
| recoil                         |                   22K |     ✓      |         ✓          |          |                |

## Usages

### Simple atom

```jsx
import atom from "reatomic";

// creating atom with initial data
const counter = atom(0);
// access atom data
console.log(counter.data); // 0
// update atom data
counter.data++;
console.log(counter.data); // 1
```

### Binding atom with react component

```jsx
import atom from "reatomic";

const counter = atom(0);

function increment() {
  counter.data++;
}

function useCounter() {
  return counter.use();
}

const App = () => {
  // bind the atom to react component
  // the component will re-render whenerver atom data changed
  const count = useCounter();
  return <h1 onClick={increment}>{count}</h1>;
};
```

A minimal version of Counter App

```jsx
import atom from "reatomic";
const counter = atom(0);
const App = () => <h1 onClick={() => counter.data++}>{counter.use()}</h1>;
```

### Dynamic atom

A atom can depend on another atoms

```js
const hello = atom("Hello");
const world = atom("World");
// possing a data factory function to create dynamic atom
const greeting = atom(() => `${hello.data} ${world.data}`);
console.log(greeting.data); // Hello World
world.data = "Bill";
console.log(greeting.data); // Hello Bill
hello.data = "Hi";
console.log(greeting.data); // Hi Bill
```

### Using use() to handle data caching and asynchronous data

```js
function loadUserProfile(token) {
  // load user profile from server
}

const accessToken = atom(localStorage.getItem("token"));
const userProfile = atom(() => {
  if (!accessToken.data) return { username: "anonymous" };
  const userProfileJson = use(
    // this use has one dependencies: accessToken.data
    // once accessToken.data changed, the factory function will be called
    [accessToken.data],
    // the dependencies will be passed to factory as arguments
    // the factory function can return a promise object and use function will handle that and return resolved value of the promise object
    // when use() is waiting for the promise object, userProfile atom has loading status (userProfile.loading === true)
    // if the promise is rejected, userProfile atom will retrieve an error (userProfile.error)
    loadUserProfile
  );
  return userProfileJson;
});

// login / switch user action
accessToken.data = "the token which is received from authentication API";

// logout action
accessToken.data = null;
```

### Working with async atom and Suspense

```jsx
const user = atom(({ use }) => {
  // using use() to handle async data
  // no await needed
  // when use() receives promise object, it will throw that promise and the atom object will handle async progress
  // when promise is resolved, the atom factory function will be called again to continue next steps
  const result = use(async () => {
    // load async data
    const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
    const json = await res.json();
    return json;
  });
  return result;
});

const UserDetails = () => {
  const userData = user.use();
  return <div>{JSON.stringify(userData)}</div>;
};

const UserDetailsWithCustomSpinner = () => {
  // passing "none" to disable Suspense and ErrorBoundary support
  // so use() returns atom object
  const { data, loading } = user.use("none");
  if (loading) return "Loading...";
  return <div>{JSON.stringify(data)}</div>;
};

const App = () => {
  return (
    <>
      <Suspense fallback="Loading...">
        <UserDetails />
      </Suspense>
      <UserDetailsWithCustomSpinner />
    </>
  );
};
```
