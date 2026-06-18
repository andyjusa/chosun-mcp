import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { ChosunConfig } from "../config.js";
import { CookieJar } from "./cookie-jar.js";
import { decodeHtmlEntities, htmlToText } from "./html.js";

const CLC_ORIGIN = "https://clc.chosun.ac.kr";
const CLASSCHAT_ORIGIN = "https://classchat.hellolms.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const COURSE_MENU_IDS =
  "'plan','lecture_weeks','zoom','notice','qna','lecture_material','attend','report','project','test','discuss','clicker','survey','eval','grade_appeal','open_material'";

export type ClcCourseContentKind = "lecture_material" | "notice" | "report";

export interface ClcResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
  json?: unknown;
}

export interface ClcCourse {
  kjKey: string;
  auth: string;
  term: string;
  type: "regular" | "non_regular";
  title: string;
  displayCode: string;
  subjectCode: string;
  section: string;
  schedule: string;
  unreadCount?: number;
  isUnread?: boolean;
}

export interface ClcCounters {
  newMessages: number;
  notifications: number;
  todo: number;
}

export interface ClcNotice {
  title: string;
  date: string;
  href: string;
}

export interface ClcEvent {
  category: string;
  title: string;
  dDay: string;
  deadline: string;
  href: string;
}

export interface ClcLink {
  title: string;
  href: string;
}

export interface ClcTextWidget {
  text: string;
  links: ClcLink[];
}

export interface ClcTimetableRow {
  period: string;
  subject: string;
  professor: string;
  room: string;
}

export interface ClcTimetable {
  dateLabel: string;
  rows: ClcTimetableRow[];
}

export interface ClcScheduleDay {
  date: string;
  text: string;
  items: string[];
}

export interface ClcDashboard {
  session: {
    authenticated: boolean;
    cookieCount: number;
    lastLoginAt?: string;
  };
  date: string;
  counts: ClcCounters;
  courses: ClcCourse[];
  communityNotices: ClcNotice[];
  ctlNotices: ClcNotice[];
  todayTimetable: ClcTimetable;
  schedule: ClcScheduleDay;
  newEvents: ClcEvent[];
  widgets?: ClcMainWidgets;
}

export interface ClcMainWidgets {
  date: string;
  quickMenu: ClcTextWidget;
  monthSchedule: ClcTextWidget;
  ocw: ClcTextWidget;
  shareGroups: ClcTextWidget;
  siteLinks: ClcTextWidget;
  importantItems: ClcTextWidget;
}

export interface ClcCourseContext {
  kjKey: string;
  ud: string;
  courseTitle: string;
  courseLabel: string;
}

export interface ClcCourseHome {
  context: ClcCourseContext;
  menuUnreadCounts: ClcCourseMenuUnreadCount[];
  activity: ClcCourseActivity;
  text: string;
}

export interface ClcCourseActivity {
  submitSummary: ClcTextWidget;
  newPosts: ClcTextWidget;
  newComments: ClcTextWidget;
  importantItems: ClcTextWidget;
}

export interface ClcCourseChat {
  context: ClcCourseContext;
  mode: "online" | "offline";
  roomAuth?: unknown;
  chatServer?: unknown;
  form: ClcTextWidget;
  messages: ClcTextWidget;
}

export interface ClcCourseMenuUnreadCount {
  menuId: string;
  articleGroupId: string;
  unreadCount: number;
}

export interface ClcCourseContentListItem {
  kind: ClcCourseContentKind;
  id: string;
  title: string;
  detailUrl: string;
  number: string;
  author: string;
  views?: number;
  date: string;
  contentSeqs: string[];
  status?: string;
  submitted?: boolean;
  submittedLabel?: string;
  score?: string;
  points?: string;
  dueAt?: string;
}

export interface ClcCourseFile {
  contentSeq: string;
  fileSeq: string;
  contentSeqForDownload: string;
  name: string;
  size: string;
  downloadUrl: string;
}

export interface ClcCourseContentDetail {
  context: ClcCourseContext;
  kind: ClcCourseContentKind;
  id: string;
  title: string;
  caption: string;
  fields: Record<string, string>;
  bodyText: string;
  contentSeqs: string[];
  files: ClcCourseFile[];
  commentRequest?: {
    menuSeq: string;
    menuSeq2: string;
    brdId: string;
    commentBrdId: string;
    width: string;
    auth: string;
  };
  commentsText?: string;
}

export interface ClcCourseFileDownloadResult {
  sourceUrl: string;
  finalUrl: string;
  filePath: string;
  fileName: string;
  bytes: number;
  contentType: string;
}

interface TextResponse {
  url: string;
  response: Response;
  text: string;
}

interface BinaryResponse {
  url: string;
  response: Response;
  body: Buffer;
}

interface NormalizedDate {
  yyyymmdd: string;
  year: string;
  month: string;
  day: string;
}

interface CourseUnreadItem {
  kjKey: string;
  auth: string;
  isUnread: boolean;
  unreadCount: number;
}

export class ChosunClcClient {
  private readonly jar = new CookieJar();
  private loginPromise?: Promise<void>;
  private authenticated = false;
  private lastLoginAt?: Date;

  constructor(private readonly config: ChosunConfig) {}

  getSessionInfo(): { authenticated: boolean; cookieCount: number; lastLoginAt?: string } {
    return {
      authenticated: this.authenticated,
      cookieCount: this.jar.count(),
      lastLoginAt: this.lastLoginAt?.toISOString(),
    };
  }

  async ensureLoggedIn(): Promise<void> {
    if (this.authenticated) {
      return;
    }

    this.loginPromise ??= this.login();
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = undefined;
    }
  }

  async dashboard(date?: string): Promise<ClcDashboard> {
    const normalizedDate = normalizeDate(date);
    const main = await this.mainPage();
    const courses = parseCourses(main.text);
    const [counts, unreadItems, ctlNotices, schedule, newEvents] = await Promise.all([
      this.counters(),
      this.courseUnreadItems(courses),
      this.ctlNotices(7),
      this.scheduleDay(normalizedDate.yyyymmdd),
      this.newEvents(5),
    ]);

    return {
      session: this.getSessionInfo(),
      date: normalizedDate.yyyymmdd,
      counts,
      courses: mergeUnreadCounts(courses, unreadItems),
      communityNotices: parseNotices(main.text, 7),
      ctlNotices,
      todayTimetable: parseTodayTimetable(main.text),
      schedule,
      newEvents,
    };
  }

  async courses(includeUnread = true): Promise<ClcCourse[]> {
    const main = await this.mainPage();
    const courses = parseCourses(main.text);
    if (!includeUnread) {
      return courses;
    }

    return mergeUnreadCounts(courses, await this.courseUnreadItems(courses));
  }

  async counters(): Promise<ClcCounters> {
    const [messages, notifications, todo] = await Promise.all([
      this.clcPost("/ilos/message/received_new_message_check.acl"),
      this.clcPost("/ilos/co/notification_count.acl"),
      this.clcPost("/ilos/co/todo_list_count.acl"),
    ]);
    const notificationRoot = getRecord(notifications.json);
    const todoRoot = getRecord(todo.json);

    return {
      newMessages: numberValue(firstRecord(messages.json)?.NEW_MSG_CNT),
      notifications: numberValue(firstRecord(notifications.json)?.CNT ?? getRecord(notificationRoot?.param)?.NOTICE_CNT),
      todo: numberValue(firstRecord(todo.json)?.TODO_N_CNT ?? getRecord(todoRoot?.param)?.TODO_CNT),
    };
  }

  async scheduleDay(date?: string): Promise<ClcScheduleDay> {
    const normalizedDate = normalizeDate(date);
    const response = await this.clcPost("/ilos/main/main_schedule_view.acl", {
      viewDt: normalizedDate.yyyymmdd,
    });
    const text = htmlToText(response.text);
    const items = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== "등록된 일정이 없습니다.");

    return {
      date: normalizedDate.yyyymmdd,
      text,
      items,
    };
  }

  async ctlNotices(limit = 10): Promise<ClcNotice[]> {
    const response = await this.clcPost("/ilos/main/main_ctl_notice_list.acl");
    return parseNotices(response.text, limit);
  }

  async communityNotices(limit = 10): Promise<ClcNotice[]> {
    const main = await this.mainPage();
    return parseNotices(main.text, limit);
  }

  async newEvents(display = 5): Promise<ClcEvent[]> {
    const response = await this.clcPost("/ilos/main/new_event_list.acl", {
      start: "1",
      display: String(display),
    });
    return parseEvents(response.text, display);
  }

  async mainWidgets(date?: string, display = 5): Promise<ClcMainWidgets> {
    const normalizedDate = normalizeDate(date);
    const [quickMenu, monthSchedule, ocw, shareGroups, siteLinks, importantItems] = await Promise.all([
      this.clcPost("/ilos/main/quick_menu_list.acl"),
      this.clcPost("/ilos/main/main_schedule.acl", {
        year: normalizedDate.year,
        month: normalizedDate.month,
        day: normalizedDate.day,
      }),
      this.clcPost("/ilos/main/ocw_list.acl", { FLAG: "1" }),
      this.clcPost("/ilos/main/share_list.acl", { FLAG: "1" }),
      this.clcPost("/ilos/main/site_link_form.acl"),
      this.clcPost("/ilos/st/main/impt_list.acl", {
        start: "1",
        display: String(display),
      }),
    ]);

    return {
      date: normalizedDate.yyyymmdd,
      quickMenu: parseTextWidget(quickMenu.text),
      monthSchedule: parseTextWidget(monthSchedule.text, 10000),
      ocw: parseTextWidget(ocw.text),
      shareGroups: parseTextWidget(shareGroups.text),
      siteLinks: parseTextWidget(siteLinks.text),
      importantItems: parseTextWidget(importantItems.text),
    };
  }

  async courseHome(kjKey: string): Promise<ClcCourseHome> {
    const { context, html } = await this.openCourse(kjKey);
    return {
      context,
      menuUnreadCounts: await this.courseMenuUnreadCounts(kjKey),
      activity: await this.courseActivity(kjKey),
      text: truncateText(htmlToText(html), 8000),
    };
  }

  async courseActivity(kjKey: string, display = 10): Promise<ClcCourseActivity> {
    const { context } = await this.openCourse(kjKey);
    const [submitSummary, newPosts, newComments, importantItems] = await Promise.all([
      this.clcPost("/ilos/st/course/submain_submit_list.acl"),
      this.clcPost("/ilos/st/course/submain_newreg_list.acl", {
        start: "1",
        display: String(display),
      }),
      this.clcPost("/ilos/st/course/submain_newcmmt_list.acl", {
        start: "1",
        display: String(display),
      }),
      this.clcPost("/ilos/st/course/impt_list.acl", {
        KJKEY: context.kjKey,
        start: "1",
        display: String(Math.min(display, 20)),
      }),
    ]);

    return {
      submitSummary: parseTextWidget(submitSummary.text),
      newPosts: parseTextWidget(newPosts.text),
      newComments: parseTextWidget(newComments.text),
      importantItems: parseTextWidget(importantItems.text),
    };
  }

  async courseMenuUnreadCounts(kjKey: string): Promise<ClcCourseMenuUnreadCount[]> {
    await this.openCourse(kjKey);
    const response = await this.clcPost("/ilos/co/course_unread_menu_cnt_list.acl", {
      MENU_IDS: COURSE_MENU_IDS,
    });
    return parseMenuUnreadCounts(response.json);
  }

  async courseRoomAuth(kjKey: string): Promise<{ context: ClcCourseContext; result: unknown }> {
    const { context } = await this.openCourse(kjKey);
    const response = await this.clcPost("/ilos/co/st_session_room_auth_check.acl", {
      ud: context.ud,
      ky: context.kjKey,
      returnData: "json",
    });
    return {
      context,
      result: response.json ?? response.text,
    };
  }

  async courseChat(kjKey: string, mode: "online" | "offline" = "online"): Promise<ClcCourseChat> {
    const { context } = await this.openCourse(kjKey);
    const [roomAuth, chatServer, form, messages] = await Promise.all([
      this.courseRoomAuth(kjKey),
      this.classChatServerStatus(),
      this.requestText(`${CLC_ORIGIN}/ilos/st/course/chatting_${mode}_form.acl`, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          referer: `${CLC_ORIGIN}/ilos/st/course/submain_form.acl`,
        },
        followRedirects: true,
      }),
      this.clcPost("/ilos/st/course/chatting_list_form.acl"),
    ]);

    return {
      context,
      mode,
      roomAuth: roomAuth.result,
      chatServer,
      form: parseTextWidget(form.text, 6000),
      messages: parseTextWidget(messages.text, 12000),
    };
  }

  async classChatServerStatus(): Promise<unknown> {
    const response = await this.requestText(`${CLASSCHAT_ORIGIN}/chat`, {
      method: "POST",
      headers: {
        accept: "application/json,*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: CLASSCHAT_ORIGIN,
        referer: `${CLC_ORIGIN}/ilos/st/course/chatting_online_form.acl`,
      },
      body: new URLSearchParams({
        encoding: "utf-8",
      }),
      followRedirects: false,
    });

    return parseJson(response.text) ?? response.text;
  }

  async courseContentList(
    kjKey: string,
    kind: ClcCourseContentKind,
    options: { display?: number; start?: number; keyword?: string } = {},
  ): Promise<{ context: ClcCourseContext; kind: ClcCourseContentKind; items: ClcCourseContentListItem[] }> {
    const { context } = await this.openCourse(kjKey);
    const config = courseContentConfig(kind);
    await this.requestText(`${CLC_ORIGIN}${config.listFormPath}`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${CLC_ORIGIN}/ilos/st/course/submain_form.acl`,
      },
      followRedirects: true,
    });
    const response = await this.clcPost(config.listPath, {
      start: listStartValue(options.start),
      display: String(options.display ?? 20),
      SCH_VALUE: options.keyword ?? "",
      ud: context.ud,
      ky: context.kjKey,
    });

    return {
      context,
      kind,
      items: parseCourseContentList(response.text, kind),
    };
  }

  async courseContentDetail(
    kjKey: string,
    kind: ClcCourseContentKind,
    id: string,
    options: { includeFiles?: boolean; includeComments?: boolean } = {},
  ): Promise<ClcCourseContentDetail> {
    const { context } = await this.openCourse(kjKey);
    const config = courseContentConfig(kind);
    const detailUrl = new URL(`${CLC_ORIGIN}${config.viewPath}`);
    detailUrl.searchParams.set(config.idParam, id);
    detailUrl.searchParams.set("SCH_KEY", "");
    detailUrl.searchParams.set("SCH_VALUE", "");
    detailUrl.searchParams.set("display", "1");
    detailUrl.searchParams.set("start", "1");

    const response = await this.requestText(detailUrl.href, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${CLC_ORIGIN}${config.listFormPath}`,
      },
      followRedirects: true,
    });
    const parsed = parseCourseContentDetail(response.text, context, kind, id);

    if (options.includeFiles ?? true) {
      parsed.files = (
        await Promise.all(
          parsed.contentSeqs.map(async (contentSeq) => {
            const files = await this.courseFiles(context, contentSeq);
            return files;
          }),
        )
      ).flat();
    }

    if ((options.includeComments ?? true) && parsed.commentRequest) {
      const comments = await this.clcPost("/ilos/co/cmmt_list2.acl", {
        KJKEY: context.kjKey,
        MENU_SEQ: parsed.commentRequest.menuSeq,
        MENU_SEQ2: parsed.commentRequest.menuSeq2,
        BRD_ID: parsed.commentRequest.brdId,
        CMMT_BRD_ID: parsed.commentRequest.commentBrdId,
        WIDTH: parsed.commentRequest.width,
        auth: parsed.commentRequest.auth,
      });
      parsed.commentsText = truncateText(htmlToText(comments.text), 6000);
    }

    return parsed;
  }

  async downloadCourseFile(downloadUrl: string, outputPath?: string): Promise<ClcCourseFileDownloadResult> {
    await this.ensureLoggedIn();
    const url = new URL(downloadUrl, CLC_ORIGIN);
    if (url.origin !== CLC_ORIGIN || !["/ilos/co/efile_download.acl", "/ilos/co/file_download_v2.acl"].includes(url.pathname)) {
      throw new Error("Only clc.chosun.ac.kr e-Class file download URLs are supported.");
    }

    const response = await this.requestBinary(url.href, {
      method: "GET",
      headers: {
        accept: "application/octet-stream,*/*;q=0.8",
        referer: `${CLC_ORIGIN}/ilos/st/course/submain_form.acl`,
      },
      followRedirects: true,
    });
    if (response.response.status >= 400) {
      throw new Error(`CLC file download failed with status ${response.response.status}.`);
    }

    const fileName = safeFileName(filenameFromHeaders(response.response.headers) ?? filenameFromUrl(response.url));
    const filePath = scopedOutputPath(outputPath, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, response.body);

    return {
      sourceUrl: url.href,
      finalUrl: response.url,
      filePath,
      fileName,
      bytes: response.body.byteLength,
      contentType: response.response.headers.get("content-type") ?? "",
    };
  }

  private async login(): Promise<void> {
    this.authenticated = false;

    await this.requestText(`${CLC_ORIGIN}/ilos/main/member/login_form.acl`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      followRedirects: true,
    });

    await this.requestText(`${CLC_ORIGIN}/ilos/lo/login.acl`, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: CLC_ORIGIN,
        referer: `${CLC_ORIGIN}/ilos/main/member/login_form.acl`,
      },
      body: new URLSearchParams({
        returnURL: "",
        class: "A",
        usr_id: this.config.id,
        usr_pwd: this.config.password,
        x: "0",
        y: "0",
      }),
      followRedirects: false,
    });

    const main = await this.requestText(`${CLC_ORIGIN}/ilos/lo/login_branch.acl`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${CLC_ORIGIN}/ilos/lo/login.acl`,
      },
      followRedirects: true,
    });

    if (!isLoggedInMainPage(main.text)) {
      throw new Error("CLC login did not reach an authenticated e-Class main page. Check credentials or CLC access permissions.");
    }

    this.authenticated = true;
    this.lastLoginAt = new Date();
  }

  private async mainPage(): Promise<ClcResponse> {
    await this.ensureLoggedIn();

    const response = await this.requestText(`${CLC_ORIGIN}/ilos/main/main_form.acl`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${CLC_ORIGIN}/ilos/main/main_form.acl`,
      },
      followRedirects: true,
    });

    if (!isLoggedInMainPage(response.text)) {
      this.authenticated = false;
      throw new Error("CLC main page did not look authenticated. Session may be expired.");
    }

    return toClcResponse(response);
  }

  private async openCourse(kjKey: string): Promise<{ context: ClcCourseContext; html: string }> {
    await this.ensureLoggedIn();
    const enter = await this.clcPost("/ilos/st/course/eclass_room2.acl", {
      KJKEY: kjKey,
      returnData: "json",
      returnURI: "%2Filos%2Fst%2Fcourse%2Fsubmain_form.acl",
    });
    const enterJson = getRecord(enter.json);
    if (enterJson?.isError === true) {
      throw new Error(stringValue(enterJson.message) || `Could not enter CLC course ${kjKey}.`);
    }

    const response = await this.requestText(`${CLC_ORIGIN}/ilos/st/course/submain_form.acl`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${CLC_ORIGIN}/ilos/main/main_form.acl`,
      },
      followRedirects: true,
    });
    if (!/\/ilos\/st\/course\/submain_form\.acl|course_unread_menu_cnt_list|수강과목/.test(response.text)) {
      throw new Error(`CLC course ${kjKey} submain page did not look authenticated.`);
    }

    return {
      context: parseCourseContext(response.text, kjKey),
      html: response.text,
    };
  }

  private async courseFiles(context: ClcCourseContext, contentSeq: string): Promise<ClcCourseFile[]> {
    const response = await this.clcPost("/ilos/co/efile_list.acl", {
      ud: context.ud,
      ky: context.kjKey,
      pf_st_flag: "2",
      CONTENT_SEQ: contentSeq,
    });
    return parseCourseFiles(response.text, contentSeq);
  }

  private async courseUnreadItems(courses: ClcCourse[]): Promise<CourseUnreadItem[]> {
    const groups = new Map<string, string[]>();
    for (const course of courses) {
      if (!course.kjKey || !course.auth) {
        continue;
      }
      const values = groups.get(course.auth) ?? [];
      values.push(course.kjKey);
      groups.set(course.auth, values);
    }

    const parts: string[] = [];
    for (const auth of ["P", "T", "S", "A"]) {
      const keys = groups.get(auth);
      if (keys && keys.length > 0) {
        parts.push(`${auth}~${keys.join("%2C")}`);
      }
    }
    if (parts.length === 0) {
      return [];
    }

    const response = await this.clcPost("/ilos/co/course_unread_list.acl", {
      chkList: parts.join("%24"),
      _prefix_1: "%24",
      _prefix_2: "~",
      _prefix_3: "%2C",
    });

    return getRecordArray(getRecord(response.json)?.item_list).map((item) => ({
      kjKey: stringValue(item.KJKEY),
      auth: stringValue(item.KJ_AUTH),
      isUnread: stringValue(item.IS_UNREAD).toUpperCase() === "Y",
      unreadCount: numberValue(item.UNREAD_CNT),
    }));
  }

  private async clcPost(path: string, params: Record<string, string> = {}): Promise<ClcResponse> {
    await this.ensureLoggedIn();

    const response = await this.requestText(`${CLC_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: CLC_ORIGIN,
        referer: `${CLC_ORIGIN}/ilos/main/main_form.acl`,
        "x-requested-with": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        ...params,
        encoding: params.encoding ?? "utf-8",
      }),
      followRedirects: false,
    });

    if (response.response.status >= 300 && response.response.status < 400) {
      this.authenticated = false;
      throw new Error(`CLC request redirected to ${response.response.headers.get("location") ?? "unknown location"}. Session may be expired.`);
    }

    return toClcResponse(response);
  }

  private async requestText(url: string, init: RequestInit & { followRedirects: boolean }): Promise<TextResponse> {
    let currentUrl = url;
    let currentInit: RequestInit = { ...init };

    for (let redirectCount = 0; redirectCount <= 12; redirectCount += 1) {
      const response = await this.requestOnce(currentUrl, currentInit);

      if (
        init.followRedirects &&
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get("location")
      ) {
        const nextUrl = new URL(response.headers.get("location") ?? "", currentUrl).href;
        const method = (currentInit.method ?? "GET").toUpperCase();
        const shouldSwitchToGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST");
        currentInit = {
          ...currentInit,
          method: shouldSwitchToGet ? "GET" : currentInit.method,
          body: shouldSwitchToGet ? undefined : currentInit.body,
          headers: {
            ...headersToObject(currentInit.headers),
            referer: currentUrl,
          },
        };
        currentUrl = nextUrl;
        continue;
      }

      return {
        url: currentUrl,
        response,
        text: await decodeResponse(response),
      };
    }

    throw new Error(`Too many redirects while requesting ${url}.`);
  }

  private async requestBinary(url: string, init: RequestInit & { followRedirects: boolean }): Promise<BinaryResponse> {
    let currentUrl = url;
    let currentInit: RequestInit = { ...init };

    for (let redirectCount = 0; redirectCount <= 12; redirectCount += 1) {
      const response = await this.requestOnce(currentUrl, currentInit);

      if (
        init.followRedirects &&
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get("location")
      ) {
        const nextUrl = new URL(response.headers.get("location") ?? "", currentUrl).href;
        const method = (currentInit.method ?? "GET").toUpperCase();
        const shouldSwitchToGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST");
        currentInit = {
          ...currentInit,
          method: shouldSwitchToGet ? "GET" : currentInit.method,
          body: shouldSwitchToGet ? undefined : currentInit.body,
          headers: {
            ...headersToObject(currentInit.headers),
            referer: currentUrl,
          },
        };
        currentUrl = nextUrl;
        continue;
      }

      return {
        url: currentUrl,
        response,
        body: Buffer.from(await response.arrayBuffer()),
      };
    }

    throw new Error(`Too many redirects while requesting ${url}.`);
  }

  private async requestOnce(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      ...headersToObject(init.headers),
    };

    const cookie = this.jar.getHeader(url);
    if (cookie) {
      headers.cookie = cookie;
    }

    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
    });

    this.jar.addFromHeaders(url, response.headers);
    return response;
  }
}

function toClcResponse(response: TextResponse): ClcResponse {
  return {
    url: response.url,
    status: response.response.status,
    contentType: response.response.headers.get("content-type") ?? "",
    text: response.text,
    json: parseJson(response.text),
  };
}

function isLoggedInMainPage(html: string): boolean {
  return /조선대학교 e-Class System/.test(html) && /로그아웃|eclassRoom|course_unread_list/.test(html);
}

function parseCourseContext(html: string, kjKey: string): ClcCourseContext {
  const text = htmlToText(html);
  const ud = /ud\s*:\s*"([^"]+)"/i.exec(html)?.[1] ?? /ud\s*:\s*'([^']+)'/i.exec(html)?.[1] ?? "";
  const courseTitle =
    normalizeWhitespace(/<a\b[^>]*href=["']\/ilos\/st\/course\/submain_form\.acl["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1] ? htmlToText(/<a\b[^>]*href=["']\/ilos\/st\/course\/submain_form\.acl["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1] ?? "") : "") ||
    normalizeWhitespace(/수강과목\s+(.+?)\s+강의계획서/.exec(text)?.[1] ?? "");
  const courseLabel = normalizeWhitespace(/수강과목\s+(.+?)\s+강의계획서/.exec(text)?.[1] ?? courseTitle);

  return {
    kjKey,
    ud,
    courseTitle,
    courseLabel,
  };
}

function parseMenuUnreadCounts(json: unknown): ClcCourseMenuUnreadCount[] {
  return getRecordArray(getRecord(json)?.item_list).map((item) => ({
    menuId: stringValue(item.MENU_ID),
    articleGroupId: stringValue(item.ARTL_GRP_ID),
    unreadCount: numberValue(item.UNREAD_CNT),
  }));
}

function courseContentConfig(kind: ClcCourseContentKind): {
  listFormPath: string;
  listPath: string;
  viewPath: string;
  idParam: string;
} {
  if (kind === "lecture_material") {
    return {
      listFormPath: "/ilos/st/course/lecture_material_list_form.acl",
      listPath: "/ilos/st/course/lecture_material_list.acl",
      viewPath: "/ilos/st/course/lecture_material_view_form.acl",
      idParam: "ARTL_NUM",
    };
  }
  if (kind === "notice") {
    return {
      listFormPath: "/ilos/st/course/notice_list_form.acl",
      listPath: "/ilos/st/course/notice_list.acl",
      viewPath: "/ilos/st/course/notice_view_form.acl",
      idParam: "ARTL_NUM",
    };
  }
  return {
    listFormPath: "/ilos/st/course/report_list_form.acl",
    listPath: "/ilos/st/course/report_list.acl",
    viewPath: "/ilos/st/course/report_view_form.acl",
    idParam: "RT_SEQ",
  };
}

function parseCourseContentList(html: string, kind: ClcCourseContentKind): ClcCourseContentListItem[] {
  const items: ClcCourseContentListItem[] = [];
  const idParam = courseContentConfig(kind).idParam;
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    if (!row.includes(`${idParam}=`) || !/pageMove\(/.test(row)) {
      continue;
    }

    const detailHref = decodeHtmlEntities(/pageMove\('([^']+)'/i.exec(row)?.[1] ?? "");
    const detailUrl = absoluteUrl(detailHref);
    const id = new URL(detailUrl).searchParams.get(idParam) ?? "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? "");
    const title = normalizeWhitespace(
      htmlToText(
        /<div\b[^>]*class=["']subjt_top["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ??
          /<a\b[^>]*class=["']site-link["'][^>]*>[\s\S]*?<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ??
          "",
      ),
    );
    const bottom = /<div\b[^>]*class=["']subjt_bottom["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ?? "";
    const bottomParts = [...bottom.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((match) => normalizeWhitespace(htmlToText(match[1] ?? "")));
    const contentSeqs = uniqueStrings([...row.matchAll(/downloadClick\('([^']+)'\)/gi)].map((match) => match[1] ?? ""));
    const base: ClcCourseContentListItem = {
      kind,
      id,
      title,
      detailUrl,
      number: normalizeWhitespace(htmlToText(cells[0] ?? "")),
      author: bottomParts[0] ?? "",
      views: parseViews(bottomParts.join(" ")),
      date: normalizeWhitespace(htmlToText(cells[cells.length - 1] ?? "")),
      contentSeqs,
    };

    if (kind === "report") {
      base.author = "";
      base.status = normalizeWhitespace(htmlToText(cells[3] ?? ""));
      base.submittedLabel = normalizeWhitespace(htmlToText(cells[4] ?? "")) || getAttribute(cells[4] ?? "", "title") || getAttribute(cells[4] ?? "", "alt") || "";
      base.submitted = /제출/.test(cells[4] ?? "") || /제출/.test(base.submittedLabel);
      base.score = normalizeWhitespace(htmlToText(cells[5] ?? ""));
      base.points = normalizeWhitespace(htmlToText(cells[6] ?? ""));
      base.dueAt = normalizeWhitespace(htmlToText(cells[7] ?? ""));
    }

    if (id && title) {
      items.push(base);
    }
  }

  return items;
}

function parseCourseContentDetail(html: string, context: ClcCourseContext, kind: ClcCourseContentKind, id: string): ClcCourseContentDetail {
  const table = /<table\b[^>]*class=["'][^"']*\bbbsview\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[0] ?? "";
  const caption = normalizeWhitespace(htmlToText(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(table)?.[1] ?? ""));
  const fields: Record<string, string> = {};
  let bodyText = "";

  for (const rowMatch of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const fieldName = normalizeWhitespace(htmlToText(/<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row)?.[1] ?? ""));
    const valueHtml = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1] ?? "";
    if (fieldName) {
      fields[fieldName] = cleanDetailCell(valueHtml);
    } else if (/\btextviewer\b/i.test(row)) {
      bodyText = cleanDetailCell(valueHtml);
    }
  }

  const contentSeqs = uniqueStrings([...html.matchAll(/CONTENT_SEQ\s*:\s*"([^"]+)"/gi)].map((match) => match[1] ?? ""));
  const commentMatch = /cmmtList\("([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"/i.exec(html);
  const title = fields["제목"] ?? "";
  const detail: ClcCourseContentDetail = {
    context,
    kind,
    id,
    title,
    caption,
    fields,
    bodyText,
    contentSeqs,
    files: [],
  };

  if (commentMatch) {
    detail.commentRequest = {
      menuSeq: commentMatch[1] ?? "",
      brdId: commentMatch[2] ?? "",
      commentBrdId: commentMatch[3] ?? "",
      width: commentMatch[4] ?? "660",
      auth: commentMatch[5] ?? "st",
      menuSeq2: commentMatch[6] ?? "",
    };
  }

  return detail;
}

function parseCourseFiles(html: string, fallbackContentSeq: string): ClcCourseFile[] {
  const files: ClcCourseFile[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[2] ?? "");
    if (!href.includes("/ilos/co/efile_download.acl")) {
      continue;
    }
    const url = new URL(href, CLC_ORIGIN);
    const label = normalizeWhitespace(htmlToText(match[3] ?? "")).replace(/^-\s*/, "");
    const labelMatch = /^(.+?)\s*\(([^()]+)\)$/.exec(label);
    files.push({
      contentSeq: fallbackContentSeq,
      fileSeq: url.searchParams.get("FILE_SEQ") ?? "",
      contentSeqForDownload: url.searchParams.get("CONTENT_SEQ") ?? "",
      name: labelMatch?.[1] ?? label,
      size: labelMatch?.[2] ?? "",
      downloadUrl: url.href,
    });
  }
  return files;
}

function parseViews(text: string): number | undefined {
  const match = /조회\s*([\d,]+)/.exec(text);
  if (!match) {
    return undefined;
  }
  return numberValue(match[1]);
}

function cleanDetailCell(html: string): string {
  return normalizeWhitespace(
    htmlToText(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<div\b[^>]*class=["'][^"']*\bimpt\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ")
        .replace(/<div\b[^>]*id=["']tbody_file[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " "),
    ),
  );
}

function listStartValue(start: number | undefined): string {
  if (start === undefined || start <= 1) {
    return "";
  }
  return String(start);
}

function parseCourses(html: string): ClcCourse[] {
  const courses: ClcCourse[] = [];
  const itemPattern =
    /<li\b[^>]*class=["']term_info["'][^>]*>([\s\S]*?)<\/li>|(<em\b[^>]*class=["'][^"']*\bsub_open\b[^"']*["'][^>]*>[\s\S]*?<\/em>\s*<span\b[^>]*>[\s\S]*?<\/span>)/gi;
  let term = "";

  for (const match of html.matchAll(itemPattern)) {
    if (match[1] !== undefined) {
      term = normalizeWhitespace(htmlToText(match[1]));
      continue;
    }

    const block = match[2] ?? "";
    const emMatch = /(<em\b[^>]*>)([\s\S]*?)<\/em>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    if (!emMatch) {
      continue;
    }

    const [, emTag, emInner, scheduleHtml] = emMatch;
    const kjKey = getAttribute(emTag, "kj") ?? /eclassRoom\('([^']+)'\)/.exec(emTag)?.[1] ?? "";
    const auth = getAttribute(emTag, "kj_auth") ?? "";
    const label = normalizeWhitespace(htmlToText(emInner));
    const displayCode = /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? "";
    const title = normalizeWhitespace(label.replace(/\s*\([^)]+\)\s*$/, ""));
    const schedule = normalizeWhitespace(htmlToText(scheduleHtml));
    const [subjectCode, section] = splitDisplayCode(displayCode);

    if (!kjKey || !title) {
      continue;
    }

    courses.push({
      kjKey,
      auth,
      term,
      type: kjKey.startsWith("N") || /\d{4}\.\d{2}\.\d{2}\s*~\s*\d{4}\.\d{2}\.\d{2}/.test(schedule) ? "non_regular" : "regular",
      title,
      displayCode,
      subjectCode,
      section,
      schedule,
    });
  }

  return courses;
}

function mergeUnreadCounts(courses: ClcCourse[], unreadItems: CourseUnreadItem[]): ClcCourse[] {
  const byKey = new Map(unreadItems.map((item) => [item.kjKey, item]));
  return courses.map((course) => {
    const unread = byKey.get(course.kjKey);
    return {
      ...course,
      unreadCount: unread?.unreadCount ?? 0,
      isUnread: unread?.isUnread ?? false,
    };
  });
}

function parseNotices(html: string, limit: number): ClcNotice[] {
  const notices: ClcNotice[] = [];
  const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span\b[^>]*class=(["'])date\4[^>]*>([\s\S]*?)<\/span>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[2] ?? "";
    const title = normalizeWhitespace(htmlToText(match[3] ?? ""));
    const date = normalizeWhitespace(htmlToText(match[5] ?? ""));
    if (!href || !title || !date) {
      continue;
    }

    notices.push({
      title,
      date,
      href: absoluteUrl(href),
    });
    if (notices.length >= limit) {
      break;
    }
  }

  return notices;
}

function parseEvents(html: string, limit: number): ClcEvent[] {
  const events: ClcEvent[] = [];
  const pattern = /<a\b[^>]*class=(["'])[^"']*\bnew_event_a\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const block = match[0];
    const startTag = /<a\b[^>]*>/i.exec(block)?.[0] ?? "";
    const href = getAttribute(startTag, "href") ?? "";
    const title = getAttribute(block, "title") ?? normalizeWhitespace(htmlToText(/<span\b[^>]*class=(["'])link-title\1[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[2] ?? ""));
    const text = normalizeWhitespace(htmlToText(block));
    const category = /\[[^\]]+\]/.exec(text)?.[0] ?? "";
    const dDay = /\bD[-+]?\d+\b|D-Day/i.exec(text)?.[0] ?? "";
    const deadline = /\((\d{4}\.\d{2}\.\d{2})\)/.exec(text)?.[1] ?? "";

    if (!href || !title) {
      continue;
    }

    events.push({
      category,
      title,
      dDay,
      deadline,
      href: absoluteUrl(href),
    });
    if (events.length >= limit) {
      break;
    }
  }

  return events;
}

function parseTextWidget(html: string, maxLength = 6000): ClcTextWidget {
  return {
    text: truncateText(htmlToText(html), maxLength),
    links: parseLinks(html).slice(0, 50),
  };
}

function parseLinks(html: string): ClcLink[] {
  const links: ClcLink[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[2] ?? "");
    if (!href || /^javascript:/i.test(href)) {
      continue;
    }
    const title = normalizeWhitespace(htmlToText(match[3] ?? "")) || getAttribute(match[0], "title") || href;
    const absoluteHref = absoluteUrl(href);
    const key = `${title}\n${absoluteHref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({
      title,
      href: absoluteHref,
    });
  }

  return links;
}

function parseTodayTimetable(html: string): ClcTimetable {
  const dateLabel = normalizeWhitespace(/<span>\s*오늘시간표\s*<\/span>\s*<span\b[^>]*class=(["'])info\1[^>]*>\s*\(([^)]*)\)/i.exec(html)?.[2] ?? "");
  const rows: ClcTimetableRow[] = [];
  const rowPattern =
    /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td\b[^>]*class=(["'])subject\2[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*class=(["'])pf\4[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*class=(["'])last\6[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  for (const match of html.matchAll(rowPattern)) {
    rows.push({
      period: normalizeWhitespace(htmlToText(match[1] ?? "")),
      subject: normalizeWhitespace(htmlToText(match[3] ?? "")),
      professor: normalizeWhitespace(htmlToText(match[5] ?? "")),
      room: normalizeWhitespace(htmlToText(match[7] ?? "")),
    });
  }

  return {
    dateLabel,
    rows,
  };
}

function splitDisplayCode(displayCode: string): [string, string] {
  const match = /^(.+)-([^-]+)$/.exec(displayCode);
  return [match?.[1] ?? displayCode, match?.[2] ?? ""];
}

function normalizeDate(date?: string): NormalizedDate {
  const value = date?.trim();
  if (value) {
    const digits = value.replace(/-/g, "");
    if (!/^\d{8}$/.test(digits)) {
      throw new Error("Date must be YYYYMMDD or YYYY-MM-DD.");
    }
    return {
      yyyymmdd: digits,
      year: digits.slice(0, 4),
      month: digits.slice(4, 6),
      day: digits.slice(6, 8),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return {
    yyyymmdd: `${year}${month}${day}`,
    year,
    month,
    day,
  };
}

function firstRecord(json: unknown): Record<string, unknown> | undefined {
  return getRecordArray(getRecord(json)?.records)[0];
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(getRecord(item))) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function absoluteUrl(href: string): string {
  return new URL(href, CLC_ORIGIN).href;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} characters]`;
}

function filenameFromHeaders(headers: Headers): string | undefined {
  const value = headers.get("content-disposition");
  if (!value) {
    return undefined;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

function filenameFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.searchParams.get("FILE_SEQ") || "clc-download.bin";
}

function safeFileName(fileName: string): string {
  const normalized = fileName.replace(/[\/\\:\0]/g, "_").replace(/\s+/g, " ").trim();
  return normalized || "clc-download.bin";
}

function scopedOutputPath(outputPath: string | undefined, fileName: string): string {
  const workspace = process.cwd();
  const target = outputPath ? resolve(workspace, outputPath) : resolve(workspace, "downloads", "clc", fileName);
  const relativePath = relative(workspace, target);
  if (relativePath === "" || relativePath.startsWith("..") || relativePath.startsWith(`..${sepLike()}`)) {
    throw new Error("Output path must stay inside the current project directory.");
  }
  return target;
}

function sepLike(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function getAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  const value = match?.[2] ?? match?.[3] ?? match?.[4];
  return value === undefined ? undefined : decodeHtmlEntities(value);
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

async function decodeResponse(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "";
  const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.toLowerCase();

  if (charset) {
    return decodeBuffer(buffer, charset);
  }

  const utf8 = decodeBuffer(buffer, "utf-8");
  if (utf8.includes("\uFFFD") || /charset=["']?euc-kr/i.test(utf8)) {
    return decodeBuffer(buffer, "euc-kr");
  }

  return utf8;
}

function decodeBuffer(buffer: ArrayBuffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}
