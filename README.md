# chosun-mcp

조선대학교 포털, 종합정보, CLC/e-Class, OJ 정보를 MCP(Model Context Protocol) tool로 조회하는 TypeScript 서버입니다.

개인 사용을 위해 취미로 만드는 비공식 프로젝트입니다. 조선대학교 공식 서비스나 공식 API가 아니며, 학교 시스템 화면/요청 구조가 바뀌면 언제든 동작하지 않을 수 있습니다.

## 기능

- 포털(`p.chosun.ac.kr`)
  - 로그인/세션 상태
  - 서버 시간
  - 읽지 않은 쪽지 수
  - 시간표 위젯
  - 공지 위젯
  - 학사일정 위젯
- 종합정보(`a.chosun.ac.kr`)
  - 개설과목 조회
  - 개설과목 수업계획서 조회
  - 졸업 자가진단 원본 조회
  - 개인정보를 줄인 졸업 자가진단 요약
- CLC/e-Class(`clc.chosun.ac.kr`)
  - 대시보드, 수강과목, 알림/TODO/쪽지 카운트
  - 일정, 공지, 이벤트, 메인 위젯
  - 과목 홈, 메뉴별 안읽은 수, 활동 위젯
  - 강의자료/공지/과제 목록 및 상세
  - 첨부파일 다운로드
- OJ(`oj.chosun.ac.kr`)
  - 별도 로그인 세션
  - judge 홈, 학생 메인
  - 대회/과제 문제 목록
  - 제출 상태
  - 제출 소스
  - 문제 상세

현재 구현은 조회 중심입니다. 파일 다운로드 외에는 학교 시스템에 데이터를 쓰는 기능을 넣지 않는 방향으로 관리합니다.

## 주의

- 이 프로젝트는 보안을 신경 써서 설계하거나 검토한 프로젝트가 아닙니다.
- 사용 중 발생하는 계정 문제, 개인정보 노출, 세션/쿠키 유출, 학교 시스템 이용 제한, 기타 보안 문제에 대해 프로젝트 작성자는 책임지지 않습니다.
- 실제 계정으로 사용할 경우 모든 책임은 사용자 본인에게 있습니다.
- `.env`에는 실제 학번/비밀번호가 들어가므로 Git에 올리지 않습니다.
- HAR 파일에는 쿠키, 세션, 요청 파라미터가 들어갈 수 있으므로 Git에 올리지 않습니다.
- 이 프로젝트는 학교 공식 API를 사용하는 것이 아니라 실제 웹 요청 흐름을 재현합니다.
- 계정 정보와 조회 결과에는 개인정보가 포함될 수 있으니 MCP host 로그, 공유 화면, 저장 파일을 조심해서 다뤄야 합니다.

## 요구사항

- Node.js 18 이상
- npm

## 설치

```sh
npm install
```

## 설정

`.env.example`을 복사해 프로젝트 루트에 `.env`를 만듭니다.

```sh
cp .env.example .env
```

예시:

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

CLC/e-Class 도구는 `chosun_clc_enabled=true`일 때만 등록됩니다.

OJ 도구는 `chosun_oj_enabled=true`일 때만 등록됩니다.

## 실행

```sh
npm run build
npm start
```

개발 중에는 TypeScript를 직접 실행할 수 있습니다.

```sh
npm run dev
```

MCP Inspector로 확인하려면:

```sh
npm run inspect
```

## MCP host 설정 예시

빌드 후 `build/index.js`를 MCP 서버 엔트리로 등록합니다.

```json
{
  "mcpServers": {
    "chosun-mcp": {
      "command": "node",
      "args": ["/path/to/chosun-mcp/build/index.js"],
      "cwd": "/path/to/chosun-mcp"
    }
  }
}
```

이 저장소를 현재 위치 그대로 쓴다면 `/path/to/chosun-mcp`를 프로젝트 절대경로로 바꾸면 됩니다.

## 도구 목록

### 포털

- `chosun_session_status`: 포털 로그인 및 세션 상태 확인
- `chosun_server_time`: 포털 서버 시간 조회
- `chosun_unread_messages`: 읽지 않은 쪽지 수 조회
- `chosun_timetable`: 시간표 위젯 조회
- `chosun_notices`: 공지 위젯 조회
- `chosun_academic_calendar`: 학사일정 위젯 조회

### 종합정보

- `chosun_course_offerings`: 개설과목 조회
- `chosun_course_syllabus`: 개설과목의 수업계획서 조회
- `chosun_graduation_diagnosis`: 졸업 자가진단 원본 조회
- `chosun_graduation_summary`: 개인정보 식별자를 줄인 졸업 자가진단 요약
- `chosun_verification_report`: 세션, 시간표, 공지, 학사일정, 졸업진단 등 주요 조회를 한 번에 검증

### CLC/e-Class

- `chosun_clc_config_status`: CLC/e-Class 활성화 및 계정 설정 여부 확인
- `chosun_clc_session_status`: CLC/e-Class 로그인 및 세션 상태 확인
- `chosun_clc_dashboard`: 대시보드 요약 조회
- `chosun_clc_courses`: 수강과목 및 과목별 안읽은 글 수 조회
- `chosun_clc_counts`: 쪽지/알림/TODO 카운트 조회
- `chosun_clc_schedule`: 일별 일정 조회
- `chosun_clc_notices`: 커뮤니티 공지 또는 CTL 공지 조회
- `chosun_clc_events`: 신규 이벤트 조회
- `chosun_clc_main_widgets`: 빠른메뉴, 월간 일정, OCW, 소모임, 사이트 링크, 중요글 조회
- `chosun_clc_course_home`: 과목 홈/서브메인 요약 조회
- `chosun_clc_course_menu_counts`: 과목 메뉴별 안읽은 수 조회
- `chosun_clc_course_activity`: 제출/새글/새댓글/중요글 위젯 조회
- `chosun_clc_course_room_auth`: 과목 방 접근 권한 확인 endpoint 조회
- `chosun_clc_course_chat`: 과목 채팅 화면 및 메시지 목록 요약 조회
- `chosun_clc_course_content_list`: 강의자료/공지/과제 목록 조회
- `chosun_clc_course_content_detail`: 강의자료/공지/과제 상세, 첨부파일, 댓글 조회
- `chosun_clc_course_file_download`: CLC 첨부파일 다운로드

### OJ

- `chosun_oj_config_status`: OJ 활성화 및 계정 설정 여부 확인
- `chosun_oj_session_status`: OJ 로그인 및 세션 상태 확인
- `chosun_oj_home`: judge 홈 조회
- `chosun_oj_student_main`: 학생 메인 조회
- `chosun_oj_contest_problem_list`: 대회/과제 문제 목록 조회
- `chosun_oj_status`: 제출 상태 조회(`/10`, `/20`... 페이지 자동 수집, `maxPages`)
- `chosun_oj_contest_scoreboard`: contest 전체 제출을 userId -> 문제별 최고점 -> 총점으로 집계
- `chosun_oj_source`: 제출 소스 조회(`problemText`, `submittedCode`, `filledAnswers` 분리)
- `chosun_oj_problem_info`: 문제 상세 조회 및 본문 접근 가능 여부(`access.reason`) 표시

## 사용 예시

개설과목 조회:

```json
{
  "year": "2026",
  "semester": "11",
  "keyword": "데이터구조",
  "limit": 5
}
```

`chosun_course_offerings` 결과의 `rows[].syllabusRequest` 값을 `chosun_course_syllabus` 입력으로 넘기면 해당 과목의 수업계획서를 조회할 수 있습니다.

CLC 과목 공지 상세 조회 흐름:

1. `chosun_clc_courses`로 `kjKey`를 찾습니다.
2. `chosun_clc_course_content_list`에 `kind: "notice"`와 `kjKey`를 넣어 공지 목록을 조회합니다.
3. 목록의 `id`를 `chosun_clc_course_content_detail`에 넘겨 본문, 첨부파일, 댓글을 조회합니다.

OJ 문제 조회 흐름:

1. `chosun_oj_student_main`으로 `classId` 기준 화면을 확인합니다.
2. `chosun_oj_contest_problem_list`로 `contestId`의 문제 목록을 조회합니다.
3. `chosun_oj_problem_info` 또는 `chosun_oj_status`로 문제/제출 상태를 확인합니다.
4. 대회 전체 집계가 필요하면 `chosun_oj_contest_scoreboard`에 `classId`, `contestId`를 넘깁니다.

## 로그인 흐름 요약

포털은 `p.chosun.ac.kr/index.jsp`에서 SSO 로그인 페이지로 이동한 뒤, 로그인 페이지의 `l_token`/`c_token`을 추출합니다. 이후 `.env`의 `chosun_id`/`chosun_psw`로 `sso.chosun.ac.kr/Login.eps`에 로그인하고, SSO ticket을 통해 포털 세션을 확정한 뒤 조회성 endpoint를 호출합니다.

종합정보는 포털 세션 확정 후 `a.chosun.ac.kr/exsignon/sso/sso_index.jsp`를 통해 학사 시스템 세션을 열고, PATIS 요청 파라미터를 세션 키로 암호화해 호출합니다.

CLC/e-Class는 `chosun_clc_enabled=true`일 때만 도구가 등록됩니다. `/ilos/lo/login.acl` 로그인 POST 이후 `/ilos/lo/login_branch.acl`을 거쳐 `/ilos/main/main_form.acl` 세션을 확정한 뒤 조회성 endpoint를 호출합니다.

OJ도 `chosun_oj_enabled=true`일 때만 도구가 등록됩니다. `/index.php/auth/login/`, `/index.php/auth/authentication?returnURL=`, `/index.php/judge` 흐름으로 로그인한 뒤 조회성 페이지를 호출합니다.

## 개발

```sh
npm run typecheck
npm run build
```

현재 별도 테스트 러너는 없습니다. 파서나 로그인 흐름을 수정할 때는 실제 계정으로 `chosun_verification_report`, CLC/OJ 세션 상태 도구, 관련 상세 조회 도구를 직접 확인하는 방식으로 검증합니다.

## 앞으로 개선하면 좋은 것

- HAR fixture 기반 파서 테스트 추가
- GitHub Actions에서 `npm run typecheck`와 `npm run build` 자동 실행
- CLC/OJ HTML 파싱 결과의 스키마를 더 안정적으로 정리
- 로그인 실패, 세션 만료, 권한 없음 에러 메시지 개선
- 학사 시스템 코드값 조회 도구 추가
- 수업계획서 결과를 더 구조화된 JSON으로 변환
- OJ classId/contestId/problemId를 자동 탐색하는 보조 도구 추가
- 민감정보 마스킹 유틸과 디버그 로그 정책 추가

## 라이선스

아직 라이선스를 정하지 않았습니다. 공개 사용을 명확히 하려면 `LICENSE` 파일을 추가하는 것이 좋습니다.
