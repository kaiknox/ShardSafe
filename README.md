# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
## Usage
The project requires **two separate terminals** to run simultaneously:
```bash
# Terminal 1 – Frontend
npm run dev
# Terminal 2 – Backend
node src/server.js
```
The frontend and the core logic run as separate processes that communicate with each other. This separation is necessary due to significant instability in the libraries available for in-process communication.

## Concept
A **decentralized, fragmented storage system for sensitive files**.
It allows you to build a trusted network of personal devices. When a file is uploaded, it is distributed across all nodes using P2P — fragmented and encrypted — in such a way that only a percentage of the total fragments is needed to fully recover the content.
This means you are not dependent on any single device or server. The P2P architecture enables decentralized communication, and if a node holding part of the data goes offline or is lost, the files can still be reconstructed and remain accessible.
The system makes it **impossible to retrieve data without the app password** (you need at minimum some fragments from other nodes), and makes **every individual node expendable** — if a device is stolen or lost, all uploaded files can still be recovered.

## Features
- Communication is handled via **P2P protocols**. At the start of a session, a random private key is generated (to avoid collisions). You can then add the public keys of other devices in the network to make them known peers.
- Once peers are configured, you can **upload files**, which are fragmented and distributed to the rest of the network.
- The UI shows **all files for which you hold at least one fragment**, and gives you the option to attempt reconstruction. When reconstruction is requested, all known nodes are queried for their fragments — if the minimum number of fragments is available, the file is downloaded and reassembled.

## Technical Details
Every device runs **two concurrent processes**:
- **Emitter**: handles user-initiated actions (upload file, download file, etc.)
- **Receiver**: a passive daemon that listens for incoming messages and responds accordingly (e.g. returning a file fragment when asked, sending acknowledgements, etc.)
In short, the emitter responds to user actions; the receiver serves as a responder to other users' emitters on the network.
### Protocol
Communication uses a custom protocol with the format `id + payload`:
| ID | Direction | Description | Response |
|----|-----------|-------------|---------|
| `1` | Emitter → Receiver | Request a file fragment | `2` — the corresponding key fragment for that file |
| `3` | Emitter → Receiver | Ping to check if a node is active | `4` — ACK |
| `5` | Emitter → Receiver | Send the encrypted file to all devices | *(no response)* |
### Encryption & Key Splitting
Given a file:

It is **encrypted with AES**, producing a ciphertext and a decryption key.
The decryption key is **split using Shamir's Secret Sharing (SSS)** into *n* fragments.
Each device stores:
- A copy of the **encrypted file**
- Its own **fragment of the decryption key**

This way, no single device can decrypt the file alone — a minimum threshold of key fragments from different nodes is required.

## About this project

This project was developed during a **Hackathon**. Due to the time constraints of the event, you might find some bugs or unoptimized code. Contributions and pull requests are welcome!

> **Note:** To connect the devices, please keep in mind that the **public key** you must use is the **first one to appear on terminal**.

## Future Improvements

- [ ] **File deletion:** Add a "delete" button next to each file to remove it directly from local storage.
- [ ] **Persistent sessions:** Make the external key persistent so it is retained when resuming the same session.
- [ ] **Copy public address:** Add a button in the devices section to easily copy your own public address/key for quick sharing.


