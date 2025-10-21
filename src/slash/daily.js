// src/slash/daily.js

// 안전한 KST 날짜 포맷
function todayKSTSafe() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()); // YYYY-MM-DD
}

export async function run({ event, client, store, args, today }) {
  const src = event.source;
  const groupId = src.groupId || src.roomId || src.userId;
  const _today = today || todayKSTSafe();

  // 1) 멘션된 유저 우선
  const mentionees = event.message?.mention?.mentionees || [];
  const mentionedUserIds = [...new Set(
    mentionees.map(m => m.userId).filter(Boolean)
  )];

  if (mentionedUserIds.length) {
    const rows = await Promise.all(mentionedUserIds.map(async (uid) => {
      const name = await getOrFetchName(client, groupId, uid, store);
      const cnt  = await store.getDailyCount(groupId, uid, _today);
      return { name, cnt: cnt || 0 };
    }));

    rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const lines = rows.map(r => `- ${r.name}: ${r.cnt}`);
    const text  = `오늘(${_today}) 마디수:\n${lines.join('\n')}`.slice(0, 4500);

    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  // 2) "/마디수 @닉네임"
  const qs = (args || [])
    .filter(a => a.startsWith('@'))
    .map(a => a.slice(1).trim())
    .filter(Boolean);

  if (qs.length) {
    const out = [];

    for (const q of qs) {
      const matches = await store.searchByDisplayName(groupId, q);
      if (!matches.length) {
        out.push(`- "${q}" 해당 없음`);
        continue;
      }

      const top = matches
        .slice(0, 50)
        .map(async ({ userId, displayName }) => {
          const cnt = await store.getDailyCount(groupId, userId, _today);
          return { displayName: displayName || '(알수없음)', cnt: cnt || 0 };
        });

      const resolved = (await Promise.all(top))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'))
        .slice(0, 10);

      resolved.forEach(m => out.push(`- ${m.displayName}: ${m.cnt}`));
      if (matches.length > 10) out.push('... (10명까지만 표시)');
    }

    const text = `오늘(${_today}) 마디수:\n${out.join('\n')}`.slice(0, 4500);
    return client.replyMessage(event.replyToken, { type: 'text', text });
  }

  // 3) 인자 없으면 본인
  const meName = await getOrFetchName(client, groupId, src.userId, store);
  const meCnt  = await store.getDailyCount(groupId, src.userId, _today);

  const tail = '다른 사람은 "/마디수 @닉네임" 으로 확인하세요.';
  const text = `오늘(${_today}) 「${meName}」의 마디수: ${meCnt || 0}\n\n${tail}`.slice(0, 4500);

  return client.replyMessage(event.replyToken, { type: 'text', text });
}

async function getOrFetchName(client, groupId, userId, store) {
  const prof = await store.getUserProfile(groupId, userId);
  if (prof?.displayName) return prof.displayName;
  try {
    let p;
    if (groupId?.startsWith('C'))      p = await client.getGroupMemberProfile(groupId, userId);
    else if (groupId?.startsWith('R')) p = await client.getRoomMemberProfile(groupId, userId);
    else                               p = await client.getProfile(userId);
    await store.setUserProfile(groupId, userId, p.displayName);
    return p.displayName;
  } catch {
    return '알수없음';
  }
}