# Learning continuity implementation plan

> For agentic workers: use subagent-driven-development, preserve existing workspace changes.

Goal: deliver the five approved workflow improvements without changing existing playback history or course opening rules.

Architecture: independent local view/draft state helpers, existing course policy for previews, explicit user-driven playback transitions. No new backend or Android permissions.

- [x] Course worker: test draft restore/discard and failure behavior, implement versioned draft storage and page integration; preserve guide state and clear draft after successful creation.
- [x] Course worker: test manual ordering survives course creation and reload; retain natural order until user reorders, present accessible up/down controls.
- [x] Course worker: test rate preview against actual reschedule policy; display today and tomorrow before save, cancel writes nothing.
- [x] Library worker: test view/folder/search/loaded range restoration, missing folder fallback and failed storage; persist scroll at bounded checkpoints, restore after rendering.
- [x] Player worker: test explicit next eligible episode, skips completed/missing/locked content, preserves save-failure recovery; integrate H5 and native controls.
- [x] Browser worker: verify combined user flows at narrow mobile width, check overflow and screenshots; serialize shared server use.
- [x] Root: review cross-feature behavior and failure paths, run full check and App resource build, record actual validation boundaries.

Validation: focused tests first, then full npm check, mobile Playwright regressions, final App resources. No new APK or device validation is implied.

Decisions: use current working tree because earlier approved changes are uncommitted and are the required baseline. Course edits grouped under one owner to avoid conflicts. Defaults remain natural ordering and explicit playback; course drafts require user restore/discard choice. Store no playable URLs or credentials in new workflow state.
