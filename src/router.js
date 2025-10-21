// src/router.js
import * as Daily from './slash/daily.js';
import * as Admins from './slash/admins.js';
import * as Welcome from './slash/welcome.js';
import * as MyId from './slash/myid.js';
import store from './store/ddb.js';

const PREFIX = '/';

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isAdmin = (uid) => ADMIN_IDS.includes(uid);

export default {
  async handle(event, client) {
    try {
      // 텍스트 메시지 이외는 무시
      if (event.type !== 'message' || event.message.type !== 'text') return;

      const { source, message } = event;
      const groupId = source.groupId || source.roomId || source.userId;
      const userId  = source.userId;
      const text    = (message.text || '').trim();
      const today   = todayKST();

      // 일반 메시지 → "3글자 이상"일 때만 카운트
      if (!text.startsWith(PREFIX)) {
        const cleanText = text.replace(/\s+/g, ''); // 공백 제거 후 길이
        if (cleanText.length >= 3) {
          await ensureProfile(client, groupId, userId);
          await store.incDailyCount(groupId, userId, today);
        }
        return;
      }

      // 슬래시 명령 파싱
      const [rawCmd, ...args] = text.slice(PREFIX.length).split(/\s+/);
      const cmd = (rawCmd || '').toLowerCase();

      try {
        switch (true) {
          case cmd === '마디수': {
            // 관리자만 허용 (무응답 차단)
            if (!isAdmin(userId)) return;
            return Daily.run({ event, client, store, args, today });
          }

          case cmd === '관리자':
          case cmd === '초대':
          case cmd === '인증':
            return Admins.run({ event, client });

          case cmd === '인사':
            return Welcome.run({ event, client });

          case cmd === '내아이디':
          case cmd === 'myid':
            return MyId.run({ event, client });

          //닉변 (실제 멘션 포함)
          case cmd === '닉변': {
            await ensureProfile(client, groupId, userId);
            const me = await store.getUserProfile(groupId, userId);
            const myName = me?.displayName || '알수없음';

            // 멘션 라인과 mentionees 계산
            const { mentionLine, mention } = await buildAdminMentionLine(client, groupId);

            const out =
              `${mentionLine}\n` +
              `<${myName} - 변경닉네임 닉변> 작성해주시고\n` +
              `족보에 댓글 남겨주세요!`;

            return client.replyMessage(event.replyToken, {
              type: 'text',
              text: out.slice(0, 4500),
              ...(mention ? { mention } : {}) // 관리자 없으면 mention 생략
            });
          }

          default:
            return; // 알 수 없는 명령은 묵묵부답
        }
      } catch (innerErr) {
        console.error('[router] command error:', innerErr);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `명령 처리 중 오류가 발생했어요.\n${(innerErr?.message || String(innerErr)).slice(0, 200)}`
        });
      }
    } catch (outerErr) {
      console.error('[router] handle error:', outerErr);
      if (event.replyToken) {
        try {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `시스템 오류가 발생했어요. 잠시 후 다시 시도해 주세요.\n${(outerErr?.message || String(outerErr)).slice(0, 200)}`
          });
        } catch {}
      }
    }
  }
};

async function ensureProfile(client, groupId, userId) {
  const cached = await store.getUserProfile(groupId, userId);
  if (cached?.displayName) return;
  try {
    let p;
    if (groupId?.startsWith('C'))      p = await client.getGroupMemberProfile(groupId, userId);
    else if (groupId?.startsWith('R')) p = await client.getRoomMemberProfile(groupId, userId);
    else                               p = await client.getProfile(userId);
    await store.setUserProfile(groupId, userId, p.displayName);
  } catch {
    await store.setUserProfile(groupId, userId, '알수없음');
  }
}

// 관리자 실제 멘션 라인 "( @a,@b,@c )" + mentionees 인덱스 계산
async function buildAdminMentionLine(client, groupId) {
  // 현재 방/그룹에 존재하는 관리자만 멘션 가능
  const pairs = []; // [{ userId, name }]
  for (const uid of ADMIN_IDS) {
    try {
      let prof;
      if (groupId?.startsWith('C'))      prof = await client.getGroupMemberProfile(groupId, uid);
      else if (groupId?.startsWith('R')) prof = await client.getRoomMemberProfile(groupId, uid);
      else                               prof = await client.getProfile(uid);
      const name = prof?.displayName ? String(prof.displayName) : null;
      if (name) pairs.push({ userId: uid, name });
    } catch {
      // 방에 없는 관리자면 멘션 불가 → 스킵
    }
  }

  if (!pairs.length) {
    return { mentionLine: '(관리자)', mention: undefined };
  }

  // 문자열을 쌓으면서 각 '@name'의 시작 인덱스를 정확히 기록
  let text = '(';
  let idx = 1; // '(' 다음 위치부터 시작
  const mentionees = [];

  // 첫 항목: " @Name"
  text += ` @${pairs[0].name}`;
  mentionees.push({
    index: idx + 1,                          // 공백 하나 건너뛰고 '@' 위치
    length: 1 + pairs[0].name.length,       // '@' + name
    userId: pairs[0].userId
  });
  // idx 진행: ' ' + '@name'
  idx += 1 + (1 + pairs[0].name.length);

  // 이후 항목들: ",@Name"
  for (let i = 1; i < pairs.length; i++) {
    text += `,@${pairs[i].name}`;
    mentionees.push({
      index: idx + 1,                        // ',' 뒤의 '@'
      length: 1 + pairs[i].name.length,
      userId: pairs[i].userId
    });
    idx += 1 + (1 + pairs[i].name.length);   // ',' + '@name'
  }

  text += ' )'; // 닫기 (공백+괄호)

  return { mentionLine: text, mention: { mentionees } };
}

function todayKST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}