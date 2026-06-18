# Chosun MCP

조선대학교 포털 정보를 MCP tool로 조회하기 위한 TypeScript MCP 서버입니다.

## 설정

`.env.example`을 참고해 프로젝트 루트에 `.env`를 만듭니다.

```sh
chosun_id=학번또는교직원번호
chosun_psw=비밀번호

# CLC/e-Class는 포털과 비밀번호가 다를 수 있어 별도 설정을 사용합니다.
chosun_clc_enabled=false
chosun_clc_id=CLC아이디
chosun_clc_psw=CLC비밀번호

# OJ도 별도 로그인입니다.
chosun_oj_enabled=false
chosun_oj_id=OJ아이디
chosun_oj_psw=OJ비밀번호
```

`.env`는 git에 포함하지 않습니다.

## 실행

```sh
npm install
npm run build
npm start
```

개발 중 Inspector로 확인:

```sh
npm run inspect
```

## MCP host 설정 예시

```json
{
  "mcpServers": {
    "chosun-mcp": {
      "command": "node",
      "args": ["/Users/slzmf/프로젝트들/조선대 MCP/build/index.js"],
      "cwd": "/Users/slzmf/프로젝트들/조선대 MCP"
    }
  }
}
```

## Tools

- `chosun_session_status`: 로그인 및 세션 상태 확인
- `chosun_server_time`: 포털 서버 시간 조회
- `chosun_unread_messages`: 읽지 않은 쪽지 수 조회
- `chosun_timetable`: 시간표 위젯 조회
- `chosun_notices`: 공지 위젯 조회
- `chosun_academic_calendar`: 학사일정 위젯 조회
- `chosun_clc_config_status`: CLC/e-Class 활성화 여부와 별도 계정 설정 여부 확인
- `chosun_clc_session_status`: CLC/e-Class 로그인 및 세션 상태 확인
- `chosun_clc_dashboard`: CLC/e-Class 수강과목, 안읽은 글, 알림/TODO/쪽지, 공지, 시간표, 일정, 이벤트 요약
- `chosun_clc_courses`: CLC/e-Class 수강과목 및 과목별 안읽은 글 수 조회
- `chosun_clc_counts`: CLC/e-Class 쪽지/알림/TODO 카운트 조회
- `chosun_clc_schedule`: CLC/e-Class 일별 일정 조회
- `chosun_clc_notices`: CLC/e-Class 커뮤니티 공지 또는 CTL 공지 조회
- `chosun_clc_events`: CLC/e-Class 신규 이벤트 조회
- `chosun_clc_main_widgets`: CLC/e-Class 빠른메뉴, 월간 일정, OCW, 소모임, 사이트 링크, 중요글 조회
- `chosun_clc_course_home`: CLC/e-Class 과목 홈/서브메인 요약 조회
- `chosun_clc_course_menu_counts`: CLC/e-Class 과목 메뉴별 안읽은 수 조회
- `chosun_clc_course_activity`: CLC/e-Class 과목 홈의 제출/새글/새댓글/중요글 위젯 조회
- `chosun_clc_course_room_auth`: CLC/e-Class 과목 방 접근 권한 확인 endpoint 조회
- `chosun_clc_course_chat`: CLC/e-Class 과목 채팅 화면 및 메시지 목록 요약 조회
- `chosun_clc_course_content_list`: CLC/e-Class 과목 강의자료/공지/과제 목록 조회
- `chosun_clc_course_content_detail`: CLC/e-Class 과목 강의자료/공지/과제 상세, 첨부파일, 댓글 조회
- `chosun_clc_course_file_download`: CLC/e-Class 첨부파일을 프로젝트 내부 `downloads/clc`로 다운로드
- `chosun_oj_config_status`: OJ 활성화 여부와 별도 계정 설정 여부 확인
- `chosun_oj_session_status`: OJ 로그인 및 세션 상태 확인
- `chosun_oj_home`: OJ judge 홈 조회
- `chosun_oj_student_main`: OJ 학생 메인(`/judge/studentmain/{classId}`) 조회
- `chosun_oj_contest_problem_list`: OJ 대회/과제 문제 목록 조회
- `chosun_oj_status`: OJ 제출 상태 조회
- `chosun_oj_source`: OJ 제출 소스 조회
- `chosun_oj_problem_info`: OJ 문제 상세 조회
- `chosun_course_offerings`: 종합정보 개설과목 조회
- `chosun_course_syllabus`: 개설과목의 수업계획서 report 조회
- `chosun_graduation_diagnosis`: 종합정보 졸업 자가진단 조회
- `chosun_graduation_summary`: 개인정보 식별자를 제외한 졸업 자가진단 요약 조회
- `chosun_verification_report`: 세션/서버시간/쪽지/시간표/공지/학사일정/졸업진단 조회를 한 번에 검증하고 요약

개설과목 조회 예시:

```json
{
  "year": "2026",
  "semester": "11",
  "keyword": "데이터구조",
  "limit": 5
}
```

`chosun_course_offerings` 결과의 `rows[].syllabusRequest` 값을 `chosun_course_syllabus` 입력으로 넘기면 해당 과목의 수업계획서를 조회합니다.

## 로그인 흐름

서버는 `p.chosun.ac.kr/index.jsp`에서 SSO 로그인 페이지로 이동한 뒤, 로그인 페이지의 `l_token`/`c_token`을 매번 추출합니다. 이후 `.env`의 `chosun_id`/`chosun_psw`로 `sso.chosun.ac.kr/Login.eps`에 로그인하고, SSO ticket을 통해 `p.chosun.ac.kr` 포털 세션을 확정한 뒤 조회성 endpoint를 호출합니다.

종합정보(`a.chosun.ac.kr`) 조회는 포털 세션 확정 후 `exsignon/sso/sso_index.jsp`를 통해 학사 시스템 세션을 열고, PATIS 요청 파라미터를 세션 키로 암호화해 호출합니다.

CLC/e-Class(`clc.chosun.ac.kr`) 조회는 `chosun_clc_enabled=true`일 때만 도구가 등록되며, `chosun_clc_id`/`chosun_clc_psw` 별도 계정을 사용합니다. HAR에서 확인한 것처럼 `/ilos/lo/login.acl` 로그인 POST 이후 `/ilos/lo/login_branch.acl`을 거쳐 `/ilos/main/main_form.acl` 세션을 확정한 뒤, `/ilos/main/*`, `/ilos/co/*`, `/ilos/message/*`, `/ilos/st/course/*` 조회성 endpoint를 호출합니다.

OJ(`oj.chosun.ac.kr`) 조회도 `chosun_oj_enabled=true`일 때만 도구가 등록되며, `chosun_oj_id`/`chosun_oj_psw` 별도 계정을 사용합니다. HAR에서 확인한 `/index.php/auth/login/` -> `/index.php/auth/authentication?returnURL=` -> `/index.php/judge` 흐름으로 로그인한 뒤, `/index.php/judge/studentmain/*`, `/contestproblemlist/*`, `/status/*`, `/showsource/*`, `/contestprobleminfo/*` 조회성 페이지를 호출합니다.
