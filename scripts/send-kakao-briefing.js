// Notion "해야할일" DB의 7일 내 일정을 요약해 카카오톡 나에게 보내기로 전송한다.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const KAKAO_ACCESS_TOKEN = process.env.KAKAO_ACCESS_TOKEN;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_REFRESH_TOKEN = process.env.KAKAO_REFRESH_TOKEN;
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;
const BRIEFING_LINK_URL =
  process.env.BRIEFING_LINK_URL ||
  "https://bin7335.github.io/notion-calendar-sync/calendar-f8339e145013756e.ics";

const NOTION_VERSION = "2022-06-28";
const TZ = "Asia/Seoul";
const windowDays = Number(process.env.BRIEFING_DAYS || "7");

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("NOTION_TOKEN, NOTION_DATABASE_ID 환경변수가 필요합니다.");
  process.exit(1);
}

if (!KAKAO_ACCESS_TOKEN && !(KAKAO_REST_API_KEY && KAKAO_REFRESH_TOKEN)) {
  console.error(
    "KAKAO_ACCESS_TOKEN 또는 KAKAO_REST_API_KEY+KAKAO_REFRESH_TOKEN 환경변수가 필요합니다."
  );
  process.exit(1);
}

function kstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMd(isoDate) {
  const [, , month, day] = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return `${month}/${day}`;
}

function formatDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    weekday: "short",
  }).format(date);
  return `${formatMd(isoDate)}(${weekday})`;
}

function shortDateRange(item) {
  const start = formatDay(item.startDate);
  if (item.endDate && item.endDate !== item.startDate) {
    return `${start}~${formatDay(item.endDate)}`;
  }
  return start;
}

function compactTitle(title, maxLength = 24) {
  return truncate(title.replace(/\s+/g, " ").trim(), maxLength);
}

function getTitle(prop) {
  return prop?.title?.map((part) => part.plain_text).join("").trim() || "(제목 없음)";
}

function getText(prop) {
  return prop?.rich_text?.map((part) => part.plain_text).join("").trim() || "";
}

function getDateWindow(dateProp) {
  if (!dateProp?.start) return null;
  const startDate = dateProp.start.slice(0, 10);
  const endDate = dateProp.end ? dateProp.end.slice(0, 10) : startDate;
  return { startDate, endDate };
}

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
          page_size: 100,
          start_cursor: cursor,
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
      const text = await res.text();
      throw new Error(`Notion API 오류 (${res.status}): ${text}`);
    }

    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

function normalizeItems(pages, startDate, endDate) {
  const items = [];

  for (const page of pages) {
    const props = page.properties;
    const title = getTitle(props["Task To Do"]);
    const location = getText(props["장소"]);
    const note = getText(props["비고"]);
    const dateWindow = getDateWindow(props["날짜"]?.date) || getDateWindow(props["데드라인"]?.date);
    if (!dateWindow) continue;
    if (dateWindow.startDate > endDate || dateWindow.endDate < startDate) continue;

    items.push({
      id: page.id,
      title,
      location,
      note,
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
    });
  }

  items.sort((a, b) => {
    const byDate = a.startDate.localeCompare(b.startDate);
    if (byDate) return byDate;
    return a.title.localeCompare(b.title, "ko");
  });

  return items;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildBriefing(items, startDate, endDate) {
  const todayItems = items.filter((item) => item.startDate <= startDate && item.endDate >= startDate);
  const upcomingItems = items.filter((item) => !(item.startDate <= startDate && item.endDate >= startDate));
  const missingLocation = items.filter(
    (item) => !item.location && /출장|검진|회의|연수|심사/.test(item.title)
  );

  const lines = [`[7일 일정] ${formatDay(startDate)}-${formatDay(endDate)}`];

  if (todayItems.length) {
    lines.push(`오늘 ${todayItems.length}건`);
    lines.push(...todayItems.slice(0, 2).map((item) => `- ${compactTitle(item.title, 28)}`));
  } else {
    lines.push("오늘 일정 없음");
  }

  if (upcomingItems.length) {
    lines.push(`예정 ${upcomingItems.length}건`);
    lines.push(
      ...upcomingItems
        .slice(0, 3)
        .map((item) => `- ${shortDateRange(item)} ${compactTitle(item.title, 20)}`)
    );
  }

  if (missingLocation.length) lines.push(`확인: 장소 미입력 ${missingLocation.length}건`);

  return truncate(lines.join("\n"), 200);
}

function buildMarkdown(items, startDate, endDate, text) {
  const todayItems = items.filter((item) => item.startDate <= startDate && item.endDate >= startDate);
  const upcomingItems = items.filter((item) => !(item.startDate <= startDate && item.endDate >= startDate));
  const missingLocation = items.filter(
    (item) => !item.location && /출장|검진|회의|연수|심사/.test(item.title)
  );
  const lines = [
    `# ${formatDay(startDate)} 아침 일정 브리핑`,
    "",
    `- 범위: ${formatDay(startDate)} ~ ${formatDay(endDate)}`,
    `- 총 ${items.length}건`,
    `- 오늘 ${todayItems.length}건 / 예정 ${upcomingItems.length}건`,
    `- 확인 필요 ${missingLocation.length}건`,
    "",
    "## 카카오톡 전송문",
    "",
    "```text",
    text,
    "```",
    "",
    "## 오늘",
    "",
  ];

  if (!todayItems.length) {
    lines.push("- 오늘 일정 없음");
  } else {
    for (const item of todayItems) {
      const where = item.location ? ` — ${item.location}` : "";
      lines.push(`- ${shortDateRange(item)} ${item.title}${where}`);
    }
  }

  lines.push("");
  lines.push("## 예정");
  lines.push("");

  if (!upcomingItems.length) {
    lines.push("- 예정 일정 없음");
  } else {
    for (const item of upcomingItems) {
      const where = item.location ? ` — ${item.location}` : "";
      lines.push(`- ${shortDateRange(item)} ${item.title}${where}`);
    }
  }

  if (missingLocation.length) {
    lines.push("");
    lines.push("## 확인 필요");
    lines.push("");
    for (const item of missingLocation) {
      lines.push(`- 장소 미입력: ${shortDateRange(item)} ${item.title}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("- source: Notion API");
  lines.push(`- generated_at: ${new Date().toISOString()}`);

  return lines.join("\n");
}

async function getKakaoAccessToken() {
  if (KAKAO_ACCESS_TOKEN) return KAKAO_ACCESS_TOKEN;

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", KAKAO_REST_API_KEY);
  form.set("refresh_token", KAKAO_REFRESH_TOKEN);
  if (KAKAO_CLIENT_SECRET) form.set("client_secret", KAKAO_CLIENT_SECRET);

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Kakao token refresh 오류 (${res.status}): ${JSON.stringify(data)}`);
  }

  if (data.refresh_token) {
    console.warn(
      "Kakao returned a new refresh_token. Update the KAKAO_REFRESH_TOKEN GitHub secret before the old token expires."
    );
  }

  return data.access_token;
}

async function sendKakaoMemo(accessToken, text) {
  const templateObject = {
    object_type: "text",
    text,
    link: {
      web_url: BRIEFING_LINK_URL,
      mobile_web_url: BRIEFING_LINK_URL,
    },
    button_title: "일정 보기",
  };

  const form = new URLSearchParams();
  form.set("template_object", JSON.stringify(templateObject));

  const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: form,
  });

  const data = await res.json();
  if (!res.ok || data.result_code !== 0) {
    throw new Error(`Kakao memo send 오류 (${res.status}): ${JSON.stringify(data)}`);
  }
}

async function main() {
  const startDate = kstDateString();
  const endDate = addDays(startDate, windowDays);
  const pages = await queryAllPages();
  const items = normalizeItems(pages, startDate, endDate);
  const briefing = buildBriefing(items, startDate, endDate);
  const markdown = buildMarkdown(items, startDate, endDate, briefing);

  const outDir = path.resolve(process.cwd(), "docs", "briefings");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${startDate}.md`), markdown, "utf-8");
  await writeFile(path.resolve(process.cwd(), "docs", "latest-briefing.md"), markdown, "utf-8");

  const accessToken = await getKakaoAccessToken();
  await sendKakaoMemo(accessToken, briefing);
  console.log(`카카오톡 일정 브리핑 전송 완료: ${items.length}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
