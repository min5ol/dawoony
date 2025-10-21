// src/slash/myid.js
export async function run({ event, client }) {
  const userId = event.source.userId;

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text:
`당신의 USER_ID는 다음과 같습니다:
${userId}`
  });
}