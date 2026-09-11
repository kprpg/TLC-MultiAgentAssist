# TLC MultiAgent Assist technology stack

## What this is

TLC MultiAgent Assist is a Windows Electron desktop application with a web deployment for account-team intelligence. It combines MSX opportunity context with contextual guidance to help account teams advance opportunities.

## Technology stack

The project is primarily a TypeScript and Node.js application, but it is **not TypeScript-only**, even outside Electron. It also includes React UI code, Vite build tooling, CSS and HTML assets, JavaScript ES modules, PowerShell automation, and JSON configuration and definitions.

### Application platform

- **TypeScript and Node.js** provide the primary application language, runtime, shared contracts, orchestration, connectors, and service code.
- **Electron** provides the Windows desktop shell, including main and preload processes and access to native desktop capabilities.
- **React** provides the renderer user interface.
- **Vite** bundles the desktop renderer and web assets.
- The separate web deployment uses a Node.js HTTP server to host the application.

### Languages and configuration

- **CSS and HTML** define the renderer styling and document structure.
- **JavaScript ES modules** (`.mjs`) support build, packaging, release, and utility scripts.
- **PowerShell** supports Windows and Azure deployment automation.
- **JSON** stores configuration, agent definitions, policies, and scenarios.

### Azure, agents, and UI

- **Azure SDKs**, including `@azure/ai-projects` and `@azure/identity`, integrate Azure services and authentication.
- **Microsoft Foundry agents** supply agent capabilities and contextual assistance.
- **Fluent UI** supplies Microsoft-aligned React components and icons.
- **Zod** provides runtime validation for data contracts and configuration.
- **react-markdown** with the **Unified**, Remark, and Rehype ecosystem renders agent responses safely in the UI.

### Testing and packaging

- **Vitest** runs unit and other automated tests.
- **Playwright** runs end-to-end and Electron smoke tests.
- **electron-builder** packages Windows installers and portable ZIP releases.
