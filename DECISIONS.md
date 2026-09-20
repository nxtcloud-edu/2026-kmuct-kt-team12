# DECISIONS

한 줄씩 append 합니다. 재구성하지 않습니다.

## 형상관리 (2026-09-20)

- 브랜치 전략: `main`(배포) ← `develop`(통합) ← `feature/<기능이름>`(작업). 기본 브랜치는 `develop`.
- 브랜치 보호는 repository **ruleset** 하나로만 관리한다. classic branch protection 은 쓰지 않는다 — 두 메커니즘을 겹치면 push 거부 시 어느 쪽이 막았는지 추적이 안 된다. 초기 세팅 중 `main`/`develop` 에 걸었던 classic protection 은 제거했다.
- ruleset `protection rule`(id 23715238) 적용 범위는 `refs/heads/main`, `refs/heads/develop` 로 한정한다. 최초 설정값은 `~ALL` 이었고, 그 상태에서는 `feature/*` 에도 PR 필수·삭제 금지가 걸려 작업 브랜치에 커밋을 올릴 수 없었다.
- ruleset 규칙: `pull_request`(승인 1), `non_fast_forward`(force push 금지), `deletion`(브랜치 삭제 금지).
- 협업자 5명 전원이 admin 이므로 admin 우회를 허용하지 않는다. 우회 대상은 기존 GitHub App 3개(`bypass_actors`)로 한정한다. 우회를 허용하면 보호 규칙이 아무에게도 적용되지 않는다.
- `.gitignore` 는 `scm.sh init` 기본선을 그대로 쓴다. 의존성 디렉토리와 환경변수·인증서 파일류를 먼저 막는 목적.
- 포기한 대안: classic branch protection 단독 사용. ruleset 이 GitHub 의 현행 메커니즘이고 이미 저장소에 존재했으므로 그쪽으로 통일했다.
- 알려진 한계: PR 승인 1명이 필요하므로 혼자서는 `develop` 에 머지할 수 없다. 승인자를 구할 수 없는 상황이 반복되면 승인 수를 0 으로 내리는 것을 검토한다(그 경우 직접 push 는 여전히 막힌다).
