// src/slash/admins.js
export async function run({ event, client }) {
  const src = event.source;
  const groupId = src.groupId || src.roomId || src.userId;

  const adminIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!adminIds.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '관리자 목록이 비어있어요. 환경변수 ADMIN_USER_IDS를 설정해 주세요.'
    });
  }

  const names = [];
  for (const uid of adminIds) {
    try {
      let p;
      if (groupId?.startsWith('C'))      p = await client.getGroupMemberProfile(groupId, uid);
      else if (groupId?.startsWith('R')) p = await client.getRoomMemberProfile(groupId, uid);
      else                               p = await client.getProfile(uid);
      names.push(p?.displayName ? String(p.displayName) : '관리자');
    } catch {
      names.push('(알수없음)');
    }
  }

  const text =
    'ᰔᩚ 𝙳𝙰𝚆𝙾𝙾𝙽𝚈 ᰔᩚ 방장, 관리자, 인증자는\n' +
    names.join('\n') +
    '\n입니다 !';

  return client.replyMessage(event.replyToken, { type: 'text', text });
}