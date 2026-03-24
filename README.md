# Backend API Server

A Node.js/Express backend server for the frontend application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the server:
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

## API Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Health check endpoint

## Features

- Express.js server
- CORS enabled
- Environment variable support
- Auto-restart in development with nodemon
- Error handling middleware

## Environment Variables

- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment mode (development/production)
- `CORS_ORIGIN` - Allowed CORS origin

## Project Structure

```
backend/
├── index.js          # Main server file
├── package.json      # Dependencies and scripts
├── .env              # Environment variables
├── .gitignore        # Git ignore file
└── README.md         # This file
```
# pixel_tracks_backend
