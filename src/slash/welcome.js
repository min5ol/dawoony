// src/slash/welcome.js
export async function run({ event, client }) {
  const text =
    process.env.WELCOME_TEXT;

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text
  });
}