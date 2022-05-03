# `reatom`

## Installation

**with NPM**

```bash
npm i reatom --save
``
```

**with YARN**

```bash
yarn add reatom
``
```

## Usages

### Simple atom

```jsx
import atom from "reatom";

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
import atom from "reatom";

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
import atom from "reatom";

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

### Using memo() to handle data caching and asynchronous data

```js
function loadUserProfile(token) {
  // load user profile from server
}

const accessToken = atom(localStorage.getItem("token"));
const userProfile = atom(() => {
  if (!accessToken.data) return { username: "anonymous" };
  const userProfileJson = memo(
    // this memo has one dependencies: accessToken.data
    // once accessToken.data changed, the factory function will be called
    [accessToken.data],
    // the dependencies will be passed to factory as arguments
    // the factory function can return a promise object and memo function will handle that and return resolved value of the promise object
    // when memo is waiting for the promise object, userProfile atom has loading status (userProfile.loading === true)
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

### Asynchronous atom
