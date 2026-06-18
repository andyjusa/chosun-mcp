import type { ChosunConfig } from "../config.js";
import { CookieJar } from "./cookie-jar.js";
import { extractInputValues } from "./html.js";
import {
  type AcademicSession,
  buildPatisPayload,
  extractAcademicSession,
  inferCorsGb,
  parsePatisTsv,
  patisContextForService,
  type PatisParsedResponse,
} from "./patis.js";

const PORTAL_ORIGIN = "https://p.chosun.ac.kr";
const SSO_ORIGIN = "https://sso.chosun.ac.kr";
const ACADEMIC_ORIGIN = "https://a.chosun.ac.kr";
const REPORT_ORIGIN = "https://report.chosun.ac.kr";
const COURSE_OFFERINGS_MENU_CD = "8021602000";
const COURSE_OFFERINGS_PROGRAM_ID = "HL_3020308000_V";
const SYLLABUS_REPORT_FILE_PATH = "haksa/sueop/hl05";
const SYLLABUS_REPORT_FILE_NAME = "hl_3020599000_r02_2";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export interface PortalResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
  json?: unknown;
}

export interface AcademicResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
  patis: PatisParsedResponse;
}

export interface GraduationDiagnosis {
  profile: Record<string, string>;
  creditSummary: Record<string, string>[];
  liberalArts: Record<string, string>[];
  multipleMajors: Record<string, string>[];
  multipleMajorRecognitions: Record<string, string>[];
  requiredCourses: Record<string, string>[];
}

export interface CourseOfferingsQuery {
  year: string;
  semester: string;
  corsGb?: string;
  collegeCode?: string;
  departmentCode?: string;
  lectureTypeCode?: string;
  curriculumTypeCode?: string;
  completionTypeCode?: string;
  teamTeachingYn?: string;
  subjectCode?: string;
  dayNightCode?: string;
  closedStatus?: string;
  professorNo?: string;
}

export interface CourseOfferingsResult {
  query: Required<CourseOfferingsQuery>;
  totalRows: number;
  rows: Record<string, string>[];
}

export interface CourseSyllabusRequest {
  year: string;
  semester: string;
  collegeCode: string;
  departmentCode: string;
  subjectCode: string;
  section: string;
  professorNo: string;
  completionTypeCode: string;
  corsGb?: string;
  includeContact?: boolean;
  includeViewData?: boolean;
  maxPages?: number;
}

export interface CourseSyllabusPage {
  pageIndex: number;
  viewDataBytes: number;
  text: string[];
  viewDataBase64?: string;
}

export interface CourseSyllabusResult {
  reportKey: string;
  pageCount: number;
  title: string;
  course: {
    year: string;
    semester: string;
    collegeCode: string;
    departmentCode: string;
    subjectCode: string;
    section: string;
    professorNo: string;
    completionTypeCode: string;
  };
  pages: CourseSyllabusPage[];
}

interface TextResponse {
  url: string;
  response: Response;
  text: string;
}

export class ChosunPortalClient {
  private readonly jar = new CookieJar();
  private loginPromise?: Promise<void>;
  private academicSessionPromise?: Promise<AcademicSession>;
  private academicSession?: AcademicSession;
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

  async serverTime(): Promise<PortalResponse> {
    return this.portalPost("/proc/com.ServerTime.eps");
  }

  async unreadMessageCount(): Promise<PortalResponse> {
    return this.portalPost("/proc/message.MsgUnreadCnt.eps");
  }

  async fixedNotice(): Promise<PortalResponse> {
    return this.portalPost("/chosun/proc/FixedNotice.eps");
  }

  async fixedTimetable(weekChange: number): Promise<PortalResponse> {
    return this.portalPost("/chosun/proc/FixedTimeTable.eps", {
      timeTableWeekChange: String(weekChange),
    });
  }

  async academicPlan(startDt: string, endDt: string): Promise<PortalResponse> {
    return this.portalPost("/chosun/proc/FixedHaksaPlan.eps", {
      startDt,
      endDt,
    });
  }

  async courseOfferings(query: CourseOfferingsQuery): Promise<CourseOfferingsResult> {
    const userInfo = await this.academicUserInfo();
    const params = courseOfferingParams(query, userInfo);
    const response = await this.academicPost("hl_0308000_service", "selectList", params, {
      menuCd: COURSE_OFFERINGS_MENU_CD,
    });
    const rows = response.patis.datasets.ds_out?.rows ?? [];

    return {
      query: {
        year: params.YEAR,
        semester: params.HAKGI_GB,
        corsGb: params.CORS_GB,
        collegeCode: params.DAEHAK_CD,
        departmentCode: params.HAKGWA_CD,
        lectureTypeCode: params.GANGUI_GB,
        curriculumTypeCode: params.GYOGWA_GB,
        completionTypeCode: params.ISU_GB,
        teamTeachingYn: params.TEAM_TEACHING_YN,
        subjectCode: params.GWAMOK_CD,
        dayNightCode: params.JUYA_GB,
        closedStatus: params.PYEGANG_YN,
        professorNo: params.GYOSU_NO,
      },
      totalRows: rows.length,
      rows,
    };
  }

  async courseSyllabus(request: CourseSyllabusRequest): Promise<CourseSyllabusResult> {
    const userInfo = await this.academicUserInfo();
    const printInfo = await this.printInfo();
    const title = `조선대학교 ${request.year}학년도 ${semesterName(request.semester)} 수업계획서(학부)`;
    const form = syllabusReportForm(request, userInfo, printInfo, title);

    await this.requestText(`${ACADEMIC_ORIGIN}/ui/report/clipreport/RedirectReportHTML5CLIP_detach.jsp`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${ACADEMIC_ORIGIN}/patis/system/SsoController.do`,
      },
      followRedirects: true,
    });

    const launch = await this.requestText(`${REPORT_ORIGIN}/LaunchReportHTML5CLIP_detach.jsp`, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: REPORT_ORIGIN,
        referer: `${ACADEMIC_ORIGIN}/ui/report/clipreport/RedirectReportHTML5CLIP_detach.jsp`,
      },
      body: new URLSearchParams(form),
      followRedirects: true,
    });
    const reportKey = /uid':'([^']+)'/.exec(launch.text)?.[1];
    if (!reportKey) {
      throw new Error("Could not find syllabus report key in report launch response.");
    }

    const pageCheck = await this.reportServerPost("pageCheck", {
      reportkey: reportKey,
      s_time: "t950",
      cnt: 1,
    });
    const pages: CourseSyllabusPage[] = [];
    const firstPageView = await this.reportServerPost("DocumentPageView", {
      reportkey: reportKey,
      pageMethod: 0,
      isMakeDocument: true,
    });
    const firstViewDataBase64 = stringValue(getRecord(getRecord(firstPageView)?.resValue)?.viewData);
    let pageCount = numberValue(getRecord(getRecord(pageCheck)?.resValue)?.count) ?? inferSyllabusPageCount(firstViewDataBase64) ?? 0;
    pages.push(decodeSyllabusPage(0, firstViewDataBase64, request.includeViewData === true, request.includeContact === true));

    const requestedPages = request.maxPages ?? 1;
    const maxPages = Math.max(1, Math.min(requestedPages, pageCount || requestedPages, 10));
    for (let pageIndex = 1; pageIndex < maxPages; pageIndex += 1) {
      const pageView = await this.reportServerPost("DocumentPageView", {
        reportkey: reportKey,
        pageMethod: pageIndex,
        isMakeDocument: false,
      });
      const viewDataBase64 = stringValue(getRecord(getRecord(pageView)?.resValue)?.viewData);
      pages.push(decodeSyllabusPage(pageIndex, viewDataBase64, request.includeViewData === true, request.includeContact === true));
    }
    if (pageCount === 0) {
      pageCount = pages.length;
    }

    return {
      reportKey,
      pageCount,
      title,
      course: {
        year: request.year,
        semester: request.semester,
        collegeCode: request.collegeCode,
        departmentCode: request.departmentCode,
        subjectCode: request.subjectCode,
        section: request.section,
        professorNo: request.professorNo,
        completionTypeCode: request.completionTypeCode,
      },
      pages,
    };
  }

  async graduationDiagnosis(): Promise<GraduationDiagnosis> {
    const session = await this.ensureAcademicSession();
    const corsGb = inferCorsGb(session);
    const hakbeon = this.config.id;

    const profileResponse = await this.academicPost("hg_0501000_service", "selectList01", {
      CORS_GB: corsGb,
      HAKBEON: hakbeon,
    });
    const profile = profileResponse.patis.datasets.ds_out?.rows[0] ?? {};
    if (Object.keys(profile).length === 0) {
      throw new Error("Graduation diagnosis profile was empty.");
    }

    const effectiveCorsGb = profile.CORS_GB || corsGb;
    const effectiveHakbeon = profile.HAKBEON || hakbeon;

    const [creditSummary, liberalArts, multipleMajors, requiredCourses] = await Promise.all([
      this.academicPost("hg_0502000_service", "selectTab03List01", {
        CORS_GB: effectiveCorsGb,
        HAKBEON: effectiveHakbeon,
      }),
      this.academicPost("hg_0502000_service", "selectTab04List01", {
        CORS_GB: effectiveCorsGb,
        HAKBEON: effectiveHakbeon,
        GUBUN: "1",
      }),
      this.academicPost("hg_0502000_service", "selectTab05List01", {
        CORS_GB: effectiveCorsGb,
        HAKBEON: effectiveHakbeon,
      }),
      this.academicPost("hg_0502000_service", "selectTab06List01", {
        CORS_GB: effectiveCorsGb,
        HAKBEON: effectiveHakbeon,
        DAEHAK_CD: profile.DAEHAK_CD ?? "",
        HAKGWA_CD: profile.HAKGWA_CD ?? "",
        GB: "2",
      }),
    ]);

    const multipleMajorRows = multipleMajors.patis.datasets.ds_out?.rows ?? [];
    const multipleMajorRecognitions = await this.loadMultipleMajorRecognitions(effectiveCorsGb, effectiveHakbeon, multipleMajorRows);

    return {
      profile,
      creditSummary: creditSummary.patis.datasets.ds_out?.rows ?? [],
      liberalArts: liberalArts.patis.datasets.ds_out?.rows ?? [],
      multipleMajors: multipleMajorRows,
      multipleMajorRecognitions,
      requiredCourses: requiredCourses.patis.datasets.ds_out?.rows ?? [],
    };
  }

  private async login(): Promise<void> {
    this.authenticated = false;

    const loginPage = await this.openLoginPage();
    const inputs = extractInputValues(loginPage.text);
    const lToken = inputs.get("l_token");
    const cToken = inputs.get("c_token");
    const nextChangeSuccess = inputs.get("nextChangeSuccess") || "N";

    if (!lToken || !cToken) {
      throw new Error("Could not find SSO login tokens on the Chosun login page.");
    }

    const body = new URLSearchParams({
      l_token: lToken,
      c_token: cToken,
      user_timezone_offset: "-540",
      nextChangeSuccess,
      user_id: this.config.id,
      user_password: this.config.password,
      otpNum: "",
      cancel_user_id: "",
      cancel_user_password: "",
    });

    const ssoResult = await this.requestText(`${SSO_ORIGIN}/Login.eps`, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: SSO_ORIGIN,
        referer: loginPage.url,
      },
      body,
      followRedirects: true,
    });

    if (ssoResult.url.startsWith(SSO_ORIGIN) || /otpNum|callVerifyTotp|loginFrm/i.test(ssoResult.text)) {
      throw new Error("SSO login did not complete. Check credentials or complete any required OTP flow manually.");
    }

    await this.portalLoginFinalize();
    await this.verifyPortalSession();

    this.authenticated = true;
    this.lastLoginAt = new Date();
  }

  private async openLoginPage(): Promise<TextResponse> {
    const response = await this.requestText(`${PORTAL_ORIGIN}/index.jsp`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      followRedirects: true,
    });

    if (!response.url.startsWith(SSO_ORIGIN)) {
      const fallback = await this.requestText(`${SSO_ORIGIN}/svc/tk/Auth.eps?ac=Y&ifa=N&id=PORTAL&`, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        followRedirects: true,
      });
      return fallback;
    }

    return response;
  }

  private async portalLoginFinalize(): Promise<void> {
    await this.requestText(`${PORTAL_ORIGIN}/proc/Login.eps`, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: PORTAL_ORIGIN,
        referer: `${PORTAL_ORIGIN}/index.jsp`,
      },
      body: new URLSearchParams({
        "com.tomato.portal.contents.redirection.url": "",
      }),
      followRedirects: true,
    });
  }

  private async verifyPortalSession(): Promise<void> {
    const response = await this.requestText(`${PORTAL_ORIGIN}/p/ST/`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${PORTAL_ORIGIN}/`,
      },
      followRedirects: true,
    });

    if (!response.url.startsWith(`${PORTAL_ORIGIN}/p/`) || response.response.status >= 400) {
      throw new Error(`Portal session verification failed with status ${response.response.status}.`);
    }
  }

  private async ensureAcademicSession(): Promise<AcademicSession> {
    if (this.academicSession) {
      return this.academicSession;
    }

    this.academicSessionPromise ??= this.openAcademicSession();
    try {
      this.academicSession = await this.academicSessionPromise;
      return this.academicSession;
    } finally {
      this.academicSessionPromise = undefined;
    }
  }

  private async openAcademicSession(): Promise<AcademicSession> {
    await this.ensureLoggedIn();

    const response = await this.requestText(`${ACADEMIC_ORIGIN}/exsignon/sso/sso_index.jsp`, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${PORTAL_ORIGIN}/`,
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
      followRedirects: true,
    });

    if (!response.url.startsWith(`${ACADEMIC_ORIGIN}/patis/system/SsoController.do`)) {
      throw new Error(`Academic SSO did not reach SsoController. Final URL: ${response.url}`);
    }

    return extractAcademicSession(response.text);
  }

  private async academicPost(
    serviceName: string,
    methodName: string,
    params: Record<string, string>,
    options: { menuCd?: string } = {},
  ): Promise<AcademicResponse> {
    const session = await this.ensureAcademicSession();
    const context = patisContextForService(serviceName);
    const response = await this.requestText(
      `${ACADEMIC_ORIGIN}${session.serviceContextPath}${context}/patis/system/serviceController.do?SN=${encodeURIComponent(serviceName)}&MN=${encodeURIComponent(methodName)}`,
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/json; charset=UTF-8",
          origin: ACADEMIC_ORIGIN,
          referer: `${ACADEMIC_ORIGIN}/patis/system/SsoController.do`,
          "x-requested-with": "XMLHttpRequest",
        },
        body: buildPatisPayload(session, serviceName, methodName, params, options.menuCd ?? params.MENU_CD),
        followRedirects: false,
      },
    );

    if (response.response.status >= 300 && response.response.status < 400) {
      this.academicSession = undefined;
      throw new Error(`Academic request redirected to ${response.response.headers.get("location") ?? "unknown location"}. Session may be expired.`);
    }

    return {
      url: response.url,
      status: response.response.status,
      contentType: response.response.headers.get("content-type") ?? "",
      text: response.text,
      patis: parsePatisTsv(response.text),
    };
  }

  private async academicUserInfo(): Promise<Record<string, string>> {
    const response = await this.academicPost("PatisHaksaLibUtilService", "searchUserInfo", {}, {
      menuCd: COURSE_OFFERINGS_MENU_CD,
    });
    return response.patis.datasets.ds_out?.rows[0] ?? {};
  }

  private async printInfo(): Promise<Record<string, string>> {
    const response = await this.academicPost(
      "PatisUtilsService",
      "selectPrintInfo",
      {
        MENU_CD: COURSE_OFFERINGS_MENU_CD,
        PGM_ID: COURSE_OFFERINGS_PROGRAM_ID,
        OUTLINK_USER_ID: "",
        OUTLINK_USER_ID_GB: "",
      },
      {
        menuCd: COURSE_OFFERINGS_MENU_CD,
      },
    );
    return response.patis.datasets.ds_out?.rows[0] ?? {};
  }

  private async reportServerPost(clipType: string, clipData: Record<string, unknown>): Promise<unknown> {
    const response = await this.requestText(`${REPORT_ORIGIN}/report_server.jsp`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: REPORT_ORIGIN,
        referer: `${REPORT_ORIGIN}/LaunchReportHTML5CLIP_detach.jsp`,
      },
      body: new URLSearchParams({
        ClipType: clipType,
        ClipData: JSON.stringify(clipData),
      }),
      followRedirects: false,
    });

    return parseJson(response.text);
  }

  private async loadMultipleMajorRecognitions(
    corsGb: string,
    hakbeon: string,
    multipleMajors: Record<string, string>[],
  ): Promise<Record<string, string>[]> {
    const rows: Record<string, string>[] = [];

    for (const major of multipleMajors) {
      const majorGb = major.DAJEONGONG_GB;
      const majorHakgwaCd = major.DAJEONGONG_HAKGWA_CD;
      if (!majorGb || !majorHakgwaCd) {
        continue;
      }

      const response = await this.academicPost("hg_0502000_service", "selectTab05List02", {
        CORS_GB: corsGb,
        HAKBEON: hakbeon,
        DAJEONGONG_GB: majorGb,
        DAJEONGONG_HAKGWA_CD: majorHakgwaCd,
      });

      rows.push(...(response.patis.datasets.ds_out?.rows ?? []));
    }

    return rows;
  }

  private async portalPost(path: string, params?: Record<string, string>): Promise<PortalResponse> {
    await this.ensureLoggedIn();

    const response = await this.requestText(`${PORTAL_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: PORTAL_ORIGIN,
        referer: `${PORTAL_ORIGIN}/`,
        "x-requested-with": "XMLHttpRequest",
      },
      body: new URLSearchParams(params ?? {}),
      followRedirects: false,
    });

    if (response.response.status >= 300 && response.response.status < 400) {
      this.authenticated = false;
      throw new Error(`Portal request redirected to ${response.response.headers.get("location") ?? "unknown location"}. Session may be expired.`);
    }

    return {
      url: response.url,
      status: response.response.status,
      contentType: response.response.headers.get("content-type") ?? "",
      text: response.text,
      json: parseJson(response.text),
    };
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
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function courseOfferingParams(query: CourseOfferingsQuery, userInfo: Record<string, string>): Record<string, string> {
  const userIdGb = userInfo.USER_ID_GB || "01";

  return {
    YEAR: query.year,
    HAKGI_GB: query.semester,
    CORS_GB: query.corsGb ?? "1",
    DAEHAK_CD: query.collegeCode ?? "",
    HAKGWA_CD: query.departmentCode ?? "",
    GANGUI_GB: query.lectureTypeCode ?? "",
    GYOGWA_GB: query.curriculumTypeCode ?? "",
    ISU_GB: query.completionTypeCode ?? "",
    TEAM_TEACHING_YN: query.teamTeachingYn ?? "0",
    GWAMOK_CD: query.subjectCode ?? "",
    JUYA_GB: query.dayNightCode ?? "",
    PYEGANG_YN: query.closedStatus ?? "2",
    GYOSU_NO: query.professorNo ?? "",
    HAKSAENG_CHK: userIdGb,
    MENU_CD: COURSE_OFFERINGS_MENU_CD,
    USER_ID: userInfo.USER_ID ?? "",
    USER_ID_GB: userIdGb,
  };
}

function syllabusReportForm(
  request: CourseSyllabusRequest,
  userInfo: Record<string, string>,
  printInfo: Record<string, string>,
  title: string,
): Array<[string, string]> {
  const userId = userInfo.USER_ID ?? "";
  const userIdGb = userInfo.USER_ID_GB || "01";
  const corsGb = request.corsGb ?? "1";
  const semester = semesterName(request.semester);
  const printTime = printInfo.PRINT_TIME || formatKoreanTimestamp(new Date());
  const bottomInfo = printInfo.BOTTOM_INFO || `${userId};${COURSE_OFFERINGS_MENU_CD}(hl_3020308000_v);${printTime}`;
  const printSummary = [
    `유저 아이디=${userId}(${userId})`,
    `유저 구분=${userIdGb}(${userIdGb})`,
    `메뉴 코드=${COURSE_OFFERINGS_MENU_CD}(${COURSE_OFFERINGS_MENU_CD})`,
    `대학=${request.collegeCode}(${request.collegeCode})`,
    `학과=${request.departmentCode}(${request.departmentCode})`,
    `연도=${request.year}(${request.year})`,
    `학기=${semester}(${request.semester})`,
    `구분=${corsGb}(${corsGb})`,
    `과목=${request.subjectCode}(${request.subjectCode})`,
    `분반=${request.section}(${request.section})`,
    `교수번호=${request.professorNo}(${request.professorNo})`,
    `이수구분=${request.completionTypeCode}(${request.completionTypeCode})`,
  ].join(", ");

  const entries: Array<[string, string]> = [
    ["FILE_PATH", SYLLABUS_REPORT_FILE_PATH],
    ["FILE_NAME", SYLLABUS_REPORT_FILE_NAME],
    ["ARG0", "0"],
    ["ARG1", userId],
    ["ARG2", userIdGb],
    ["ARG6", "undefined"],
    ["ARG7", userId],
    ["ARG8", userIdGb],
    ["ARG9", COURSE_OFFERINGS_MENU_CD],
    ["ARG10", request.collegeCode],
    ["ARG11", request.departmentCode],
    ["ARG12", request.year],
    ["ARG13", request.semester],
    ["ARG14", corsGb],
    ["ARG15", request.subjectCode],
    ["ARG16", request.section],
    ["ARG17", request.professorNo],
    ["ARG18", request.completionTypeCode],
    ["RESOURCE", "haksa"],
    ["ARG3", `${printInfo.MUNSEO_NO ?? ""}\r\n${printSummary}`],
    ["ARG4", "조선대학교"],
    ["ARG5", bottomInfo],
    ["ARG997", printInfo.USER_IP ?? ""],
    ["ARG998", title],
    ["ARG999", bottomInfo],
  ];

  for (const value of ["true", "false", "true", "true", "true", "true", "true", "true", "true", "false", "false", "false", "false", "false", "kr"]) {
    entries.push(["OPTS", value]);
  }
  entries.push(["OPTS", "100%"]);
  entries.push(["OPTS", "false"]);
  entries.push(["OPTS", "3"]);

  return entries;
}

function decodeSyllabusPage(pageIndex: number, viewDataBase64: string, includeViewData: boolean, includeContact: boolean): CourseSyllabusPage {
  const viewData = viewDataBase64 ? Buffer.from(viewDataBase64, "base64") : Buffer.alloc(0);
  const page: CourseSyllabusPage = {
    pageIndex,
    viewDataBytes: viewData.byteLength,
    text: extractSyllabusText(viewData.toString("utf8"), includeContact),
  };
  if (includeViewData) {
    page.viewDataBase64 = viewDataBase64;
  }
  return page;
}

function inferSyllabusPageCount(viewDataBase64: string): number | undefined {
  if (!viewDataBase64) {
    return undefined;
  }

  const parsed = parseJson(Buffer.from(viewDataBase64, "base64").toString("utf8"));
  const document = getRecord(getRecord(parsed)?.document);
  return numberValue(document?.i);
}

function extractSyllabusText(viewDataJson: string, includeContact: boolean): string[] {
  const parsed = parseJson(viewDataJson);
  const values: string[] = [];
  collectStrings(parsed, values);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeReportText(value, includeContact);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 240) {
      break;
    }
  }

  return result;
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
}

function normalizeReportText(value: string, includeContact: boolean): string {
  let text = decodeReportString(value)
    .replaceAll("<HTMLClose>", "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!text || text.length < 2 || !/[가-힣A-Za-z]/.test(text)) {
    return "";
  }
  if (/,\d+(?:\.\d+)?,\d/.test(text) || /^-?\d+(?:\.\d+)?,/.test(text)) {
    return "";
  }
  if (/^(true|false|null|UTF-8|BR|Font|Size|NanumGothic|Gulim|굴림|나눔고딕|본문\d+|표\d+)$/.test(text)) {
    return "";
  }
  if (!includeContact) {
    text = text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
      .replace(/\b\d{2,3}-\d{3,4}-\d{4}\b/g, "[phone redacted]")
      .replace(/\b\d{7,}\b/g, "[number redacted]");
  }

  return text;
}

function decodeReportString(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

function semesterName(semester: string): string {
  if (semester === "11") {
    return "1학기";
  }
  if (semester === "12") {
    return "하계계절학기";
  }
  if (semester === "21") {
    return "2학기";
  }
  if (semester === "22") {
    return "동계계절학기";
  }
  return semester;
}

function formatKoreanTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}.${month}.${day}. ${hours}:${minutes}:${seconds}`;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}
