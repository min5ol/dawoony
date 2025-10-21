// src/store/ddb.js
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  QueryCommand,
  PutItemCommand
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  // DDB 테이블 리전 명시 (없으면 Lambda 리전 사용)
  region: process.env.DDB_REGION || process.env.AWS_REGION || "us-east-1",
});

const TABLE = process.env.TABLE_NAME;
if (!TABLE) throw new Error("Env TABLE_NAME is required (e.g. MadiCounts)");

// YYYY-MM-DD (KST)
function todayKST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Key helpers
const countPk = (groupId, date) => `madi#${groupId}#${date}`;
const countSk = (userId)        => `user#${userId}`;
const profPk  = (groupId)       => `profile#${groupId}`;
const profSk  = (userId)        => `user#${userId}`;

// Query pagination (1MB page size)
async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await client.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    if (res.Items) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export default {
  // === Counts ===
  async incDailyCount(groupId, userId, date) {
    const d = date || todayKST();
    await client.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { pk: { S: countPk(groupId, d) }, sk: { S: countSk(userId) } },
      UpdateExpression: "ADD #c :one",
      ExpressionAttributeNames: { "#c": "count" },
      ExpressionAttributeValues: { ":one": { N: "1" } },
      ReturnValues: "UPDATED_NEW",
    }));
  },

  async getDailyCount(groupId, userId, date) {
    const d = date || todayKST();
    const res = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key: { pk: { S: countPk(groupId, d) }, sk: { S: countSk(userId) } },
      ProjectionExpression: "#c",
      ExpressionAttributeNames: { "#c": "count" },
    }));
    return res.Item?.count?.N ? Number(res.Item.count.N) : 0;
  },

  async getTodayAllCounts(groupId, date) {
    const d = date || todayKST();
    const items = await queryAll({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: countPk(groupId, d) } },
      ProjectionExpression: "sk, #c",
      ExpressionAttributeNames: { "#c": "count" },
    });
    return items.map(it => ({
      userId: it.sk.S.replace(/^user#/, ""),
      count: it.count?.N ? Number(it.count.N) : 0,
    }));
  },

  // === Profile cache ===
  async setUserProfile(groupId, userId, displayName) {
    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: profPk(groupId) },
        sk: { S: profSk(userId) },
        displayName: { S: displayName || "알수없음" },
      },
    }));
  },

  async getUserProfile(groupId, userId) {
    const res = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key: { pk: { S: profPk(groupId) }, sk: { S: profSk(userId) } },
      ProjectionExpression: "displayName",
    }));
    if (!res.Item) return null;
    return { displayName: res.Item.displayName?.S || "알수없음" };
  },

  // === Search by display name (substring, client-side)
  async searchByDisplayName(groupId, query) {
    const q = (query || "").toLowerCase();
    const items = await queryAll({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: profPk(groupId) } },
      ProjectionExpression: "sk, displayName",
    });
    return items
      .map(it => ({
        userId: it.sk.S.replace(/^user#/, ""),
        displayName: it.displayName?.S || "알수없음",
      }))
      .filter(x => (x.displayName || "").toLowerCase().includes(q));
  },
};