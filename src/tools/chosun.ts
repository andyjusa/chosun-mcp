import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
	getChosunClcConfigStatus,
	getChosunOjConfigStatus,
	isChosunClcEnabled,
	isChosunOjEnabled,
	loadChosunClcConfig,
	loadChosunConfig,
	loadChosunOjConfig,
} from "../config.js";
import { ChosunClcClient } from "../chosun/clc-client.js";
import {
	ChosunPortalClient,
	type CourseSyllabusPage,
	type GraduationDiagnosis,
	type PortalResponse,
} from "../chosun/client.js";
import { htmlToText } from "../chosun/html.js";
import { ChosunOjClient } from "../chosun/oj-client.js";

let client: ChosunPortalClient | undefined;
let clcClient: ChosunClcClient | undefined;
let ojClient: ChosunOjClient | undefined;

export function registerChosunTools(server: McpServer): void {
	server.registerTool(
		"chosun_session_status",
		{
			title: "Chosun Session Status",
			description:
				"Log in to the Chosun University portal and report the current MCP session status.",
			inputSchema: {},
		},
		async () => {
			const portal = getClient();
			await portal.ensureLoggedIn();
			return textContent(JSON.stringify(portal.getSessionInfo(), null, 2));
		},
	);

	server.registerTool(
		"chosun_server_time",
		{
			title: "Chosun Server Time",
			description: "Read the Chosun University portal server time.",
			inputSchema: {},
		},
		async () =>
			textContent(
				formatResponse("Server time", await getClient().serverTime()),
			),
	);

	server.registerTool(
		"chosun_unread_messages",
		{
			title: "Chosun Unread Messages",
			description: "Read the unread portal message count.",
			inputSchema: {},
		},
		async () =>
			textContent(
				formatResponse(
					"Unread messages",
					await getClient().unreadMessageCount(),
				),
			),
	);

	server.registerTool(
		"chosun_timetable",
		{
			title: "Chosun Timetable",
			description:
				"Read the fixed timetable widget from the Chosun University portal.",
			inputSchema: {
				weekChange: z
					.number()
					.int()
					.min(-8)
					.max(8)
					.default(0)
					.describe(
						"Week offset relative to the current week. Use 0 for the current week.",
					),
			},
		},
		async ({ weekChange }) =>
			textContent(
				formatResponse(
					"Timetable",
					await getClient().fixedTimetable(weekChange),
				),
			),
	);

	server.registerTool(
		"chosun_notices",
		{
			title: "Chosun Notices",
			description:
				"Read the fixed notice widget from the Chosun University portal.",
			inputSchema: {},
		},
		async () =>
			textContent(formatResponse("Notices", await getClient().fixedNotice())),
	);

	server.registerTool(
		"chosun_academic_calendar",
		{
			title: "Chosun Academic Calendar",
			description:
				"Read the academic calendar widget for a YYYYMMDD date range.",
			inputSchema: {
				startDt: z
					.string()
					.regex(/^\d{8}$/)
					.optional()
					.describe(
						"Start date as YYYYMMDD. Defaults to the first day of the current month.",
					),
				endDt: z
					.string()
					.regex(/^\d{8}$/)
					.optional()
					.describe(
						"End date as YYYYMMDD. Defaults to the last day of the current month.",
					),
			},
		},
		async ({ startDt, endDt }) => {
			const range = defaultMonthRange();
			return textContent(
				formatResponse(
					"Academic calendar",
					await getClient().academicPlan(
						startDt ?? range.startDt,
						endDt ?? range.endDt,
					),
				),
			);
		},
	);

	server.registerTool(
		"chosun_clc_config_status",
		{
			title: "Chosun CLC Config Status",
			description:
				"Report whether CLC/e-Class tools are enabled and whether separate CLC credentials are configured, without exposing secrets.",
			inputSchema: {},
		},
		async () =>
			textContent(JSON.stringify(getChosunClcConfigStatus(), null, 2)),
	);

	if (isChosunClcEnabled()) {
		server.registerTool(
			"chosun_clc_session_status",
			{
				title: "Chosun CLC Session Status",
				description:
					"Log in to clc.chosun.ac.kr e-Class and report the current MCP session status.",
				inputSchema: {},
			},
			async () => {
				const clc = getClcClient();
				await clc.ensureLoggedIn();
				return textContent(JSON.stringify(clc.getSessionInfo(), null, 2));
			},
		);

		server.registerTool(
			"chosun_clc_dashboard",
			{
				title: "Chosun CLC Dashboard",
				description:
					"Read an e-Class dashboard summary from clc.chosun.ac.kr: courses, unread counts, notices, timetable, schedule, and events.",
				inputSchema: {
					date: z
						.string()
						.regex(/^\d{8}$|^\d{4}-\d{2}-\d{2}$/)
						.optional()
						.describe(
							"Schedule date as YYYYMMDD or YYYY-MM-DD. Defaults to today's date in Asia/Seoul.",
						),
				},
			},
			async ({ date }) =>
				textContent(
					limitText(
						JSON.stringify(await getClcClient().dashboard(date), null, 2),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_courses",
			{
				title: "Chosun CLC Courses",
				description:
					"Read the current e-Class course list from clc.chosun.ac.kr, optionally including unread post counts.",
				inputSchema: {
					includeUnread: z
						.boolean()
						.default(true)
						.describe(
							"Include unread post counts by calling course_unread_list.acl.",
						),
				},
			},
			async ({ includeUnread }) =>
				textContent(
					JSON.stringify(await getClcClient().courses(includeUnread), null, 2),
				),
		);

		server.registerTool(
			"chosun_clc_counts",
			{
				title: "Chosun CLC Counts",
				description:
					"Read e-Class new message, notification, and TODO counts from clc.chosun.ac.kr.",
				inputSchema: {},
			},
			async () =>
				textContent(JSON.stringify(await getClcClient().counters(), null, 2)),
		);

		server.registerTool(
			"chosun_clc_schedule",
			{
				title: "Chosun CLC Schedule",
				description:
					"Read the e-Class day schedule widget from clc.chosun.ac.kr.",
				inputSchema: {
					date: z
						.string()
						.regex(/^\d{8}$|^\d{4}-\d{2}-\d{2}$/)
						.optional()
						.describe(
							"Schedule date as YYYYMMDD or YYYY-MM-DD. Defaults to today's date in Asia/Seoul.",
						),
				},
			},
			async ({ date }) =>
				textContent(
					JSON.stringify(await getClcClient().scheduleDay(date), null, 2),
				),
		);

		server.registerTool(
			"chosun_clc_notices",
			{
				title: "Chosun CLC Notices",
				description:
					"Read e-Class community notices or CTL notices from clc.chosun.ac.kr.",
				inputSchema: {
					source: z
						.enum(["community", "ctl"])
						.default("community")
						.describe(
							"Notice source. community reads main page notices; ctl reads main_ctl_notice_list.acl.",
						),
					limit: z.number().int().min(1).max(50).default(10),
				},
			},
			async ({ source, limit }) => {
				const clc = getClcClient();
				const notices =
					source === "ctl"
						? await clc.ctlNotices(limit)
						: await clc.communityNotices(limit);
				return textContent(JSON.stringify(notices, null, 2));
			},
		);

		server.registerTool(
			"chosun_clc_events",
			{
				title: "Chosun CLC Events",
				description: "Read the e-Class new event list from clc.chosun.ac.kr.",
				inputSchema: {
					display: z
						.number()
						.int()
						.min(1)
						.max(50)
						.default(5)
						.describe("Number of events to request from new_event_list.acl."),
				},
			},
			async ({ display }) =>
				textContent(
					JSON.stringify(await getClcClient().newEvents(display), null, 2),
				),
		);

		server.registerTool(
			"chosun_clc_main_widgets",
			{
				title: "Chosun CLC Main Widgets",
				description:
					"Read the remaining e-Class main page widgets observed in the HAR: quick menu, month schedule, OCW, share groups, site links, and important items.",
				inputSchema: {
					date: z
						.string()
						.regex(/^\d{8}$|^\d{4}-\d{2}-\d{2}$/)
						.optional()
						.describe(
							"Date as YYYYMMDD or YYYY-MM-DD for the month schedule widget. Defaults to today's date in Asia/Seoul.",
						),
					display: z
						.number()
						.int()
						.min(1)
						.max(50)
						.default(5)
						.describe("Number of important items to request."),
				},
			},
			async ({ date, display }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getClcClient().mainWidgets(date, display),
							null,
							2,
						),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_home",
			{
				title: "Chosun CLC Course Home",
				description:
					"Enter a clc.chosun.ac.kr e-Class course and read the course home/submain summary.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe(
							"Course KJKEY from chosun_clc_courses, for example 01202614712201.",
						),
				},
			},
			async ({ kjKey }) =>
				textContent(
					limitText(
						JSON.stringify(await getClcClient().courseHome(kjKey), null, 2),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_menu_counts",
			{
				title: "Chosun CLC Course Menu Counts",
				description:
					"Read unread menu counts for an e-Class course, including notices, lecture materials, and assignments.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
				},
			},
			async ({ kjKey }) =>
				textContent(
					JSON.stringify(
						await getClcClient().courseMenuUnreadCounts(kjKey),
						null,
						2,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_activity",
			{
				title: "Chosun CLC Course Activity",
				description:
					"Read course home activity widgets observed in the HAR: submit summary, new posts, new comments, and important items.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
					display: z
						.number()
						.int()
						.min(1)
						.max(50)
						.default(10)
						.describe("Number of activity rows to request."),
				},
			},
			async ({ kjKey, display }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getClcClient().courseActivity(kjKey, display),
							null,
							2,
						),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_room_auth",
			{
				title: "Chosun CLC Course Room Auth",
				description:
					"Run the e-Class course room auth check endpoint observed before course menu requests.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
				},
			},
			async ({ kjKey }) =>
				textContent(
					JSON.stringify(await getClcClient().courseRoomAuth(kjKey), null, 2),
				),
		);

		server.registerTool(
			"chosun_clc_course_chat",
			{
				title: "Chosun CLC Course Chat",
				description:
					"Read e-Class course chat form and message list HTML summaries observed in the HAR.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
					mode: z
						.enum(["online", "offline"])
						.default("online")
						.describe("Chat form mode to load."),
				},
			},
			async ({ kjKey, mode }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getClcClient().courseChat(kjKey, mode),
							null,
							2,
						),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_content_list",
			{
				title: "Chosun CLC Course Content List",
				description:
					"List lecture materials, notices, or assignments inside a clc.chosun.ac.kr e-Class course.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
					kind: z
						.enum(["lecture_material", "notice", "report"])
						.describe("Course menu to list."),
					display: z
						.number()
						.int()
						.min(1)
						.max(100)
						.default(20)
						.describe("Number of rows to request."),
					start: z
						.number()
						.int()
						.min(1)
						.default(1)
						.describe(
							"List start page/offset used by CLC. Use 1 for the first page.",
						),
					keyword: z
						.string()
						.default("")
						.describe("Optional CLC search keyword."),
				},
			},
			async ({ kjKey, kind, display, start, keyword }) =>
				textContent(
					JSON.stringify(
						await getClcClient().courseContentList(kjKey, kind, {
							display,
							start,
							keyword,
						}),
						null,
						2,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_content_detail",
			{
				title: "Chosun CLC Course Content Detail",
				description:
					"Read an e-Class lecture material, notice, or assignment detail, including attachment metadata and comments.",
				inputSchema: {
					kjKey: z
						.string()
						.min(1)
						.describe("Course KJKEY from chosun_clc_courses."),
					kind: z
						.enum(["lecture_material", "notice", "report"])
						.describe("Course content type."),
					id: z
						.string()
						.min(1)
						.describe(
							"ARTL_NUM for lecture_material/notice, or RT_SEQ for report.",
						),
					includeFiles: z
						.boolean()
						.default(true)
						.describe("Fetch attachment metadata via efile_list.acl."),
					includeComments: z
						.boolean()
						.default(true)
						.describe("Fetch comments via cmmt_list2.acl."),
				},
			},
			async ({ kjKey, kind, id, includeFiles, includeComments }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getClcClient().courseContentDetail(kjKey, kind, id, {
								includeFiles,
								includeComments,
							}),
							null,
							2,
						),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_clc_course_file_download",
			{
				title: "Chosun CLC Course File Download",
				description:
					"Download an authenticated e-Class attachment URL returned by chosun_clc_course_content_detail into the project directory.",
				inputSchema: {
					downloadUrl: z
						.string()
						.url()
						.describe(
							"Attachment downloadUrl returned by chosun_clc_course_content_detail.",
						),
					outputPath: z
						.string()
						.optional()
						.describe(
							"Optional project-relative output path. Defaults to downloads/clc/<server filename>. Paths outside the project are rejected.",
						),
				},
			},
			async ({ downloadUrl, outputPath }) =>
				textContent(
					JSON.stringify(
						await getClcClient().downloadCourseFile(downloadUrl, outputPath),
						null,
						2,
					),
				),
		);
	}

	server.registerTool(
		"chosun_oj_config_status",
		{
			title: "Chosun OJ Config Status",
			description:
				"Report whether OJ tools are enabled and whether separate OJ credentials are configured, without exposing secrets.",
			inputSchema: {},
		},
		async () => textContent(JSON.stringify(getChosunOjConfigStatus(), null, 2)),
	);

	if (isChosunOjEnabled()) {
		server.registerTool(
			"chosun_oj_session_status",
			{
				title: "Chosun OJ Session Status",
				description:
					"Log in to oj.chosun.ac.kr with separate OJ credentials and report the current MCP session status.",
				inputSchema: {},
			},
			async () => {
				const oj = getOjClient();
				await oj.ensureLoggedIn();
				return textContent(JSON.stringify(oj.getSessionInfo(), null, 2));
			},
		);

		server.registerTool(
			"chosun_oj_home",
			{
				title: "Chosun OJ Home",
				description: "Read the oj.chosun.ac.kr judge home page after login.",
				inputSchema: {},
			},
			async () =>
				textContent(
					limitText(
						JSON.stringify(await getOjClient().judgeHome(), null, 2),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_student_main",
			{
				title: "Chosun OJ Student Main",
				description:
					"Read the OJ student main page for a class/course id observed in the HAR.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
				},
			},
			async ({ classId }) =>
				textContent(
					limitText(
						JSON.stringify(await getOjClient().studentMain(classId), null, 2),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_contest_problem_list",
			{
				title: "Chosun OJ Contest Problem List",
				description:
					"Read an OJ contest/problem-list page, such as contestproblemlist/271/2195.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
					contestId: z
						.string()
						.min(1)
						.describe("OJ contest id, for example 2195."),
				},
			},
			async ({ classId, contestId }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getOjClient().contestProblemList(classId, contestId),
							null,
							2,
						),
						30000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_status",
			{
				title: "Chosun OJ Status",
				description:
					"Read an OJ status page for class, contest, and problem id, optionally filtered by uid.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
					contestId: z
						.string()
						.min(1)
						.describe("OJ contest id, for example 2195."),
					problemId: z
						.string()
						.min(1)
						.describe("OJ problem id, for example 9677."),
					uid: z
						.string()
						.optional()
						.describe("Optional OJ uid query value observed in the HAR."),
					maxPages: z
						.number()
						.int()
						.min(1)
						.max(100)
						.default(10)
						.describe(
							"Maximum status pages to auto-fetch. OJ pages advance by /10, /20, ...",
						),
				},
			},
			async ({ classId, contestId, problemId, uid, maxPages }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getOjClient().status(
								classId,
								contestId,
								problemId,
								uid,
								maxPages,
							),
							null,
							2,
						),
						50000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_contest_scoreboard",
			{
				title: "Chosun OJ Contest Scoreboard",
				description:
					"Aggregate all OJ contest submissions by user and problem, using paginated status pages.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
					contestId: z
						.string()
						.min(1)
						.describe("OJ contest id, for example 2195."),
					maxPagesPerProblem: z
						.number()
						.int()
						.min(1)
						.max(100)
						.default(20)
						.describe("Maximum status pages to fetch per problem."),
				},
			},
			async ({ classId, contestId, maxPagesPerProblem }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getOjClient().contestScoreboard(
								classId,
								contestId,
								maxPagesPerProblem,
							),
							null,
							2,
						),
						50000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_source",
			{
				title: "Chosun OJ Source",
				description:
					"Read the OJ source-code page for a submission id, such as showsource/271/9677/561179.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
					problemId: z
						.string()
						.min(1)
						.describe("OJ problem id, for example 9677."),
					submitId: z
						.string()
						.min(1)
						.describe("OJ submission/source id, for example 561179."),
				},
			},
			async ({ classId, problemId, submitId }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getOjClient().source(classId, problemId, submitId),
							null,
							2,
						),
						50000,
					),
				),
		);

		server.registerTool(
			"chosun_oj_problem_info",
			{
				title: "Chosun OJ Problem Info",
				description:
					"Read an OJ contest problem detail page, such as contestprobleminfo/271/2195/9678.",
				inputSchema: {
					classId: z.string().min(1).describe("OJ class id, for example 271."),
					contestId: z
						.string()
						.min(1)
						.describe("OJ contest id, for example 2195."),
					problemId: z
						.string()
						.min(1)
						.describe("OJ problem id, for example 9678."),
				},
			},
			async ({ classId, contestId, problemId }) =>
				textContent(
					limitText(
						JSON.stringify(
							await getOjClient().problemInfo(classId, contestId, problemId),
							null,
							2,
						),
						30000,
					),
				),
		);
	}

	server.registerTool(
		"chosun_course_offerings",
		{
			title: "Chosun Course Offerings",
			description:
				"Search undergraduate course offerings from the Chosun academic system.",
			inputSchema: {
				year: z
					.string()
					.regex(/^\d{4}$/)
					.describe("Academic year, for example 2026."),
				semester: z
					.string()
					.regex(/^\d{2}$/)
					.describe(
						"Semester code. Common values: 11 first semester, 12 summer, 21 second semester, 22 winter.",
					),
				collegeCode: z
					.string()
					.optional()
					.describe("Optional college code such as 1A70000000."),
				departmentCode: z
					.string()
					.optional()
					.describe("Optional department code such as 1A70A30140."),
				subjectCode: z.string().optional().describe("Optional subject code."),
				professorNo: z
					.string()
					.optional()
					.describe("Optional professor number."),
				completionTypeCode: z
					.string()
					.optional()
					.describe("Optional completion type / course category code."),
				curriculumTypeCode: z
					.string()
					.optional()
					.describe("Optional curriculum type code."),
				lectureTypeCode: z
					.string()
					.optional()
					.describe("Optional lecture type code."),
				dayNightCode: z
					.string()
					.optional()
					.describe("Optional day/night code."),
				closedStatus: z
					.string()
					.default("2")
					.describe(
						"Closure status filter used by the portal. Default 2 matches the observed portal request.",
					),
				keyword: z
					.string()
					.optional()
					.describe(
						"Local keyword filter over subject, professor, college, department, room, and time.",
					),
				limit: z.number().int().min(1).max(1000).default(100),
				offset: z.number().int().min(0).default(0),
				includeContact: z
					.boolean()
					.default(false)
					.describe("Include professor contact fields when present."),
			},
		},
		async ({
			year,
			semester,
			collegeCode,
			departmentCode,
			subjectCode,
			professorNo,
			completionTypeCode,
			curriculumTypeCode,
			lectureTypeCode,
			dayNightCode,
			closedStatus,
			keyword,
			limit,
			offset,
			includeContact,
		}) => {
			const result = await getClient().courseOfferings({
				year,
				semester,
				collegeCode,
				departmentCode,
				subjectCode,
				professorNo,
				completionTypeCode,
				curriculumTypeCode,
				lectureTypeCode,
				dayNightCode,
				closedStatus,
			});
			const filteredRows = filterCourseRows(result.rows, keyword);
			const rows = filteredRows
				.slice(offset, offset + limit)
				.map((row) => summarizeCourseOffering(row, includeContact));

			return textContent(
				JSON.stringify(
					{
						query: {
							...result.query,
							keyword: keyword ?? "",
						},
						totalRows: result.totalRows,
						filteredRows: filteredRows.length,
						offset,
						limit,
						returnedRows: rows.length,
						rows,
					},
					null,
					2,
				),
			);
		},
	);

	server.registerTool(
		"chosun_course_syllabus",
		{
			title: "Chosun Course Syllabus",
			description:
				"Read a course syllabus report for a course offering returned by chosun_course_offerings.",
			inputSchema: {
				year: z.string().regex(/^\d{4}$/),
				semester: z.string().regex(/^\d{2}$/),
				collegeCode: z.string().min(1),
				departmentCode: z.string().min(1),
				subjectCode: z.string().min(1),
				section: z.string().min(1),
				professorNo: z.string().min(1),
				completionTypeCode: z.string().min(1),
				corsGb: z.string().default("1"),
				maxPages: z
					.number()
					.int()
					.min(1)
					.max(10)
					.default(1)
					.describe("Maximum report pages to fetch and extract."),
				includeContact: z
					.boolean()
					.default(false)
					.describe("Include contact information in extracted report text."),
				includeViewData: z
					.boolean()
					.default(false)
					.describe(
						"Include raw ClipReport viewData base64 for fetched pages.",
					),
			},
		},
		async ({
			year,
			semester,
			collegeCode,
			departmentCode,
			subjectCode,
			section,
			professorNo,
			completionTypeCode,
			corsGb,
			maxPages,
			includeContact,
			includeViewData,
		}) => {
			const syllabus = await getClient().courseSyllabus({
				year,
				semester,
				collegeCode,
				departmentCode,
				subjectCode,
				section,
				professorNo,
				completionTypeCode,
				corsGb,
				maxPages,
				includeContact,
				includeViewData,
			});

			return textContent(
				limitText(
					JSON.stringify(
						{
							title: syllabus.title,
							course: syllabus.course,
							pageCount: syllabus.pageCount,
							returnedPages: syllabus.pages.length,
							pages: syllabus.pages.map(formatSyllabusPage),
						},
						null,
						2,
					),
					30000,
				),
			);
		},
	);

	server.registerTool(
		"chosun_graduation_diagnosis",
		{
			title: "Chosun Graduation Diagnosis",
			description:
				"Read graduation self-diagnosis data from the Chosun academic system.",
			inputSchema: {},
		},
		async () =>
			textContent(
				limitText(
					JSON.stringify(await getClient().graduationDiagnosis(), null, 2),
					30000,
				),
			),
	);

	server.registerTool(
		"chosun_graduation_summary",
		{
			title: "Chosun Graduation Summary",
			description:
				"Summarize graduation self-diagnosis data without exposing student identifiers.",
			inputSchema: {
				missingCourseLimit: z
					.number()
					.int()
					.min(0)
					.max(100)
					.default(20)
					.describe(
						"Maximum number of missing required courses to include. Use 0 to omit the list.",
					),
			},
		},
		async ({ missingCourseLimit }) =>
			textContent(
				JSON.stringify(
					summarizeGraduation(
						await getClient().graduationDiagnosis(),
						missingCourseLimit,
					),
					null,
					2,
				),
			),
	);

	server.registerTool(
		"chosun_verification_report",
		{
			title: "Chosun Verification Report",
			description:
				"Run the same portal and academic-system checks used in the MCP verification log, then return a compact report.",
			inputSchema: {
				weekChange: z
					.number()
					.int()
					.min(-8)
					.max(8)
					.default(0)
					.describe(
						"Week offset for the timetable check. Use 0 for the current week.",
					),
				startDt: z
					.string()
					.regex(/^\d{8}$/)
					.optional()
					.describe(
						"Academic calendar start date as YYYYMMDD. Defaults to the first day of the current month.",
					),
				endDt: z
					.string()
					.regex(/^\d{8}$/)
					.optional()
					.describe(
						"Academic calendar end date as YYYYMMDD. Defaults to the last day of the current month.",
					),
				includeGraduation: z
					.boolean()
					.default(true)
					.describe(
						"Whether to include the academic-system graduation diagnosis check.",
					),
			},
		},
		async ({ weekChange, startDt, endDt, includeGraduation }) => {
			const portal = getClient();
			const range = defaultMonthRange();
			const calendarStart = startDt ?? range.startDt;
			const calendarEnd = endDt ?? range.endDt;

			const checks = [
				await runCheck("session_status", async () => {
					await portal.ensureLoggedIn();
					return portal.getSessionInfo();
				}),
				await runCheck("server_time", async () =>
					summarizeServerTime(await portal.serverTime()),
				),
				await runCheck("unread_messages", async () =>
					summarizeUnreadMessages(await portal.unreadMessageCount()),
				),
				await runCheck("timetable", async () =>
					summarizeTimetable(await portal.fixedTimetable(weekChange)),
				),
				await runCheck("notices", async () =>
					summarizeNotices(await portal.fixedNotice(), 5),
				),
				await runCheck("academic_calendar", async () =>
					summarizeAcademicCalendar(
						await portal.academicPlan(calendarStart, calendarEnd),
					),
				),
			];

			if (includeGraduation) {
				checks.push(
					await runCheck("graduation_summary", async () =>
						summarizeGraduation(await portal.graduationDiagnosis(), 10),
					),
				);
			}

			return textContent(
				JSON.stringify(
					{
						ok: checks.every((check) => check.ok),
						checkedAt: new Date().toISOString(),
						calendarRange: {
							startDt: calendarStart,
							endDt: calendarEnd,
						},
						checks,
					},
					null,
					2,
				),
			);
		},
	);
}

function getClient(): ChosunPortalClient {
	client ??= new ChosunPortalClient(loadChosunConfig());
	return client;
}

function getClcClient(): ChosunClcClient {
	clcClient ??= new ChosunClcClient(loadChosunClcConfig());
	return clcClient;
}

function getOjClient(): ChosunOjClient {
	ojClient ??= new ChosunOjClient(loadChosunOjConfig());
	return ojClient;
}

function textContent(text: string) {
	return {
		content: [
			{
				type: "text" as const,
				text,
			},
		],
	};
}

async function runCheck<T>(
	name: string,
	action: () => Promise<T>,
): Promise<{
	name: string;
	ok: boolean;
	elapsedMs: number;
	result?: T;
	error?: string;
}> {
	const startedAt = Date.now();
	try {
		const result = await action();
		return {
			name,
			ok: true,
			elapsedMs: Date.now() - startedAt,
			result,
		};
	} catch (error) {
		return {
			name,
			ok: false,
			elapsedMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function formatResponse(title: string, response: PortalResponse): string {
	const body =
		response.json !== undefined
			? JSON.stringify(response.json, null, 2)
			: htmlToText(response.text);
	return [
		`${title}`,
		`status: ${response.status}`,
		`content-type: ${response.contentType || "unknown"}`,
		"",
		limitText(body || "(empty response)", 16000),
	].join("\n");
}

function limitText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} characters]`;
}

function summarizeServerTime(
	response: PortalResponse,
): Record<string, unknown> {
	return {
		status: response.status,
		contentType: response.contentType,
		serverTime: getRecord(response.json)?.serverTime,
	};
}

function summarizeUnreadMessages(
	response: PortalResponse,
): Record<string, unknown> {
	const data = getRecord(getRecord(response.json)?.data);
	return {
		status: response.status,
		contentType: response.contentType,
		unreadCnt: data?.unreadCnt,
		success: getRecord(response.json)?.success,
	};
}

function summarizeTimetable(response: PortalResponse): Record<string, unknown> {
	const rows = getRecordArray(getRecord(response.json)?.weeklyTimetable);
	const classes = rows.filter((row) =>
		Object.keys(row).some((key) => key.endsWith("_gwamok_nm")),
	);

	return {
		status: response.status,
		contentType: response.contentType,
		rowCount: rows.length,
		classSlotCount: classes.length,
		samples: classes.slice(0, 8).map(summarizeTimetableRow),
	};
}

function summarizeTimetableRow(
	row: Record<string, unknown>,
): Record<string, unknown> {
	const dayPrefixes = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
	for (const day of dayPrefixes) {
		const subject = stringValue(row[`${day}_gwamok_nm`]);
		if (!subject) {
			continue;
		}

		return {
			day,
			period: stringValue(row.gyosi_abbr_nm),
			time: stringValue(row.gyosi_sigan),
			subject,
			room: stringValue(row[`${day}_hosil_nm`]),
			section: stringValue(row[`${day}_bunban`]),
		};
	}

	return {
		period: stringValue(row.gyosi_abbr_nm),
		time: stringValue(row.gyosi_sigan),
	};
}

function summarizeNotices(
	response: PortalResponse,
	limit: number,
): Record<string, unknown> {
	const rows = getRecordArray(getRecord(response.json)?.postList);
	return {
		status: response.status,
		contentType: response.contentType,
		count: rows.length,
		samples: rows.slice(0, limit).map((row) => ({
			prefix: stringValue(row.prefix),
			title: stringValue(row.text_title),
			createdAt: stringValue(row.cre_dt),
			url: stringValue(row.enc_url),
		})),
	};
}

function summarizeAcademicCalendar(
	response: PortalResponse,
): Record<string, unknown> {
	const rows = getRecordArray(getRecord(response.json)?.haksaPlanList);
	return {
		status: response.status,
		contentType: response.contentType,
		count: rows.length,
		events: rows.slice(0, 20).map((row) => ({
			date: stringValue(row.date),
			tasks: getRecordArray(row.cttTaskList)
				.map((task) => stringValue(task.taskName))
				.filter(Boolean),
		})),
	};
}

function summarizeGraduation(
	diagnosis: GraduationDiagnosis,
	missingCourseLimit: number,
): Record<string, unknown> {
	const creditSummary = diagnosis.creditSummary[0] ?? {};
	const missingRequiredCourses = diagnosis.requiredCourses.filter(
		(course) => !isCompletedCourse(course.ISU_YN),
	);

	return {
		profile: {
			academicStatus: diagnosis.profile.HAKJEOK_ST_NM,
			courseType: diagnosis.profile.GWAJEONG_NM,
			curriculumYear: diagnosis.profile.GWAJEONG_YEAR,
			college: diagnosis.profile.DAEHAK_NM,
			department: diagnosis.profile.HAKGWA_NM,
			grade: diagnosis.profile.HAKNYEON_GB,
		},
		credits: pickKnownFields(creditSummary, [
			"JOLEOP_ISU_HAKJEOM",
			"P_INJEONG_HAKJEOM",
			"P_GYOYANG_INJEONG_HAKJEOM",
			"JEONGONG_GIJUN_HAKJEOM",
			"JEONGONG_ISU_HAKJEOM",
			"JEONGONG_MIISU_HAKJEOM",
			"DAJEON1_GIJUN_HAKJEOM",
			"DAJEON1_ISU_HAKJEOM",
			"DAJEON3_GIJUN_HAKJEOM",
			"DAJEON3_SUGANG_HAKJEOM",
		]),
		counts: {
			creditSummary: diagnosis.creditSummary.length,
			liberalArts: diagnosis.liberalArts.length,
			multipleMajors: diagnosis.multipleMajors.length,
			multipleMajorRecognitions: diagnosis.multipleMajorRecognitions.length,
			requiredCourses: diagnosis.requiredCourses.length,
			missingRequiredCourses: missingRequiredCourses.length,
		},
		missingRequiredCourses:
			missingCourseLimit > 0
				? missingRequiredCourses
						.slice(0, missingCourseLimit)
						.map(summarizeRequiredCourse)
				: [],
	};
}

function summarizeRequiredCourse(
	course: Record<string, string>,
): Record<string, string> {
	return {
		code: course.GWAJEONG_GWAMOK_CD || course.ISU_GWAMOK_CD || "",
		name: course.GWAJEONG_GWAMOK_NM || "",
		year: course.GWAJEONG_HAKNYEON_GB || "",
		semester: course.GWAJEONG_HAKGI_GB || "",
		credits: course.ISU_HAKJEOM || "",
		status: course.ISU_YN || "",
	};
}

function isCompletedCourse(value: string | undefined): boolean {
	const normalized = (value ?? "").trim().toUpperCase();
	return (
		normalized === "Y" ||
		normalized === "1" ||
		normalized === "P" ||
		normalized === "PASS" ||
		normalized === "이수"
	);
}

function pickKnownFields(
	row: Record<string, string>,
	keys: string[],
): Record<string, string> {
	return Object.fromEntries(
		keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]),
	);
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((item): item is Record<string, unknown> =>
				Boolean(getRecord(item)),
			)
		: [];
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function filterCourseRows(
	rows: Record<string, string>[],
	keyword: string | undefined,
): Record<string, string>[] {
	const normalizedKeyword = keyword?.trim().toLowerCase();
	if (!normalizedKeyword) {
		return rows;
	}

	return rows.filter((row) =>
		[
			row.GWAMOK_CD,
			row.GWAMOK_NM,
			row.GYOSU_NM,
			row.DAEHAK_NM,
			row.HAKGWA_NM,
			row.GANGUI_TIME_NM,
			row.GANGUISIL_NM,
			row.SUEOP_BANGSIK_NM,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase()
			.includes(normalizedKeyword),
	);
}

function summarizeCourseOffering(
	row: Record<string, string>,
	includeContact: boolean,
): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		year: row.YEAR,
		semester: row.HAKGI_GB,
		semesterName: row.HAKGI_NM,
		subjectCode: row.GWAMOK_CD,
		subjectName: row.GWAMOK_NM,
		section: row.BUNBAN,
		credits: row.HAKJEOM,
		completionTypeCode: row.ISU_GB,
		collegeCode: row.DAEHAK_CD,
		collegeName: row.DAEHAK_NM,
		departmentCode: row.HAKGWA_CD,
		departmentName: row.HAKGWA_NM,
		professorNo: row.GYOSU_NO,
		professorName: row.GYOSU_NM,
		professorTitle: row.JIKWI_NM,
		classTime: row.GANGUI_TIME_NM,
		classroom: row.GANGUISIL_NM,
		capacity: row.TOT_JEHAN_INWON,
		enrolled: row.TOT_SINCH_INWON,
		instructionMode: row.SUEOP_BANGSIK_NM,
		closed: row.PYEGANG_YN,
		syllabusRequest: {
			year: row.YEAR,
			semester: row.HAKGI_GB,
			collegeCode: row.DAEHAK_CD,
			departmentCode: row.HAKGWA_CD,
			subjectCode: row.GWAMOK_CD,
			section: row.BUNBAN,
			professorNo: row.GYOSU_NO,
			completionTypeCode: row.ISU_GB,
			corsGb: row.CORS_GB || "1",
		},
	};

	if (includeContact) {
		summary.contact = {
			phone: row.HP_NO,
			email: row.EMAIL,
		};
	}

	return summary;
}

function formatSyllabusPage(page: CourseSyllabusPage): Record<string, unknown> {
	const formatted: Record<string, unknown> = {
		pageIndex: page.pageIndex,
		viewDataBytes: page.viewDataBytes,
		text: page.text,
	};
	if (page.viewDataBase64) {
		formatted.viewDataBase64 = page.viewDataBase64;
	}
	return formatted;
}

function defaultMonthRange(): { startDt: string; endDt: string } {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), 1);
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
	return {
		startDt: formatYyyymmdd(start),
		endDt: formatYyyymmdd(end),
	};
}

function formatYyyymmdd(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}
