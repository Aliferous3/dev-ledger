# Dev Ledger / BODY OF WORK

BODY OF WORK is a developer analytics dashboard that aggregates and visualizes development activity across sources such as Local Git, GitHub, and Vercel.

## Major sections

- **Overview** — activity heatmap, language breakdown, net source growth, and project momentum.
- **Projects** — repository list, Vercel status, and language distribution.
- **Activity** — commit cadence, daily rhythm, and streaks.
- **Code** — language statistics, churn, and cloc metrics.
- **Shipping** — Vercel deployments and production cadence.

## Prerequisites

- [Node.js](https://nodejs.org/) LTS
- npm (bundled with Node.js)
- Git
- (Optional) [Vercel CLI](https://vercel.com/docs/cli) for Vercel integration
- (Optional) [cloc](https://github.com/AlDanial/cloc) for language statistics

## Installation

1. Clone or extract this repository.
2. Run `npm install` from the project root, or simply use the launcher below.

## How to run

Double-click `start-dashboard.bat`, or from a terminal:

```bat
npm install
npm run build
npm start
```

The launcher builds the UI and then starts the server.

## Default local URL

http://localhost:4317

## Configuration

- Set `DEV_PROJECTS_ROOT` to change the scanned project root. On Windows the default is `%USERPROFILE%\Desktop\Projects`.
- Set `VERCEL_TOKEN` to override the Vercel CLI auth file lookup.
- The dashboard reads local Vercel credentials from the Vercel CLI auth file and GitHub credentials from the GitHub CLI (`gh`) login session. No credentials are stored in this repository.

## Security

- Do not commit `.env` files, Vercel auth files, or GitHub tokens.
- This repository reads credentials from local environment variables and CLI credential stores at runtime.
