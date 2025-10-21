// src/lambda.js
import serverless from 'serverless-http';
import { app } from './app.js';

// API Gateway(스테이지: default) 기준
export const handler = serverless(app, {
  request: { rawBody: true },
  basePath: '/default'
});