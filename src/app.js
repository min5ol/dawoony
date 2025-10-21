// src/app.js
import 'dotenv/config';
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import router from './router.js';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();

// 헬스체크
app.get('/webhook', (req, res) => res.status(200).send('OK'));

// LINE 서명 미들웨어
const lineMw = middleware(config);

// 테스트/운영 겸용: 서명이 없거나 잘못되면 200으로 무시 (500 방지)
app.post(
  '/webhook',
  (req, res, next) => {
    const sig = req.headers['x-line-signature'];
    if (!sig) {
      console.log('[webhook] no x-line-signature, skipping');
      return res.status(200).end();
    }
    return lineMw(req, res, next);
  },
  async (req, res) => {
    try {
      const events = req.body?.events || [];
      await Promise.all(events.map(evt => router.handle(evt, client)));
      res.status(200).end();
    } catch (e) {
      console.error('Webhook error:', e);
      // 서명은 통과했는데 내부 로직에서 실패한 경우만 500
      res.status(500).end();
    }
  }
);

export { app, client };