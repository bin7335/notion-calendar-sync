// Notion "해야할일" DB를 읽어 구글 캘린더가 구독할 수 있는 ICS 파일을 생성한다.
// 완료/보류/안함 체크박스가 켜진 항목은 제외하고, 제목/날짜/장소만 내보낸다.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ICS_FILENAME = process.env.ICS_FILENAME || "calendar.ics";

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("NOTION_TOKEN, NOTION_DATABASE_ID 환경변수가 필요합니다.");
  process.exit(1);
}

const NOTION_VERSION = "2022-06-28";

async function queryAllPages() {
  const results = [];
  let cursor = undefined;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_cursor: cursor,
          page_size: 100,
          filter: {
            and: [
              { property: "완료", checkbox: { equals: false } },
              { property: "보류", checkbox: { equals: false } },
              { property: "안함", checkbox: { equals: false } },
            ],
          },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API 오류 (${res.status}): ${body}`);
    }

    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

function escapeIcsText(text) {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function isDateOnly(isoString) {
  return !isoString.includes("T");
}

function toIcsDateOnly(isoDate) {
  // "2025-12-15" -> "20251215"
  return isoDate.replace(/-/g, "");
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toIcsDateTimeUtc(isoDateTime) {
  // 오프셋이 있는 ISO 문자열을 UTC "Z" 포맷으로 변환
  const d = new Date(isoDateTime);
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildEvent(page) {
  const props = page.properties;
  const title = props["Task To Do"]?.title?.[0]?.plain_text ?? "(제목 없음)";
  const dateProp = props["날짜"]?.date;
  const location = props["장소"]?.rich_text?.[0]?.plain_text ?? "";

  if (!dateProp?.start) return null;

  const lines = [];
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${page.id}@notion-calendar-sync`);
  lines.push(
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`
  );

  if (isDateOnly(dateProp.start)) {
    const start = toIcsDateOnly(dateProp.start);
    const end = toIcsDateOnly(
      dateProp.end ? addDays(dateProp.end, 1) : addDays(dateProp.start, 1)
    );
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    const start = toIcsDateTimeUtc(dateProp.start);
    const end = dateProp.end
      ? toIcsDateTimeUtc(dateProp.end)
      : toIcsDateTimeUtc(
          new Date(new Date(dateProp.start).getTime() + 60 * 60 * 1000).toISOString()
        );
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(title)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push("END:VEVENT");

  return lines.join("\r\n");
}

async function main() {
  const pages = await queryAllPages();
  const events = pages.map(buildEvent).filter(Boolean);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//notion-calendar-sync//KO",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  const outDir = path.resolve(process.cwd(), "docs");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, ICS_FILENAME), ics, "utf-8");

  console.log(`${events.length}개 일정을 docs/${ICS_FILENAME}에 썼습니다.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
