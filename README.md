# Mac Organinser

A lightweight, native-feeling macOS utility application built with Electron, React, and Vite. 

## Features

- **Developer Cache Cleaner**: One-click cleanup for Docker, NPM, PNPM, and Yarn to quickly free up disk space.
- **Smart Organizer**: Scans a selected folder and automatically groups loose files into categories (Images, Documents, Archives, Audio, Video) based on predefined rules.
- **Duplicate Finder**: Scans a folder to find exact duplicate files by comparing their cryptographic hashes, allowing you to delete duplicates and recover space.

## Tech Stack

- **Frontend**: React + Vite + Vanilla CSS (Glassmorphism design)
- **Backend**: Electron (Node.js)
- **Testing**: Vitest with 100% coverage on core business logic

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Development

To start the app in development mode with hot-reloading:

```bash
npm run dev
npm run start
```

*(Note: Run the Vite dev server first, then start the Electron app in a separate terminal if not configured concurrently).*

### Testing

To run the unit tests and view the coverage report:

```bash
npm run coverage
```
